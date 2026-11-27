# Changelog

All notable changes to CorpGate are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-11-27

### Added
- Interactive `corp-gate init` command to discover overridden `BASE_URL` entries across environment variables, Claude Code (`settings.json`), OpenCode (`opencode.json`), and Codex CLI (`config.toml`), create full backups + `~/.corpgate/RECOVERY.md`, register routes in CorpGate, and atomically rewire selected configs (with one-line shell fallback for env variables).
- `corp-gate restore` command to roll back modified client configs from `~/.corpgate/backups/init-manifest.json`.
- Expanded corporate use cases, visual before/after JSON masking example, status badges, and npm/GitHub discovery keywords.

## [1.0.1] - 2026-11-27

### Added
- Per-connection proxy routing (`direct`, `system`, `custom`) with `NO_PROXY` matching via cached `undici.ProxyAgent` and `GET /api/system-proxy`.
- Proxy configuration UI in the connection modal with automatic `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` pre-fill when `System proxy` is selected.
- Built-in JWT detection in `pat_api_keys` with order-independent deduplication tests against `pat_env_like`.

### Security
- Required `cg_session` or `Bearer <adminToken>` on `POST /api/secret-input/session` and `POST /api/secret-input/requests`, using a scoped `HttpOnly` `cg_intake` cookie for active MCP input forms.

### Fixed
- Filtered code expressions (`()`, `[]`, `process.env.`, `os.environ`, `config.`) out of `EnvLikeRule` while preserving dot-separated values such as JWTs.
- Cleaned up legacy `GV_PROBE` text in `probe.ts` and removed the stale internal path from `/api/client-help`.

## [1.0.0] - 2026-11-27

### Added
- Local masking proxy on `127.0.0.1:8767` preserving custom corporate `BASE_URL` upstreams (LiteLLM, Azure OpenAI, Bedrock/Vertex gateways, internal AI proxies, or direct API keys).
- Deterministic zero-knowledge symbolic tokens (`$${<NAME>}`) with pre-computed raw, URL-encoded, Base64, and multi-level JSON-escaped (levels 1-3) representations for byte-exact round-trip restoration.
- Unified recursive JSON masking in `PayloadCodec` (with `inPayloadContent` handling for tool arguments, Anthropic `tool_use.input`, and Gemini `functionCall.args` / `functionResponse.response`, including object key masking) and protocol-aware SSE/tool-call streaming restoration via `SlidingStreamTransformer`.
- Protocol support for OpenAI Chat Completions, OpenAI Responses, Anthropic Messages, Gemini, and the Antigravity wrapper.
- Linear-time `re2js` auto-detection engine (`O(N)`, ReDoS-safe) with starter rules for RFC1918 private IPs, API keys/tokens, database URIs, internal URLs, and `ENV`-style assignments (`AUTO_ENV_<NAME>`), plus custom user rules.
- OS-backed secret encryption (`DPAPI` on Windows, `Keychain` + `AES-256-GCM` on macOS, `Secret Service` on desktop Linux) for both manual Vault entries and `auto_secrets` (10-day TTL), enforced with SQLite `PRAGMA secure_delete = ON`, integrity triggers, `VACUUM` cleanup, and transparent headless fallback.
- Jupyter-style local daemon authentication using `~/.corpgate/admin.token` (`0o600`), 30-day `HttpOnly; SameSite=Strict` `cg_session` cookies, strict loopback `Host`/`Origin`/`sec-fetch-site` validation, and `x-corpgate-display: original` interface checks.
- Authenticated local MCP server (`/mcp`) and stdio bridge (`npx corp-gate mcp-bridge`) protected by `~/.corpgate/mcp-token` (`0o600`, `timingSafeEqual`) and closed CORS, exposing `corpgate_list_variables`, `corpgate_open_dashboard`, `corpgate_request_secret_input`, `corpgate_secret_input_status`, and `corpgate_cancel_secret_input`.
- CLI workflow (`setup`, `start`, `open`, `status`, `doctor`, `probe`, `restart`, `stop`, `autostart`, `mcp-bridge`) with OS-native session startup and optional `skills/corp-gate/` agent skill bundle.
- React + Mantine Web Dashboard with English (default) and Russian localization, sanitized configuration export, and in-memory latest-call monitoring (200 MB LRU budget).
