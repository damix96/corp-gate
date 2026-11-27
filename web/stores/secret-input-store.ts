export interface SecretInputRow { name: string; value: string; description: string; isSecret: boolean }
export interface ExistingVariable { name: string; description: string; isSecret: boolean }
export type SecretInputTerminal = 'completed' | 'cancelled' | 'expired' | 'failed' | 'unavailable';
interface RequestView { requestId: string; state: string; names: string[]; variables?: Array<Partial<SecretInputRow>>; notice?: { message?: string } }
interface SessionView { formToken?: string; request?: RequestView; variables?: Array<Partial<SecretInputRow>>; existingNames?: Array<string | Partial<SecretInputRow>> }
export interface SecretInputSnapshot {
  loading: boolean; submitting: boolean; review: boolean; error: string | null; errorKey: string | null;
  terminal: SecretInputTerminal | null; notice: string | null; rows: SecretInputRow[]; existing: ExistingVariable[];
}

export class SecretInputStore {
  private state: SecretInputSnapshot = { loading: true, submitting: false, review: false, error: null, errorKey: null, terminal: null, notice: null, rows: [], existing: [] };
  private listeners = new Set<() => void>();
  private controller = new AbortController();
  private token = '';
  private requestId = '';
  private initialNames: string[] = [];
  private requestKey = '';
  private submissionId = '';

