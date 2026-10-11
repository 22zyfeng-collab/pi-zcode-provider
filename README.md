# pi-zcode-provider

A small [Pi](https://github.com/earendil-works/pi) Provider Extension that registers `GLM-5.3-Flash` through a local Anthropic-compatible ZCode bridge.

This package contains only the Pi-side provider registration. It does not include the bridge, credentials, account database, or upstream authentication logic.

## Requirements

- Pi with Provider Extension support
- A running `zcode2api`-compatible bridge at `http://127.0.0.1:3000`
- An authorized ZCode account configured in that bridge

The bridge is a separate service. This extension does not start it or store its credentials.

## Install

```bash
pi install git:github.com/22zyfeng-collab/pi-zcode-provider
```

Reload Pi after installation:

```text
/reload
```

Then select:

```text
zcode-local/GLM-5.3-Flash
```

The default bridge URL is:

```text
http://127.0.0.1:3000
```

Override it with `ZCODE_BRIDGE_URL` before starting Pi:

```bash
ZCODE_BRIDGE_URL=http://127.0.0.1:3000 pi
```

## Quota display

Set the bridge admin key in the Pi process environment to enable quota display:

```text
ZCODE_ADMIN_KEY=<your bridge admin key>
```

For the portable setup, put it in a local file under `agent/secrets/`, for example `zcode.env`. Do not commit that file.

The extension then refreshes quota information every 60 seconds and shows it in Pi's status bar. Run this command for a full account-by-account view:

```text
/zcode-quota
```

It reads the bridge's authenticated `/admin/api/accounts` endpoint and displays remaining units, effective time, and expiry time when the bridge provides those fields.

## Thinking levels

The extension maps Pi's `max` level to the bridge's `max` value. The model currently exposes `low`, `high`, and `max` after Pi normalizes the mapping.

## Security and scope

Do not commit API keys, JWTs, `accounts.db`, bridge logs, or `.env` files. Use only accounts and services you are authorized to use, and follow the applicable ZCode and bridge project terms.

This is an independent community extension, not an official ZCode or Pi provider.
