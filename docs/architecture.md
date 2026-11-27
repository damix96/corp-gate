# CorpGate Architecture

Technical specification of CorpGate: Client-Daemon Singleton runtime, `BASE_URL` proxy routing, zero-knowledge symbolic variables, recursive JSON/SSE codecs, encrypted Vault storage, and local daemon security boundaries.

## 1. Client-Daemon Singleton Pattern and `BASE_URL` Routing

CorpGate separates execution into a single long-lived user-session daemon (`CorpGateProxyServer` on `127.0.0.1:8767`) and lightweight client adapters (`npx corp-gate mcp-bridge` over stdio):

```text
[ AI Client 1: Claude Code ] --\
[ AI Client 2: Codex CLI   ] ---+--> [ CorpGate Daemon (127.0.0.1:8767) ] --> [ Corporate LiteLLM / Upstream API ]
[ AI Client 3: Cursor/IDE  ] --/      - SQLite WAL: ~/.corpgate/vault.db
                                      - Dashboard:  http://127.0.0.1:8767/dashboard
                                      - MCP:        POST /mcp (Bearer ~/.corpgate/mcp-token)
```

- **Explicit routing (`RouteRegistry` / `SessionResolver`):** Only explicitly configured connection prefixes are routed; unknown paths return `404` (`Route not configured in CorpGate`) with no fallback to any default external provider.
- **No body limit:** `Fastify` is configured with `bodyLimit: Number.MAX_SAFE_INTEGER`.
- **Upstream header forwarding (`ResponseHeaders.apply`):** Forwards upstream response headers verbatim while stripping only hop-by-hop/framing headers (`connection`, `keep-alive`, `proxy-connection`, `proxy-authenticate`, `proxy-authorization`, `proxy-authentication-info`, `te`, `trailer`, `transfer-encoding`, `upgrade`, `content-length`, `content-encoding`, headers named in `Connection`, `access-control-*`, and `set-cookie`).

### Architectural Choice: `BASE_URL` vs. `HTTPS_PROXY`

- **WHY:** Intercepting outbound TLS via `HTTPS_PROXY` requires generating and trusting a local root CA across OS stores, Node (`NODE_EXTRA_CA_CERTS`), and Python (`SSL_CERT_FILE`), and triggers corporate EDR/DLP alerts for TLS MITM inspection.
- **FOR WHAT:** Zero-friction traffic interception that preserves corporate TLS trust chains and corporate gateway routing (LiteLLM, Azure OpenAI, Bedrock/Vertex gateways, internal AI proxies).
- **HOW:** Clients send plain loopback HTTP to `http://127.0.0.1:8767/<connection>`, while CorpGate masks payloads and opens standard outbound HTTPS connections to the configured upstream using the host's trusted CA store.
- **WHY NOT OTHERWISE:** System-wide `HTTPS_PROXY` requires `CONNECT` tunneling, per-runtime certificate overrides, and fails under corporate endpoints enforcing certificate pinning or proxy rules.

## 2. Zero-Knowledge Symbolic Variables

Symbolic token format: `$${<IDENTIFIER>}` (`IDENTIFIER` strictly `[A-Z0-9_]+`, reverse match `/\$\$\{<([A-Z0-9_]+)>\}/g`).

```text
[Local CLI / Tool Output] "curl https://internal.corp.example/api/v1/users"
           |
           v  Outbound: PayloadCodec + TextReplacer + PatternEngine (re2js)
[Outbound to LLM / BASE_URL] "curl $${<CORP_API_URL>}/users"
           |
           v  Inbound: SSE / Tool Call Arguments + SlidingStreamTransformer
[Delivered to Local CLI] "curl https://internal.corp.example/api/v1/users"
```

- **Non-destructive semantics:** Unlike `***` or `[REDACTED]`, `$${<CORP_API_URL>}` preserves URL and CLI syntax so the model can compose valid tool calls.
- **Template and DLP neutrality:** `$${<...>}` avoids collisions with Bash (`${VAR}`), Jinja/Helm (`{{ var }}`), Terraform, and PHP, and contains no domain TLDs, URL schemes, IP octets, or high-entropy blobs.
- **Stable names & prompt caching:** Updating a secret's value preserves its `$${<KEY>}` token; rotating credentials or container ports does not invalidate byte-prefix prompt caches on Anthropic or OpenAI. Renaming a key updates the token name across references.

### Pre-computed Representations (`SecretRepresentations`)

