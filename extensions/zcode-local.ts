import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type JsonRecord = Record<string, unknown>;

type AccountsResponse = {
  accounts?: unknown[];
};

type QuotaRow = {
  account: string;
  status: string;
  model: string;
  remaining: number;
  total?: number;
  startAt?: Date;
  expiresAt?: Date;
};

const BRIDGE_URL = process.env.ZCODE_BRIDGE_URL || "http://127.0.0.1:3000";
const ADMIN_KEY = process.env.ZCODE_ADMIN_KEY?.trim();
const REFRESH_MS = 60_000;
const START_KEYS = ["start_at", "started_at", "start_time", "starts_at", "valid_from", "effective_at", "effective_from"];
const END_KEYS = ["end_at", "ended_at", "end_time", "expires_at", "expire_at", "valid_until", "valid_to"];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dateValue(value: unknown): Date | undefined {
  if (typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value.trim()))) {
    const numeric = numberValue(value);
    if (numeric === undefined || numeric <= 0) return undefined;
    const milliseconds = numeric < 1e12 ? numeric * 1000 : numeric;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateFromRecord(record: JsonRecord | undefined, keys: string[]): Date | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const date = dateValue(record[key]);
    if (date) return date;
  }
  return undefined;
}

function entitlementStart(plan: JsonRecord | undefined, model: string, fallback?: Date): Date | undefined {
  const entitlements = Array.isArray(plan?.entitlements) ? plan.entitlements : [];
  const wanted = model.toLowerCase();
  for (const value of entitlements) {
    if (!isRecord(value)) continue;
    const showName = typeof value.show_name === "string" ? value.show_name.toLowerCase() : "";
    const capabilities = Array.isArray(value.capabilities)
      ? value.capabilities.filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase())
      : [];
    if (showName === wanted || capabilities.some((item) => item.replace(/^model:/, "") === wanted)) {
      return dateFromRecord(value, ["effective_at", "starts_at", "start_at"]) || fallback;
    }
  }
  return fallback;
}

function formatDate(date: Date | undefined): string {
  if (!date) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatUnits(value: number | undefined): string {
  if (value === undefined) return "未知";
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toLocaleString("zh-CN");
}

function collectRows(payload: AccountsResponse): QuotaRow[] {
  const rows: QuotaRow[] = [];
  for (const rawAccount of payload.accounts || []) {
    if (!isRecord(rawAccount)) continue;
    const account = String(rawAccount.name || rawAccount.id || "account");
    const status = String(rawAccount.status || "unknown");
    const plan = isRecord(rawAccount.plan) ? rawAccount.plan : undefined;
    const planStart = dateFromRecord(plan, START_KEYS);
    const planEnd = dateFromRecord(plan, END_KEYS);
    const quota = isRecord(rawAccount.quota) ? rawAccount.quota : {};

    for (const [model, rawQuota] of Object.entries(quota)) {
      if (!isRecord(rawQuota)) continue;
      rows.push({
        account,
        status,
        model,
        remaining: numberValue(rawQuota.remaining) ?? 0,
        total: numberValue(rawQuota.total),
        startAt: entitlementStart(plan, model, planStart),
        expiresAt: dateValue(rawQuota.expires_at) || planEnd,
      });
    }
  }
  return rows;
}

function formatStatus(payload: AccountsResponse): string {
  const rows = collectRows(payload);
  if (!rows.length) return "ZCode 额度未获取";
  const summary = rows
    .slice(0, 2)
    .map((row) => `${row.model}: ${formatUnits(row.remaining)} · 到期 ${formatDate(row.expiresAt)}`)
    .join(" · ");
  const suffix = rows.length > 2 ? ` · +${rows.length - 2}` : "";
  return `ZCode ${summary}${suffix}`;
}

function formatDetails(payload: AccountsResponse): string {
  const accounts = (payload.accounts || []).filter(isRecord);
  if (!accounts.length) return "ZCode 账号池为空";

  const lines = ["ZCode 免费额度"];
  for (const account of accounts) {
    const name = String(account.name || account.id || "account");
    const status = String(account.status || "unknown");
    const plan = isRecord(account.plan) ? account.plan : undefined;
    const planStart = dateFromRecord(plan, START_KEYS);
    const planEnd = dateFromRecord(plan, END_KEYS);
    const quota = isRecord(account.quota) ? account.quota : {};
    lines.push(`${name} · ${status}`);

    const entries = Object.entries(quota);
    if (!entries.some(([, value]) => isRecord(value))) {
      lines.push("  额度：未获取");
      continue;
    }
    for (const [model, value] of entries) {
      if (!isRecord(value)) continue;
      const remaining = numberValue(value.remaining) ?? 0;
      const total = numberValue(value.total);
      const expiresAt = dateValue(value.expires_at) || planEnd;
      const startAt = entitlementStart(plan, model, planStart);
      lines.push(
        `  ${model}：剩余 ${formatUnits(remaining)} / ${formatUnits(total)}；` +
          `生效 ${formatDate(startAt)}；到期 ${formatDate(expiresAt)}`,
      );
    }
  }
  return lines.join("\n");
}

function authHeaders(): Record<string, string> {
  if (!ADMIN_KEY) {
    throw new Error("未设置 ZCODE_ADMIN_KEY，请在 agent/secrets/*.env 中配置桥接器后台密钥");
  }
  return {
    Accept: "application/json",
    Authorization: `Bearer ${ADMIN_KEY}`,
  };
}

async function refreshBridgeQuota(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${BRIDGE_URL}/admin/api/accounts/refresh`, {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ all: true }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`刷新额度 HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAccounts(forceRefresh = false): Promise<AccountsResponse> {
  if (forceRefresh) await refreshBridgeQuota();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${BRIDGE_URL}/admin/api/accounts`, {
      headers: authHeaders(),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`额度接口 HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!isRecord(data)) throw new Error("额度接口返回格式无效");
    return data as AccountsResponse;
  } finally {
    clearTimeout(timeout);
  }
}

