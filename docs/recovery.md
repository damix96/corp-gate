# AI stopped working after connecting CorpGate

**Open this guide in a browser or text editor. You do not need a working AI session or dashboard to read it.** Keep the installation's local recovery record, recommended `~/.corpgate/RECOVERY.md`, with the exact setting that was changed and the previous endpoint. Prepare that file before switching the client.

When an AI client sends model requests to CorpGate on localhost, it requires both the local daemon and a working upstream connection. A failed model request does not necessarily mean the AI client or corporate provider is broken.

## Start with the situation that matches

| What happened | What to check | What to do |
|---|---|---|
| Settings changed and the AI immediately stopped replying | Was CorpGate running and its connection tested with `probe` before cutover? | Check status, start the server, then verify the dashboard connection. If setup was incomplete, restore the previous client endpoint using `~/.corpgate/RECOVERY.md`. |
| The client or terminal was closed and reopened | Is the server still running? Does the reopened client load the same settings? | Start CorpGate if stopped. Check the recorded config source and any temporary shell overrides; reopen the client after fixing them. |
| The computer rebooted | Did the chosen login autostart actually run? | Run `npx -y corp-gate start` in a normal host terminal, then check `status`. Configure or repair autostart separately if desired. |
| The server was stopped or crashed | Does `status` show stopped or an error? | Start it again and retry the model request. Do not rely on the unavailable AI to start itself. |

Run these commands from a normal host terminal (ensure you use the matching CorpGate version; see [Installation](installation.md) for OS-specific startup):

```text
npx -y corp-gate status
npx -y corp-gate start
npx -y corp-gate open
npx -y corp-gate doctor
```

On Windows, an AI agent must use the registered interactive Task Scheduler mechanism rather than spawning the server inside its sandbox. If the AI is unavailable, the human host terminal path always works.

## If the server is running

1. Open the authenticated dashboard with `npx -y corp-gate open` (default `http://127.0.0.1:8767/dashboard`, or your recorded custom port).
2. Select the target connection. **Where requests go** must contain the old working provider or corporate gateway address. If you use a corporate LiteLLM gateway or internal proxy, that URL stays here while the client points to CorpGate.
3. Compare the connection's local URL against the client's effective endpoint, including any required path. Do not guess `/v1` or replace a corporate gateway with a public vendor API address.
4. Run the standalone route probe from installation (`npx -y corp-gate probe ...`). Local `/api/health` or an open dashboard alone does not prove upstream connectivity. Check VPN/network access, endpoint path, authentication source, and model name if the upstream rejects requests.
5. Retry the AI request after repair. Reopen the client if it reads settings only at startup.

If the client has multiple config sources, editing a lower-priority file may have no effect. Check the recovery record's exact source and key; for Claude Code inspect environment variables, project/user settings, and organization-managed settings. Never modify managed policy or replace credentials just because the endpoint changed.

## If launch itself fails

| Message or symptom | Next step |
|---|---|
| `npx` is not found | Verify Node.js (`>=22.13.0`), npm, and npx are on the current user's `PATH`. Login tasks may inherit a different environment than an interactive shell. |
| npm cannot fetch the package or prompts to install | Verify package name (`corp-gate`), registry access, and local cache. `npx` may require network access; autostart should not hang on an interactive prompt. |
| Port already in use or identity check fails | Check the recorded `--port`, `--data-dir`, and `--db`, and read the exact error. Do not kill unrelated processes or arbitrarily move all clients to a new port. |
| Autostart registration or execution denied | Read the reported error. Do not silently switch between scheduler, registry, or shortcut mechanisms; use only the user's permitted method. |
| Browser did not open | Run `npx -y corp-gate open` from a desktop session or open the printed URL manually on the same machine. Verify the server runs in an active graphical session. |

## Return to the previous working client connection

Use this when CorpGate cannot be repaired immediately. Follow the **exact undo steps** saved in `~/.corpgate/RECOVERY.md`:

1. Locate the original configuration source, key, or environment variable.
2. Restore the recorded previous endpoint while keeping model, authentication, and unrelated settings untouched.
3. Disable or remove only the `corpgate` MCP entry if it blocks client startup; preserve all other MCP servers.
4. Reopen the client if required and confirm its effective destination.

Restoring the previous endpoint bypasses CorpGate masking. Do not automatically resend a conversation that already contains unmasked secrets over the direct route; start a fresh safe prompt instead. Never treat silent direct-provider fallback as an automatic behavior.

If no recovery record exists, inspect the client's actual configuration/environment or ask your corporate gateway administrator for the former URL. Never invent an endpoint or delete Vault, database, or credential files as a troubleshooting step.

## What survives a server restart

Manual Vault variables, rules, connection settings, and auto-detected variables (`auto_secrets`, persisted in SQLite with a 10-day TTL from last detection) survive restarts. Only in-memory latest-call monitoring clears on restart. Never delete `~/.corpgate/vault.db` or token files to fix a client routing problem.