When a secret `S` is registered, CorpGate pre-computes distinct string representations (`src/vault/secret-representations.ts`):
1. `raw` (`$${<KEY>}`)
2. `urlEncoded` (`encodeURIComponent(S)`, `$${<KEY__GV_URL>}`)
3. `jsonEscaped` (`S.replace(/\//g, '\\/')`, `$${<KEY__GV_SLASH>}`)
4. `base64` (`Buffer.from(S).toString('base64')`, `$${<KEY__GV_BASE64>}`)
5. JSON string escaping (without outer quotes) at depths 1, 2, and 3, plus slash-escaped variants (`JSON1..3`, `JSON_SLASH1..3`, `SLASH_JSON1..3`).

- **WHY:** A single secret can appear inside raw text, URL-encoded bodies, Base64 Basic Auth (`user:pass`), and nested JSON logs within the same request.
- **FOR WHAT:** Byte-exact round-trip restoration without distorting surrounding escaping levels.
- **HOW:** Distinct non-raw forms receive dedicated suffixes mapped in an in-memory reverse table; identical forms are deduplicated, and canonical aliases are reserved before assigning suffix variants (resolving collisions with numeric suffixes). Unpaired UTF-16 surrogates are rejected with `400` (`INVALID_SECRET_INPUT`).
- **WHY NOT OTHERWISE:** Sharing one alias across raw and encoded forms loses encoding metadata and corrupts output on restoration.

## 3. Recursive JSON Masking, Streaming, and Module Map

| Layer / Module | Responsibility |
|---|---|
| `src/protocols/payload-codec.ts` (`PayloadCodec.walk`) | Recursive traversal of all JSON string values without unmasked passthrough; non-JSON string bodies undergo `transform(body)` directly; cycles guarded via `WeakMap`. |
| `SERVICE_KEYS` (`inPayloadContent = false`) | Clones protocol metadata untouched (`model`, `role`, `type`, `id`, `object`, `finish_reason`, `stop_reason`, `stop_sequence`, `index`, `encoding_format`, `tool_call_id`, `call_id`, `status`, `event`, `created`, `usage`, `signature`); skips media data URIs (`data:image/\|audio/\|video/\|application/pdf`) and `base64`/`inlineData` binary blocks. |
| `inPayloadContent = true` | Activated inside `arguments` (parsed JSON or raw string), Anthropic `tool_use.input`, and Gemini `functionCall.args` / `functionResponse.response`. `SERVICE_KEYS` are **not** skipped and **object property keys** are transformed (`transform(entryKey)`). |
| `src/proxy/sliding-buffer.ts` (`SlidingStreamTransformer`) | Request-scoped buffer per `StreamRelay.run()`. Holds only the longest matching prefix of an incomplete `$${<...>}` token and never splits UTF-16 surrogate pairs across emitted chunks. |
| `src/vault/text-replacer.ts` & `src/vault/pattern-engine.ts` | Non-overlapping replacement of pre-computed representations (`indexOf`) and linear-time `re2js` scanning, protecting existing `$${<...>}` aliases from double-wrapping. |

### Supported Streaming Protocol Families

| Protocol Family | Streamed / Buffered Targets | Stream Isolation Behavior |
|---|---|---|
| OpenAI Chat Completions | `choices[].delta` (`content`, `refusal`, `reasoning_content` / `reasoning`), `tool_calls[].function.arguments`, `function_call.arguments` | Buffers arguments per `choice`/`tool` index; passes text deltas through `SlidingStreamTransformer`. |
| OpenAI Responses | `response.output_text.delta`, `response.refusal.delta`, `response.reasoning_summary_text.delta`, `response.function_call_arguments.delta`, `done` / `completed` | Maintains monotonic `sequence_number` across emitted events; unmasks arguments on block completion. |
| Anthropic Messages | `content_block_start`, `content_block_delta` (`text_delta`, `thinking_delta`, `input_json_delta`), `content_block_stop` | Buffers `input_json_delta` until `content_block_stop`; unmasks text deltas on the fly. |
| Gemini / Antigravity | `candidates[].content.parts` (including `request`/`response` wrapper), text/code parts, `functionCall` / `functionResponse` | Processes complete SSE JSON chunks recursively while preserving protocol service keys. |