  public getSnapshot = (): SecretInputSnapshot => this.state;
  public subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  private updateState = (patch: Partial<SecretInputSnapshot>): void => {
    if (this.controller.signal.aborted) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  };
  private request = async <T>(path: string, method = 'GET', body?: unknown, intake = true): Promise<T> => {
    const response = await fetch(path, {
      credentials: 'same-origin',
      method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(intake ? { 'x-corpgate-input': '1', ...(this.token ? { Authorization: `Intake ${this.token}` } : {}) } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw Object.assign(new Error(data?.error?.message || data?.message || `HTTP ${response.status}`), { status: response.status });
    if (!data) throw new Error('Invalid response. Check the request result.');
    return data as T;
  };
  private accept = (view: RequestView): void => {
    if (['completed', 'cancelled', 'expired', 'failed'].includes(view.state)) {
      this.updateState({ terminal: view.state as SecretInputTerminal, rows: [], review: false, error: null, errorKey: null, notice: view.notice?.message || null });
      this.token = ''; this.submissionId = ''; this.requestKey = '';
    } else this.updateState({ review: view.state === 'committing' });
  };

  public load = async (address: string): Promise<void> => {
    this.controller.abort(); this.controller = new AbortController();
    this.updateState({ loading: true, terminal: null, error: null, errorKey: null, rows: [], review: false });
    const generation = this.controller;
    try {
      const url = new URL(address);
      const requestId = url.pathname.match(/^\/vault\/set\/([a-zA-Z0-9_-]+)\/?$/)?.[1] || url.searchParams.get('request') || url.searchParams.get('requestId') || '';
      const existing = new Map<string, ExistingVariable>();
      try {
        const vault = await this.request<{ manualSecrets?: Array<{ key: string; description?: string; isSecret?: boolean }>; manual?: Array<{ key: string; description?: string; isSecret?: boolean }> }>('/api/vault', 'GET', undefined, false);
        for (const item of vault.manualSecrets || vault.manual || []) existing.set(item.key, { name: item.key, description: item.description || '', isSecret: item.isSecret !== false });
      } catch {}
      if (generation.signal.aborted) return;
      const data = await this.request<SessionView>('/api/secret-input/session', 'POST', requestId ? { requestId } : {});
      if (generation.signal.aborted) return;
      if (!data.formToken) { this.updateState({ terminal: 'unavailable' }); return; }
      this.token = data.formToken;
      this.requestId = data.request?.requestId || '';
      for (const item of data.existingNames || []) {
        const name = typeof item === 'string' ? item : item.name;
        if (name && !existing.has(name)) existing.set(name, { name, description: typeof item === 'string' ? '' : item.description || '', isSecret: typeof item === 'string' || item.isSecret !== false });
      }
      const queryNames = url.searchParams.get('secrets')?.split(',').filter(Boolean) || [];
      const specs = data.variables || data.request?.variables;
      const values = specs?.length ? specs : (data.request?.names || queryNames).map(name => ({ name }));
      const rows = (values.length ? values : [{ name: '' }]).map(spec => {
        const name = spec.name || '';
        const previous = existing.get(name);
        return { name, value: '', description: spec.description || previous?.description || '', isSecret: spec.isSecret ?? previous?.isSecret ?? true };
      });
      this.initialNames = rows.map(row => row.name);
      this.requestKey = ''; this.submissionId = '';
      this.updateState({ rows, existing: [...existing.values()] });
      if (data.request) this.accept(data.request);
    } catch (error) {
      if (!generation.signal.aborted) this.updateState({ terminal: 'unavailable', error: (error as Error).message });
    } finally { if (!generation.signal.aborted) this.updateState({ loading: false }); }
  };

  public edit = (index: number, patch: Partial<SecretInputRow>): void => {
    if (this.state.submitting || this.state.review) return;
    if (patch.name !== undefined) {
      patch = { ...patch, name: patch.name.toUpperCase().replace(/\s+/g, '_') };
      const existing = this.state.existing.find(entry => entry.name === patch.name);
      if (existing) patch = { ...patch, ...(existing.description ? { description: existing.description } : {}), isSecret: existing.isSecret };
    }
    this.requestKey = ''; this.submissionId = '';
    this.updateState({ rows: this.state.rows.map((row, i) => i === index ? { ...row, ...patch } : row), error: null, errorKey: null });
  };
  public add = (): void => {
    if (this.state.submitting || this.state.review || this.state.rows.length >= 32) return;
    this.requestKey = ''; this.submissionId = '';
    this.updateState({ rows: [...this.state.rows, { name: '', value: '', description: '', isSecret: true }] });
  };
  public remove = (index: number): void => {
    if (this.state.submitting || this.state.review || this.state.rows.length <= 1) return;
    this.requestKey = ''; this.submissionId = '';
    this.updateState({ rows: this.state.rows.filter((_, i) => i !== index) });
  };

  public save = async (): Promise<void> => {
    if (this.state.submitting || this.state.review) return;
    const rows = this.state.rows;
    if (rows.some(row => !/^[A-Z0-9_]{1,128}$/.test(row.name)) || new Set(rows.map(row => row.name)).size !== rows.length) { this.updateState({ errorKey: 'validation.keyFormat' }); return; }
    if (rows.some(row => row.value === '')) { this.updateState({ errorKey: 'secretInput.valRequired' }); return; }
    this.updateState({ submitting: true, error: null, errorKey: null });
    let submitted = false;
    try {
      const namesMatch = this.initialNames.length === rows.length && rows.every((row, i) => row.name === this.initialNames[i]);
      if (!this.requestId || !namesMatch) {
        this.requestKey ||= crypto.randomUUID();
        const view = await this.request<RequestView>('/api/secret-input/requests', 'POST', { operation: 'set', names: rows.map(row => row.name), variables: rows.map(({ name, description, isSecret }) => ({ name, description: description || undefined, isSecret })), idempotencyKey: this.requestKey });
        this.requestId = view.requestId; this.initialNames = rows.map(row => row.name);
        if (view.state !== 'awaiting_input') { this.accept(view); return; }
      }
      this.submissionId ||= crypto.randomUUID();
      submitted = true;
      const view = await this.request<RequestView>(`/api/secret-input/requests/${encodeURIComponent(this.requestId)}/submit`, 'POST', { submissionId: this.submissionId, values: rows.map(({ name, value, description, isSecret }) => ({ name, value, description: description || undefined, isSecret })) });
      this.accept(view);
      if (view.state === 'committing') this.updateState({ rows: rows.map(row => ({ ...row, value: '' })) });
    } catch (error) {
      const status = (error as { status?: number }).status;
      const uncertain = submitted && (!status || status >= 500);
      this.updateState({ error: uncertain ? null : (error as Error).message, errorKey: uncertain ? 'secretInput.saveFailed' : null, review: uncertain, ...(uncertain ? { rows: rows.map(row => ({ ...row, value: '' })) } : {}) });
    } finally { this.updateState({ submitting: false }); }
  };

  public review = async (): Promise<void> => {
    if (this.state.submitting || !this.requestId) return;
    this.updateState({ submitting: true, error: null, errorKey: null });
    try {
      const view = await this.request<RequestView>(`/api/secret-input/requests/${encodeURIComponent(this.requestId)}`);
      this.accept(view);
      if (view.state === 'awaiting_input') { this.submissionId = ''; this.updateState({ review: false, errorKey: 'secretInput.reenterValues' }); }
    } catch (error) { this.updateState({ error: (error as Error).message }); }
    finally { this.updateState({ submitting: false }); }
  };
  public cancel = async (): Promise<void> => {
    if (this.state.submitting) return;
    this.updateState({ submitting: true, rows: this.state.rows.map(row => ({ ...row, value: '' })) });
    try {
      if (this.requestId) this.accept(await this.request<RequestView>(`/api/secret-input/requests/${encodeURIComponent(this.requestId)}/cancel`, 'POST', {}));
      else this.accept({ requestId: '', names: [], state: 'cancelled' });
    } catch (error) { this.updateState({ error: (error as Error).message, review: Boolean(this.requestId) }); }
    finally { this.updateState({ submitting: false }); }
  };
  public dispose = (): void => {
    this.controller.abort(); this.token = ''; this.requestId = ''; this.initialNames = []; this.requestKey = ''; this.submissionId = '';
    this.state = { ...this.state, rows: [], existing: [] };
    this.listeners.forEach(listener => listener());
    this.listeners.clear();
  };
}
