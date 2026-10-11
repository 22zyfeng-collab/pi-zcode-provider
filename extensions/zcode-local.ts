import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BRIDGE_URL = process.env.ZCODE_BRIDGE_URL || "http://127.0.0.1:3000";

/** Register GLM-5.3-Flash through a local Anthropic-compatible ZCode bridge. */
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
}