- **WHY:** Field allowlists miss new provider keys, and raw-text regex replacement breaks JSON escaping or splits tokens across SSE chunks.
- **FOR WHAT:** Complete masking coverage across arbitrary JSON payloads and clean real-time restoration in streamed replies and tool calls.
- **HOW:** `PayloadCodec` separates protocol framing (`SERVICE_KEYS` outside tool payloads) from user/tool content (`inPayloadContent = true`), while `SseTransformer` isolates stream buffers per HTTP call.
- **WHY NOT OTHERWISE:** Global skipping of `SERVICE_KEYS` or ignoring object keys would leak fields named `id`, `status`, or secret keys inside tool outputs.

## 4. Detection Engine and Conflict Resolution

1. **Manual before Auto:** Manual Vault entries (`TextReplacer`) always run first with **Longest Match First** priority, preventing partial replacement of URL prefixes or composite credentials. Restored inbound values are never re-scanned as aliases.
2. **Linear-time Auto-Detection (`PatternEngine` + `re2js`):** Scans remaining outbound text after manual masking. All patterns compile via `RE2JS.compile` ($O(N)$ execution, eliminating ReDoS; lookahead, lookbehind, and backreferences are rejected by `PatternEngine.validateRegex`).
3. **Starter Rules:** Built-in rules cover internal URLs (`pat_internal_urls`), database URIs (`pat_database_uri`), API keys/Bearer tokens (`pat_api_keys`), RFC1918 private networks (`10.*`, `172.16-31.*`, `192.168.*` without masking `127.0.0.1`, `0.0.0.0`, or `8.8.8.8`), and `ENV`-style assignments (`pat_env_like` -> `AUTO_ENV_<NAME>`, filtering placeholders and existing `$${<...>}` tokens).
4. **Independent Lifecycle:** Disabling or deleting a rule stops future matches without deleting already registered secrets; evicting a monitoring session never removes secrets, rules, or routes.

## 5. Persistent Vault and In-Memory Session Retention

| Data Category | Storage & Lifecycle |
|---|---|
| Manual Vault (`secrets`, `secret_versions`) | SQLite WAL (`~/.corpgate/vault.db`, overridable via `CORPGATE_DB_PATH`). Encrypted by default (`is_secret = 1`) when `ProtectedStorage.isAvailable()` is true. |
| Auto-detected (`auto_secrets`) | SQLite with **10-day TTL** (`AutoSecretStore.TTL_MS`) from `last_seen_at`; encrypted by default when OS keyring is available; removed immediately upon `promote` to manual Vault or expiry cleanup. |
| Rules, routes, aliases, proxy config | Persistent in SQLite (`patterns`, `routes`, `aliases`). |
| Latest-call monitoring (`RuntimeSessions`) | In-memory only (one latest call snapshot per `sessionId`, never written to SQLite). Soft **200 MB** (`200_000_000` UTF-8 bytes) LRU budget; active calls (`activeCalls > 0`) and the last remaining session are never evicted. |

### OS-Protected Storage (`ProtectedStorage`)

- **WHY:** Plaintext secret caches and unencrypted SQLite columns expose keys on disk, while hard-failing without a desktop keyring would break Docker and WSL2.
- **FOR WHAT:** Protect both manual secrets and `auto_secrets` at rest on desktop OSes while staying functional in headless environments.
- **HOW:** Uses Windows `DPAPI` (`@primno/dpapi`), macOS `Keychain` + `AES-256-GCM`, and desktop Linux `Secret Service` (`@napi-rs/keyring`), reinforced with `PRAGMA secure_delete = ON`, SQLite triggers (`secrets_protected_*` / `auto_secrets_protected_*` forbidding non-empty plaintext `real_value` when `is_secret = 1`), and `VACUUM` on cleanup. On headless Linux/Docker/WSL2 without D-Bus, `ProtectedStorage.isAvailable()` returns `false` and entries fall back transparently to unencrypted storage (`is_secret = 0`).
- **WHY NOT OTHERWISE:** Storing `auto_secrets` in plaintext leaves intercepted tokens exposed for up to 10 days; truncating session bodies on disk would corrupt JSON and exhaust storage from repeated conversation histories.

### Core Data Contracts and Constants

```ts
export interface SecretEntry {
  key: string;
  realValue: string;
  alias: string;
  maskInAi: boolean;
  isSecret?: boolean;
  description?: string;
  variants: {
    [format: string]: string;
    raw: string;
    urlEncoded: string;
    jsonEscaped: string;
    base64: string;
    jsonStringEscaped: string;
    jsonSlashEscaped: string;
  };
  createdAt: string;
  updatedAt: string;
}
```

