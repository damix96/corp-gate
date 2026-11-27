import { randomBytes, randomUUID } from 'node:crypto';
import { RuntimeSettings } from './settings.js';
import { RuntimeClient } from './client.js';
import { RuntimeCredentials } from './credentials.js';

export interface ProbeOptions { connection?: string; model?: string; format?: string; endpoint?: string; credentialEnv?: string; credentialHeader?: string; credentialPrefix?: string }
export interface ProbeResult { ok: boolean; provider: boolean; masked: boolean; restored: boolean; cleanup: boolean; message: string }

export class RuntimeProbe {
  constructor(private settings: RuntimeSettings, private env: NodeJS.ProcessEnv = process.env) {}
  public run = async (options: ProbeOptions): Promise<ProbeResult> => {
    if (!options.connection || !/^[a-z0-9-]+$/.test(options.connection) || !options.model || !['anthropic', 'openai'].includes(options.format || '')) throw new Error('Use probe --connection PREFIX --model MODEL --api-format anthropic|openai. Use the existing model, gateway and credential source.');
    const headers = this.headers(options);
    const current = await new RuntimeClient(this.settings).inspect();
    if (current?.identity.state !== 'ready') throw new Error('CorpGate is not ready. Run npx corp-gate start before probing or changing client settings.');
    const routes = await this.admin('/api/routes') as Array<{ prefix: string; cliUrl: string }>;
    const route = routes.find(item => item.prefix === options.connection);
    if (!route) throw new Error('Connection not found. Configure the former working provider URL in the dashboard first.');
    const base = new URL(route.cliUrl);
    if (base.origin !== this.settings.url) throw new Error('The saved connection does not resolve to this local CorpGate server.');
    const endpoint = this.endpoint(base, options);
    const name = 'CG_PROBE_' + randomBytes(12).toString('hex').toUpperCase();
    const value = 'corpgate-probe-' + randomBytes(24).toString('hex');
    const session = randomUUID();
    let created = false;
    const result: ProbeResult = { ok: false, provider: false, masked: false, restored: false, cleanup: true, message: 'Probe did not complete.' };
    try {
      const saved = await this.admin('/api/vault/secret', { key: name, realValue: value, description: 'Temporary synthetic connection probe' }) as { success: boolean; secret?: { alias?: string } };
      created = saved.success;
      const alias = saved.secret?.alias;
      if (!saved.success || alias !== '$${<' + name + '>}') throw new Error('Could not prepare the synthetic probe variable.');
      const body = { model: options.model, messages: [{ role: 'user', content: 'Reply with exactly the following value, without quotes, explanation or formatting: ' + value }], ...(options.format === 'anthropic' ? { max_tokens: 128 } : {}) };
      const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', 'x-session-id': session, ...(options.format === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000), redirect: 'error' });
      result.provider = response.ok;
      if (!response.ok) throw new Error('The configured provider returned HTTP ' + response.status + '. Check the saved upstream, model and credential source.');
      const payload = await response.json() as any;
      const text = options.format === 'anthropic' ? (Array.isArray(payload.content) ? payload.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('') : '') : payload.choices?.[0]?.message?.content;
      result.restored = typeof text === 'string' && text.trim() === value;
      const calls = await this.admin('/api/sessions/' + encodeURIComponent(session)) as Array<{ sessionId?: string; maskedPrompt?: unknown }>;
      result.masked = calls.length === 1 && calls[0].sessionId === session && typeof calls[0].maskedPrompt === 'string' && calls[0].maskedPrompt.includes(alias) && !calls[0].maskedPrompt.includes(value);
      result.ok = result.provider && result.masked && result.restored;
      result.message = result.ok ? 'Provider request, outbound masking and local value restoration passed. Prepare offline recovery, then change the selected client endpoint.' : 'Provider replied, but masking/restoration proof failed. Do not switch the client; inspect the connection configuration.';
    } catch (error) {
      result.message = error instanceof Error && error.message.startsWith('The configured provider returned HTTP ') ? error.message : 'Probe failed. Check the dashboard connection, exact API path/model and existing credential source before changing the client endpoint.';
    } finally {
      for (const target of [...(created ? ['/api/vault/secret/' + name] : []), '/api/sessions/' + session]) {
        try { await this.admin(target, undefined, 'DELETE'); }
        catch { result.cleanup = false; result.ok = false; result.message = 'Probe cleanup could not be confirmed. Remove only the temporary CG_PROBE_ entry/session in the dashboard before retrying.'; }
      }
    }
    return result;
  };
  private headers = (options: ProbeOptions): Record<string, string> => {
    if (!options.credentialEnv) {
      if (options.credentialHeader || options.credentialPrefix) throw new Error('Credential header/prefix requires --credential-env NAME. Never pass credential values as arguments.');
      return {};
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(options.credentialEnv)) throw new Error('Invalid credential environment variable name.');
    const value = this.env[options.credentialEnv];
    const header = options.credentialHeader?.toLowerCase();
    if (!value || !['authorization', 'x-api-key', 'api-key'].includes(header || '') || /[\r\n\0]/.test(value + (options.credentialPrefix || ''))) throw new Error('The selected credential source/header is unavailable or invalid.');
    return { [header!]: (options.credentialPrefix || '') + value };
  };
  private endpoint = (base: URL, options: ProbeOptions): string => {
    const suffix = options.format === 'anthropic' ? '/messages' : '/chat/completions';
    const prefix = base.pathname.replace(/\/$/, '');
    const path = options.endpoint ?? (prefix.endsWith('/v1') ? prefix + suffix : prefix + '/v1' + suffix);
    if (!path.startsWith('/' + options.connection + '/') || /[?#\\]/.test(path) || path.split('/').some(part => part === '..' || part === '.')) throw new Error('--endpoint must be the exact local request path under the selected connection, without query or fragment.');
    const endpoint = new URL(path, this.settings.url);
    if (endpoint.origin !== this.settings.url) throw new Error('Probe must use the local CorpGate connection.');
    return endpoint.href;
  };
  private admin = async (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<unknown> => {
    const token = new RuntimeCredentials(this.settings).readAdminToken();
    const headers: Record<string, string> = { authorization: 'Bearer ' + token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) };
    const response = await fetch(this.settings.url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) throw new Error('CorpGate probe operation failed.');
    return response.json();
  };
}
