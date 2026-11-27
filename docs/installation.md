# Install and connect CorpGate

This guide explains how to inspect an existing AI client configuration, start CorpGate safely, verify an existing corporate `BASE_URL` or provider upstream independently, and connect the proxy and MCP without breaking your active client. See [Architecture](architecture.md) for protocol and security invariants.

## Before changing a working AI client

Keep the client working while you prepare CorpGate. Once its model endpoint points at localhost, a stopped or misconfigured gateway stops the AI from replying. Have the [recovery guide](recovery.md) available outside the AI conversation and dashboard before cutover.

Both a person and an AI installer follow the same sequence. `setup` prints instructions only; it does not edit client files, register autostart, make backups, or start the server. An AI may perform the printed steps separately within the user's installation request.

| Step | Required result |
|---|---|
| Inspect the existing connection | Actual client/version, effective `BASE_URL` / endpoint, and the source that sets it are known |
| Prepare and start CorpGate | Server is ready in the user's appropriate OS session |
| Configure the dashboard connection | Its upstream (**Where requests go**) is the client's previous working endpoint |
| Check the route independently | The intended provider/model works through CorpGate; masking and restoration are checked with synthetic values |
| Prepare recovery | Original setting, its source, new local URL, and undo instructions are saved without credentials |
| Configure client proxy and MCP | Only the intended settings change; authentication, model, and unrelated settings are preserved |
| Reopen and check the client | The effective endpoint and actual exchange are verified in a new client session |

## Find the existing connection

Do not assume the client uses a public provider address or that the user remembers configuring one. Find what controls the running client: user/project/local configuration, organization-managed settings, process and persistent environment variables, CLI flags, IDE settings, or a launcher. Check precedence for the installed client version. If the effective endpoint or authentication source remains unknown, resolve it before editing anything.

For Claude Code, inspect the effective `ANTHROPIC_BASE_URL` and relevant settings, including `~/.claude/settings.json`, project `.claude/settings.json`, `.claude/settings.local.json`, environment variables, and managed sources. Do not edit organization-managed policy. Refer to the client's [settings documentation](https://code.claude.com/docs/en/settings) and [gateway documentation](https://code.claude.com/docs/en/llm-gateway).

Record the endpoint including its path, the exact configuration source/key/scope, and the authentication source (name/reference only). Preserve model identifiers, gateway-specific headers, and network/TLS settings. Never copy credentials into this guide, chat, or recovery notes.

### Example: preserving a corporate LiteLLM gateway

| Before | After |
|---|---|
| Client -> `https://litellm.corp.example` -> model | Client -> CorpGate local connection -> `https://litellm.corp.example` -> model |

First enter the existing effective URL in the CorpGate connection's **Where requests go** field. Keep the corporate gateway credential and model settings intact. Verify that route with `probe`. Only then replace the client endpoint in its effective source with the local URL shown by CorpGate. Never replace an existing gateway with a guessed public provider URL or append `/v1` blindly. Resolve any managed destination restriction through your organization rather than bypassing policy.

## Commands

User-facing commands run via standard `npx`, available on the user's `PATH`:

```text
npx -y corp-gate setup
npx -y corp-gate start
npx -y corp-gate open
npx -y corp-gate status
npx -y corp-gate stop
npx -y corp-gate doctor
```

`setup --client codex`, `setup --client claude`, and `setup --client cursor` select printed client guidance. Flags such as `--config`, `--apply`, `--dry-run`, and `--autostart` are rejected by `setup`. Diagnostics (`doctor`) never modify client settings or print secret values.

Node.js (`>=22.13.0`), npm, and npx must be installed and available in the context that starts the server. A terminal working today does not guarantee that a login task shares the same `PATH` after reboot. Verify the chosen startup mechanism and package availability before relying on offline or login execution.

### Agent launch on Windows

An AI installer on Windows must launch the server through Task Scheduler in the current user's interactive session. The task invokes ordinary `npx -y corp-gate start` (or `npx corp-gate start`); it must not hardcode an absolute Node, npx, repository, or npm-cache path, and no PowerShell helper scripts are used.

This immediate interactive launch is distinct from login autostart: a user can choose a Startup shortcut for reboot while the AI still uses the interactive task to start the current server. Never substitute a detached child process inside an agent sandbox. On policy failure, report the exact failure without silently trying another persistence mechanism.

### macOS, Linux, and headless environments

macOS start uses an on-demand user LaunchAgent in `gui/<uid>`; login autostart is enabled separately. Linux immediate start uses a transient systemd user service and requires an active graphical user-systemd session. Linux XDG autostart supports desktop login without systemd, but immediate non-systemd OS-brokered start is not implemented: configure the chosen XDG entry and sign out/in. Browser/input opening requires an active logged-in desktop session.

**Headless Linux / Docker / WSL2 without D-Bus:** OS-level secret encryption (`isSecret`) uses `@napi-rs/keyring` via desktop `Secret Service` (D-Bus). In headless servers, containers, or WSL2 instances without an active Secret Service / D-Bus session, OS keyring protection is unavailable (`ProtectedStorage.isAvailable()` returns `false`), new entries fall back to unencrypted storage (`isSecret = false`), and encrypted entries require a running keyring daemon or per-variable encryption toggle.