- `RuntimeSessions.budgetBytes = 200_000_000` (200 MB UTF-8 JSON budget in memory)
- `AutoSecretStore.TTL_MS = 10 * 24 * 60 * 60 * 1000` (10-day TTL from `last_seen_at`)
- `RuntimeSettings`: `host = '127.0.0.1'`, default `port = 8767` (`CORPGATE_PORT`), `dataDir = '~/.corpgate'` (`CORPGATE_DATA_DIR`), `databasePath = '~/.corpgate/vault.db'` (`CORPGATE_DB_PATH`), `adminTokenPath = '~/.corpgate/admin.token'`, `tokenPath = '~/.corpgate/mcp-token'`

## 6. MCP Interface, Web Dashboard, and Daemon Security Boundaries

### MCP Tool Surface (`VaultCatalogServer` on `POST /mcp`)

| Tool | Role & Guardrails |
|---|---|
| `corpgate_list_variables` | Read-only discovery of manual (and optionally automatic) variable names and descriptions; never returns secret values. |
| `corpgate_open_dashboard` | Opens the local dashboard via `/?token=...` (`tab`: `overview`, `vault`, or `rules`). |
| `corpgate_request_secret_input` | Requests local human browser input (`operation: "set"`, `idempotencyKey`, 10-minute expiry); never accepts secret values via MCP args. |
| `corpgate_secret_input_status` | Reads request metadata (`pending`, `committing`, `completed`, `failed`, `cancelled`, `expired`) without returning entered values. |
| `corpgate_cancel_secret_input` | Cancels a pending input request without modifying Vault entries. |

### Web Dashboard and Security Controls

- **Dashboard stack (`web/`):** React 19, TypeScript, Vite, `@mantine/core` (zero custom `.css`, zero `className`/`style`, zero raw HTML tags), reactive `EN`/`RU` localization (`EN` default), and versioned configuration export (`GET /api/export`, `format: 'corpgate-settings'`) with protected secrets redacted and runtime session snapshots excluded.
- **WHY:** A daemon listening on `127.0.0.1:8767` is reachable by any local process and vulnerable to browser CSRF / DNS rebinding if unauthenticated or permissive on `Origin`.
- **FOR WHAT:** Block unauthorized local processes and third-party browser tabs from reading secrets or altering routes while avoiding password prompts.
- **HOW:**
  - **Dashboard & Admin API (`AdminAccess`):** Bound strictly to `127.0.0.1`. Protected by persistent `~/.corpgate/admin.token` (`0o600`, Jupyter-style `/?token=...` bootstrap via `npx corp-gate open` or `corpgate_open_dashboard`), issuing a 30-day `HttpOnly; SameSite=Strict; Path=/` cookie `cg_session` (`Max-Age=2592000`) and redirecting to strip the token from the URL. Requests without a valid cookie or `Authorization: Bearer <adminToken>` receive `401`. Loopback `Host`/port, `sec-fetch-site` (`same-origin` or `none`), and `Origin` are validated on every request.
  - **Unredacted UI reads (`InterfaceApi`):** `/api/interface/vault`, `/api/interface/sessions/:id`, and `/api/interface/events` require an active `cg_session` (or bearer token) plus `sec-fetch-site: same-origin` (GET/SSE) or matching `Origin` + `x-corpgate-display: original` (POST). `/api/export` and standard `/api/*` responses redact protected values via `SecretProjection` / `SecretRedactor`.
  - **MCP Endpoint (`McpAccessPolicy`):** Accepts `POST` only (`405` otherwise), enforces loopback `remoteAddress` and `Host`/port, rejects any request with a browser `Origin` (closed CORS), and verifies `Authorization: Bearer <mcpToken>` against `~/.corpgate/mcp-token` (`0o600`) with `timingSafeEqual`.
  - **No user hook sandbox:** User-authored hook execution is excluded from runtime; only programmatic internal `HookManager` hooks exist.
- **WHY NOT OTHERWISE:** Skipping auth for `!origin` requests leaves `/api/*` open to arbitrary local scripts; adding a login password degrades UX without improving security over `0o600` local tokens.

**Threat boundary:** CorpGate mitigates **accidental** secret leaks to cloud LLMs. It does not defend against deliberate steganography by an adversarial local agent, direct outbound connections bypassing the proxy, or processes running under the same compromised OS user with permission to read `~/.corpgate/admin.token`.
