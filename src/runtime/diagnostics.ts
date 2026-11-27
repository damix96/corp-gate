import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeClient } from './client.js';
import { RuntimeCredentials } from './credentials.js';

export interface DoctorResult { ok: boolean; server: string; dashboard: boolean; mcp: boolean; next: string }

export class RuntimeDiagnostics {
  constructor(private settings: RuntimeSettings) {}
  public doctor = async (): Promise<DoctorResult> => {
    const result: DoctorResult = { ok: false, server: 'stopped', dashboard: false, mcp: false, next: 'Run npx corp-gate start, then npx corp-gate doctor. Before client cutover also test the configured provider with npx corp-gate probe.' };
    try {
      const current = await new RuntimeClient(this.settings).inspect();
      if (!current) return result;
      result.server = current.identity.state;
      if (current.identity.state !== 'ready') return result;
      const credentials = new RuntimeCredentials(this.settings);
      const dashboard = await fetch(this.settings.url + '/dashboard', { signal: AbortSignal.timeout(5000), redirect: 'error' });
      const adminApi = await fetch(this.settings.url + '/api/vault', { headers: { authorization: 'Bearer ' + credentials.readAdminToken() }, signal: AbortSignal.timeout(5000), redirect: 'error' });
      result.dashboard = dashboard.ok && (dashboard.headers.get('content-type') || '').includes('text/html') && adminApi.ok;
      const client = new Client({ name: 'corpgate-doctor', version: this.settings.version });
      try {
        const token = credentials.readMcpToken();
        await client.connect(new StreamableHTTPClientTransport(new URL(this.settings.url + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) } }));
        const tools = await client.listTools();
        const catalog = await client.callTool({ name: 'corpgate_list_variables', arguments: { names: [] } });
        result.mcp = tools.tools.some(tool => tool.name === 'corpgate_list_variables') && !catalog.isError;
      } finally { await client.close(); }
      result.ok = result.dashboard && result.mcp;
      result.next = result.ok ? 'Server, dashboard and MCP are ready. Test the configured provider with npx corp-gate probe before changing the AI client endpoint.' : 'Inspect the dashboard and MCP configuration. Provider access and masking are not proved by this check.';
    } catch { result.server = result.server === 'stopped' ? 'unverified' : result.server; result.next = 'The endpoint or MCP could not be verified. Check the chosen port/data directory and npx corp-gate status; do not delete the Vault or kill an unverified process.'; }
    return result;
  };
}
