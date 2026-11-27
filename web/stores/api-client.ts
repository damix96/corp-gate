import { authStore } from './auth-store.js';
import type { PatchSecretPayload, PatternRecord, PreviewResponse, RevealSecretResponse, RouteRecord, SecretRecord, SessionStep, SessionSummary, WorkspaceState } from './types.js';

export interface RequestOptions extends RequestInit {
  dedupeKey?: string;
}

export class ApiClient {
  private baseUrl: string;
  private inflight = new Map<string, AbortController>();

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  public request = async <T = unknown>(path: string, options: RequestOptions = {}): Promise<T> => {
    const pendingLogin = authStore.waitPendingLogin();
    if (pendingLogin && !path.startsWith('/api/auth/')) await pendingLogin;
    const key = options.dedupeKey ?? ((options.method ?? 'GET') === 'GET' ? `GET:${path}` : '');
    if (key) this.inflight.get(key)?.abort();
    const controller = new AbortController();
    if (key) this.inflight.set(key, controller);
    const timeout = AbortSignal.timeout(10000);
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal, timeout]) : AbortSignal.any([controller.signal, timeout]);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        credentials: options.credentials ?? 'same-origin',
        headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        signal,
      });
      if (!res.ok) {
        if (res.status === 401 && path.startsWith('/api/') && !path.startsWith('/api/auth/') && !path.startsWith('/api/secret-input/')) {
          authStore.requireAuth();
        }
        const body = await res.json().catch(() => ({}));
        const fields = body.fieldErrors ?? body.error?.fieldErrors;
        const details = fields && typeof fields === 'object'
          ? Object.entries(fields).map(([f, errs]) => `${f}: ${Array.isArray(errs) ? errs.join(', ') : String(errs)}`).join('; ')
          : '';
        const message = typeof body.message === 'string' ? body.message : '';
        throw Object.assign(new Error(details || message || (typeof body.error === 'string' ? body.error : `HTTP ${res.status}`)), { status: res.status, body });
      }
      if (path.startsWith('/api/') && path !== '/api/health' && !path.startsWith('/api/secret-input/') && !path.startsWith('/api/auth/')) {
        authStore.clearAuth();
      }
      return res.json() as Promise<T>;
    } finally {
      if (key && this.inflight.get(key) === controller) this.inflight.delete(key);
    }
  };

  public checkHealth = () => this.request<{ status: string }>('/health');
  public getVault = () => this.request<{ manualSecrets?: SecretRecord[]; manual?: SecretRecord[]; autoSecrets?: SecretRecord[]; auto?: SecretRecord[]; retention?: { cleanupPending?: boolean } }>('/api/vault');
  public saveSecret = (payload: { key: string; realValue?: string; description?: string; isSecret?: boolean; operation?: 'create' | 'update' }) => this.request<{ success: boolean; secret: SecretRecord }>('/api/vault/secret', { method: 'POST', body: JSON.stringify(payload) });
  public patchSecret = async (key: string, payload: PatchSecretPayload) => {
    try {
      return await this.request<{ success: boolean; secret: SecretRecord }>(`/api/vault/secret/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } catch (err: unknown) {
      if ((err as { status?: number })?.status === 404 || (err as { status?: number })?.status === 405) {
        return this.request<{ success: boolean; secret: SecretRecord }>('/api/vault/secret', {
          method: 'POST',
          body: JSON.stringify({ key, ...payload }),
        });
      }
      throw err;
    }
  };
  public revealSecret = async (key: string): Promise<RevealSecretResponse> => {
    try {
      const res = await this.request<{ manualSecrets?: SecretRecord[]; manual?: SecretRecord[] }>('/api/interface/vault', {
        method: 'POST',
        headers: { 'x-corpgate-display': 'original' },
      });
      const found = (res.manualSecrets ?? res.manual ?? []).find(s => s.key === key);
      return { key, realValue: found?.realValue ?? '', isSecret: found?.isSecret };
    } catch {
      const res = await this.getVault();
      const found = (res.manualSecrets ?? res.manual ?? []).find(s => s.key === key);
      return { key, realValue: found?.realValue ?? '', isSecret: found?.isSecret };
    }
  };
  public toggleSecret = (key: string) => this.request<{ success: boolean }>(`/api/vault/secret/${encodeURIComponent(key)}/toggle`, { method: 'POST' });
  public deleteSecret = (key: string) => this.request<{ success: boolean }>(`/api/vault/secret/${encodeURIComponent(key)}`, { method: 'DELETE' });
  public promoteSecret = (payload: { key: string }) => this.request<{ success: boolean; secret: SecretRecord }>('/api/vault/promote', { method: 'POST', body: JSON.stringify(payload) });
  public getPatterns = () => this.request<PatternRecord[]>('/api/patterns');
  public createPattern = (payload: { name: string; pattern: string; type: string; label_template: string | null; token_template?: string }) => this.request<{ success: boolean; pattern: PatternRecord }>('/api/patterns', { method: 'POST', body: JSON.stringify(payload) });
  public updatePattern = (id: string, payload: Record<string, unknown>) => this.request<{ success: boolean; pattern: PatternRecord }>(`/api/patterns/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  public togglePattern = (id: string) => this.request<{ success: boolean; pattern: PatternRecord }>(`/api/patterns/${encodeURIComponent(id)}/toggle`, { method: 'POST' });
  public deletePattern = (id: string) => this.request<{ success: boolean }>(`/api/patterns/${encodeURIComponent(id)}`, { method: 'DELETE' });
  public previewPattern = (payload: Record<string, unknown>, signal?: AbortSignal) => this.request<PreviewResponse>('/api/pattern-preview', { method: 'POST', body: JSON.stringify(payload), signal, dedupeKey: 'POST:/api/pattern-preview' });
  public getRoutes = () => this.request<RouteRecord[]>('/api/routes');
  public createRoute = (payload: { name: string; prefix: string; upstreamUrl: string; suffix?: string }) => this.request<RouteRecord>('/api/routes', { method: 'POST', body: JSON.stringify(payload) });
  public updateRoute = (id: string, upstreamUrl: string, name?: string, suffix?: string) => this.request<RouteRecord>(`/api/routes/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ upstreamUrl, name, suffix }) });
  public deleteRoute = (id: string) => this.request<{ success: boolean }>(`/api/routes/${encodeURIComponent(id)}`, { method: 'DELETE' });
  public getWorkspace = () => this.request<WorkspaceState>('/api/workspace');
  public saveWorkspace = (payload: WorkspaceState) => this.request<WorkspaceState>('/api/workspace', { method: 'POST', body: JSON.stringify(payload) });
  public getSessions = () => this.request<SessionSummary[]>('/api/sessions');
  public getSession = (id: string) => this.request<SessionStep[]>(`/api/sessions/${encodeURIComponent(id)}`).then(rows => [...rows].reverse());
  public deleteSession = (id: string) => this.request<{ success: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  public clearAllSessions = () => this.request<{ success: boolean }>('/api/sessions', { method: 'DELETE' });
  public getClientHelp = () => this.request<{ zenPlugin?: string }>('/api/client-help');
  public exportConfig = (groups: string[]) => {
    const resolved = groups.flatMap(g => g.split(',')).filter(Boolean);
    return this.request<Record<string, unknown>>(`/api/export?groups=${resolved.join(',')}`);
  };
  public getSettings = () => this.request<Record<string, unknown>>('/api/settings');
  public saveSettings = (payload: unknown) => this.request<Record<string, unknown>>('/api/settings', { method: 'POST', body: JSON.stringify(payload) });
  public sendTestPing = () => this.request<{ success: boolean }>('/api/test-ping', { method: 'POST' });
}

export const apiClient = new ApiClient();
