import { RuntimeSettings } from '../runtime/settings.js';
import { ClientConfigInstaller, ClientKind } from './config.js';

export class SetupInstructions {
  constructor(private settings: RuntimeSettings, private configurations: ClientConfigInstaller) {}

  public render = (client?: ClientKind): string => [
    'CorpGate setup instructions (nothing has been changed)',
    '',
    '1. Find the connection the AI client actually uses now.',
    'Check all relevant sources and their precedence: user/project/local/managed configuration, environment variables, command-line arguments, IDE settings and corporate launchers. Do not assume a default provider or that the user configured it personally.',
    'For Claude Code inspect ANTHROPIC_BASE_URL and its source, ~/.claude/settings.json, project .claude/settings.json and .claude/settings.local.json, plus organization-managed settings. Other providers may use provider-specific endpoint settings. Do not override a managed destination.',
    'Record the current effective base URL including its path, model/provider, authentication source and the exact source/key/scope you will change. Do not print or copy credential values into chat or recovery notes. If the active connection is unclear, resolve it before editing.',
    '',
    '2. Choose autostart with the user before registering anything.',
    'Autostart starts CorpGate after reboot and login. Without it, run npx corp-gate start after each reboot.',
    'Run npx corp-gate autostart to see the options. A noninteractive installer must obtain the user choice first and execute only that choice. A policy rejection is an error, not permission to try another method.',
    '',
    '3. Start CorpGate and open its dashboard before changing the AI client.',
    'Run npx corp-gate start, then npx corp-gate status. On Windows an AI agent must use the interactive Task Scheduler launch path; never start a background Node process or use PowerShell scripts.',
    'Dashboard: ' + this.settings.url + '/dashboard (or run npx corp-gate open to launch an authenticated session in your browser)',
    'In the dashboard create/select a connection and FIRST put the old effective client base URL into "Where requests go". For an existing LiteLLM gateway this is the existing LiteLLM address, not the default vendor API.',
    'Preserve authentication, model/provider settings, URL path and corporate network/TLS configuration. Use the generated local connection URL exactly; do not blindly append /v1 or route CorpGate back to itself.',
    'Run npx corp-gate doctor, then test the saved connection: npx corp-gate probe --connection PREFIX --model MODEL --api-format anthropic|openai. Use your existing model; --endpoint PATH preserves an unusual exact local request path. If needed use --credential-env NAME --credential-header authorization|x-api-key --credential-prefix PREFIX; never pass a key value as an argument. For a Bearer token the prefix is "Bearer ". A running dashboard or /health response alone does not prove the provider connection or masking works.',
    '',
    '4. Prepare recovery instructions while the original client still works.',
    'Save an offline-readable note with: client configuration source/key/scope; original URL; generated CorpGate URL; chosen autostart; npx corp-gate start; npx corp-gate status; and the exact endpoint edit to undo. Keep credentials out of it.',
    'If AI stops replying after a config edit, reopen or reboot: check CorpGate status, start the server, inspect the connection in the dashboard, then retry the request. If cutover was premature, restore only the recorded endpoint at its original source before restarting the client.',
    'Closing the dashboard tab is not stopping the server. Reopening the client may lose temporary environment overrides. Restart clears in-memory last-call monitoring only; manual saved values, rules, connections, settings, and auto-detected values (10-day TTL) persist in SQLite.',
    '',
    '5. Only after the route test succeeds, change the selected client endpoint to the generated local URL. Preserve all unrelated configuration. Reopen/restart the client if required and check a new session.',
    'Add MCP separately using the relevant fragment below. MCP discovers variable names; it does not redirect or mask model traffic by itself. Merge only the CorpGate entry; do not replace the whole configuration file.',
    ...this.fragments(client),
    '',
    'Optional: install the CorpGate agent skill for this project or your chosen client. Choose the client and project/user scope first; setup does not install it. The package includes skills/corp-gate/SKILL.md and its references. Use your client\'s documented skill location; do not overwrite an existing skill or assume every client uses the same folder.',
    '',
    'Runtime: default http://127.0.0.1:8767; --port overrides CORPGATE_PORT. Use the same --port, --data-dir and --db for start/status/stop/MCP/autostart. No automatic fallback port. Current data directory: ' + this.settings.dataDir,
    'Help and local recovery: npx corp-gate setup; npx corp-gate status. Do not delete the Vault to fix a connection problem.',
  ].join('\n');

  private fragments = (client?: ClientKind): string[] => (client ? [client] : ['codex', 'claude', 'cursor'] as ClientKind[]).flatMap(kind => [
    '',
    kind === 'codex' ? 'Codex MCP: ~/.codex/config.toml (or the effective CODEX_HOME configuration). Check applicable project/managed overrides.' : kind === 'claude' ? 'Claude Code MCP: ~/.claude.json or project .mcp.json; this is separate from Claude model settings. Use the scope supported by your client version.' : 'Cursor MCP: ~/.cursor/mcp.json or project .cursor/mcp.json. Check managed policy and the current client version.',
    this.configurations.install(kind).content,
  ]);
}