## Choose login autostart

An AI installer must ask before registering autostart. Run `npx -y corp-gate autostart` to see options for the current OS. Prompt wording: **Autostart starts CorpGate after reboot/login. Without it, run `npx -y corp-gate start` after each reboot.**

| Platform | Explicit choice |
|---|---|
| Windows | `npx -y corp-gate autostart shortcut` |
| Windows | `npx -y corp-gate autostart scheduler` |
| Windows | `npx -y corp-gate autostart registry` |
| macOS | `npx -y corp-gate autostart launchagent` |
| Linux desktop | `npx -y corp-gate autostart xdg` |
| Linux with user systemd | `npx -y corp-gate autostart systemd` |
| All | `npx -y corp-gate autostart off` |

`shortcut` creates a `.lnk` in the current user's Windows Startup folder. Registration is idempotent, applies only to the chosen mechanism, and is separate from immediate launch. `off` removes CorpGate's owned registration without stopping an already running server. Unsupported or denied modes return a clear error without silently switching mechanisms.

## Configure and verify the dashboard

Open the authenticated dashboard via `npx -y corp-gate open` (which sets the 30-day `cg_session` cookie using `~/.corpgate/admin.token` on `http://127.0.0.1:8767/dashboard`). Create or select the target connection, enter the prior upstream URL, and open **How to connect** for its exact local address.

Run the standalone route probe before editing the client:

```text
npx -y corp-gate probe --connection PREFIX --model MODEL --api-format anthropic --credential-env EXISTING_CREDENTIAL_VARIABLE
```

Use `--api-format openai` for OpenAI-compatible formats. Replace placeholders with the real route prefix, model, and the name of an already available credential environment variable (never pass the secret value itself). Optional `--endpoint PATH` supplies the exact local route path. `--credential-header` accepts `authorization`, `x-api-key`, or `api-key`; `--credential-prefix` sets the header prefix such as `"Bearer "`. The probe registers a temporary synthetic variable and session, verifies masking and restoration end-to-end, cleans up only its own records, and exits nonzero on failure.

Do not cut over based solely on `/api/health`, a saved route, or a browser launch attempt. If the probe fails, keep the working client unchanged and fix the CorpGate or upstream configuration first.

## Prepare undo, then connect the client

Before editing client settings, record the rollback details in an offline-readable file such as `~/.corpgate/RECOVERY.md`:

```text
Client and scope:
Configuration source and exact key/variable:
Previous model endpoint:
CorpGate connection local endpoint:
CorpGate port/data directory if customized:
Authentication source (name/reference, no value):
Exact steps to restore only the changed setting:
When the client must be reopened:
```

Preserve unrelated settings and existing credentials. Edit only the owned entries instead of overwriting an entire config file with a template.

Configure proxy traffic and MCP as separate settings. MCP exposes `corpgate_list_variables`, `corpgate_open_dashboard`, and `corpgate_request_secret_input` (`set`); it does not redirect model traffic by itself. Apply the printed client-specific MCP configuration without modifying other servers. Reopen the client if needed and verify a real model exchange in the dashboard. An interrupted request is not replayed automatically on restart — retry it in the client.

## Optional agent skill

The repository and npm package include `skills/corp-gate/` (`SKILL.md` and `references/setup-and-recovery.md`). This source folder sits outside automatic discovery paths and is never installed automatically. An agent may offer to install it after the user selects a scope.

Copy the entire folder, preserving its `references/` directory, to one chosen destination:

| Client | Project scope | User scope |
|---|---|---|
| Codex | `.agents/skills/corp-gate/` | `~/.agents/skills/corp-gate/` |
| Claude Code | `.claude/skills/corp-gate/` | `~/.claude/skills/corp-gate/` |
| OpenCode | `.opencode/skills/corp-gate/` | `~/.config/opencode/skills/corp-gate/` |

Preserve any existing skill and resolve naming conflicts before overwriting. Deliberate installation enables normal skill selection; it does not configure MCP or model traffic. Sources: [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills](https://code.claude.com/docs/en/skills#choose-where-skills-load), [OpenCode skills](https://opencode.ai/docs/skills/).

## Ports and data

Default host/port: `127.0.0.1:8767`. Override at startup with `--port` or `CORPGATE_PORT`; the dashboard has no port control, and there is no silent fallback when a port is busy. Proxy, MCP, startup, and recovery must use the same port, `--data-dir` (`CORPGATE_DATA_DIR`), and `--db` (`CORPGATE_DB_PATH`).

Default data directory is `~/.corpgate`; default database is `~/.corpgate/vault.db`. Manual Vault values, rules, connections, and auto-detected variables (`auto_secrets`, 10-day TTL from last detection) persist in SQLite; only latest-call session monitoring lives in process memory and clears on restart. Never delete Vault or database files to troubleshoot a connection issue. See [Recovery](recovery.md) before stopping a working gateway.