export default function zcodeLocal(pi: ExtensionAPI): void {
  pi.registerProvider("zcode-local", {
    name: "ZCode (local bridge)",
    baseUrl: BRIDGE_URL,
    api: "anthropic-messages",
    apiKey: "local-bridge",
    models: [
      {
        id: "GLM-5.3-Flash",
        name: "GLM-5.3-Flash (ZCode free)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: {
          input: 0.15,
          output: 0.5,
          cacheRead: 0.03,
          cacheWrite: 0,
        },
        thinkingLevelMap: {
          off: null,
          minimal: null,
          medium: null,
          xhigh: null,
          max: "max",
        },
      },
    ],
  });

  let session: ExtensionContext | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;

  const clearTimer = () => {
    if (timer) clearInterval(timer);
    timer = undefined;
  };

  const refreshQuota = async (
    ui: ExtensionContext["ui"],
    notify: boolean,
    forceRefresh = false,
  ): Promise<void> => {
    if (refreshing) return;
    refreshing = true;
    try {
      const payload = await fetchAccounts(forceRefresh);
      ui.setStatus("zcode-quota", formatStatus(payload));
      if (notify) ui.notify(formatDetails(payload), "info");
    } catch (error) {
      ui.setStatus("zcode-quota", "ZCode 额度不可用");
      if (notify) ui.notify(error instanceof Error ? error.message : String(error), "warning");
    } finally {
      refreshing = false;
    }
  };

  pi.on("session_start", async (_event, nextContext) => {
    session = nextContext;
    clearTimer();
    if (!nextContext.hasUI) return;
    await refreshQuota(nextContext.ui, false);
    timer = setInterval(() => {
      if (session?.hasUI) void refreshQuota(session.ui, false);
    }, REFRESH_MS);
    (timer as ReturnType<typeof setInterval> & { unref?: () => void }).unref?.();
  });

  pi.on("session_shutdown", async () => {
    clearTimer();
    session = undefined;
  });

  pi.registerCommand("zcode-quota", {
    description: "查看 ZCode 免费额度、有效期和到期时间",
    handler: async (_args, context) => {
      await refreshQuota(context.ui, true, true);
    },
  });
}
