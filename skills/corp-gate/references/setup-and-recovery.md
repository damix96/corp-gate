# Setup and recovery

Read this reference when installing CorpGate, changing a model connection or repairing one. The client can lose model access immediately after an endpoint edit; prepare recovery while its original connection still works.

## Before changing the client

1. Identify the OS, client/version and effective working model connection. Inspect relevant user/project/local/managed configuration, process and persistent environment, CLI arguments, IDE settings and corporate launchers, including their precedence. Do not assume vendor defaults or that the person configured the connection themselves. Resolve unknown or conflicting settings before editing; do not bypass managed policy.
2. Record the existing upstream URL including its path, provider/model and authentication source, plus the exact configuration source/key/scope to change. Preserve credential sources, provider parameters and corporate TLS/network settings. Do not print credentials in chat or recovery notes.
3. Run `npx corp-gate setup` for instructions; it changes nothing. Ask which autostart method the person wants before registering anything. Autostart starts the server after reboot/login; without it they need `npx corp-gate start` after each reboot. Use only the chosen method, and stop on a policy rejection.
4. Run `npx corp-gate start`, then `npx corp-gate status`. Start uses the OS user-session mechanism: on Windows an agent must launch through the interactive scheduled task, never a detached server inside its sandbox. Do not replace this with direct Node execution or PowerShell. Desktop/browser visibility still depends on the host graphical session.
5. Open the dashboard, normally `http://127.0.0.1:8767/dashboard`. FIRST set the connection's **Where requests go** field to the OLD effective client URL. For an existing corporate LiteLLM gateway, use that gateway, not a guessed vendor endpoint. Copy the generated local connection URL exactly; do not append `/v1` blindly or make an upstream loop back to CorpGate.
6. Run `npx corp-gate doctor`, then independently test the saved route before changing the working client. For example, `npx corp-gate probe --connection PREFIX --model MODEL --api-format anthropic`, using the actual connection prefix/model. Use `--api-format openai` for that format and `--endpoint PATH` when the existing request path requires it. Preserve authentication with `--credential-env ENV_NAME`; when needed, choose `authorization` or `x-api-key` for `--credential-header` and set `--credential-prefix PREFIX`. Pass an environment variable name, never its credential value. A Bearer prefix is `"Bearer "`. Doctor is read-only; probe uses temporary synthetic values to check provider connectivity, masking and restoration. A ready dashboard alone does not prove those checks.
7. Save an offline-readable recovery note (such as `~/.corpgate/RECOVERY.md`): exact original configuration source/key/scope, original URL, generated CorpGate URL, chosen autostart method, start/status commands and the narrow endpoint edit to undo. The person must be able to read it without the AI or dashboard. Keep credentials out.
8. Only after the route test succeeds, change the selected effective client endpoint to the generated local URL, preserving unrelated settings. Add MCP separately using the intended client's printed instructions, for example `npx corp-gate setup --client claude`; other supported client names are `codex` and `cursor`. Merge only the CorpGate entry. Reopen/restart the client as required and test a new session.

Autostart choices are `shortcut`, `scheduler`, `registry`, `off` on Windows; `launchagent`, `off` on macOS; `xdg`, `systemd`, `off` on Linux where the desktop supports that method. `npx corp-gate autostart` prints or presents the available choices; an automated installer must obtain a choice before executing `npx corp-gate autostart METHOD`. Registration is separate from starting now; `off` does not stop a running server.

## When the client stops working

- After an endpoint edit: check status, start CorpGate if needed, and check that the dashboard connection uses the recorded old upstream. If cutover was premature, restore only the recorded endpoint in its original configuration source and reopen the client. Do not silently send a secret-containing conversation directly to the provider.
- After closing/reopening a client or terminal: check the server and effective settings again. A temporary shell override may have disappeared. Closing a dashboard tab does not stop the server.
- After reboot, crash or a manual stop: use `npx corp-gate start`, check status, then retry. Review the chosen autostart registration if necessary. Saved manual values/settings remain; automatic values and last-call monitoring can be lost on restart.
- If launch fails: check Node/npm/npx availability in the launcher's PATH, package/cache/network availability and the OS graphical session. Do not assume an offline npx cache exists, request elevation or try alternate persistence methods after policy denial.

Default port is 8767. A custom `--port` overrides `CORPGATE_PORT`; use the same port, `--data-dir` and `--db` for start/status/stop/MCP/autostart. There is no silent fallback port or dashboard control to change it. Do not delete the Vault or identity files as a connection repair.

## Optional skill installation

The bundled `skills/corp-gate/` folder is a source artifact, not an automatic installation. Offer installation for the intended client and ask for project or user scope. After the person chooses, copy the entire folder, including this reference, to one appropriate destination; preserve any existing skill and resolve a conflict before overwriting it.

| Local client | Project destination | User destination |
|---|---|---|
| Codex | `.agents/skills/corp-gate/` | `~/.agents/skills/corp-gate/` |
| Claude Code | `.claude/skills/corp-gate/` | `~/.claude/skills/corp-gate/` |
| OpenCode | `.opencode/skills/corp-gate/` | `~/.config/opencode/skills/corp-gate/` |

These are local client locations, not universal paths for cloud sessions or other products. Check the installed client's current discovery rules. Once deliberately installed, normal automatic skill selection is allowed; installation does not configure MCP or model traffic.

Sources: [Codex skill locations](https://learn.chatgpt.com/docs/build-skills), [Claude Code skill locations](https://code.claude.com/docs/en/skills#choose-where-skills-load), [OpenCode skill discovery](https://opencode.ai/docs/skills/).
