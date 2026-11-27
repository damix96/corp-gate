import { randomBytes, randomUUID } from 'node:crypto';
import { SecretInputBrowser, BrowserLaunchResult } from './browser-launcher.js';
import { SecretInputError } from './errors.js';
import { inputNotice, inputRequestSchema, inputSubmitSchema, inputViewSchema, InputRevision, SecretInputStorage, SecretInputView, InputVariableSpec } from './schema.js';

interface PendingInput { view: SecretInputView; revisions: InputRevision[]; variables: InputVariableSpec[]; key: string; fingerprint: string; submissionId?: string; finishedAt?: number }

export class SecretInputManager {
  private requests = new Map<string, PendingInput>();
  private shortCodes = new Map<string, string>();
  private keys = new Map<string, string>();
  private commits = new Set<Promise<SecretInputView>>();
  private stopping = false;
  constructor(private storage: SecretInputStorage, private browser = new SecretInputBrowser(), private now = Date.now, private adminToken?: string) {}

  public request = async (raw: unknown, origin?: string, launchBrowser = true): Promise<SecretInputView> => {
    this.admit();
    const parsed = inputRequestSchema.safeParse(raw);
    if (!parsed.success) throw new SecretInputError('INVALID_INPUT');
    const input = parsed.data;
    this.prune();
    const names = input.names ?? input.variables!.map(v => v.name);
    const varMap = new Map(input.variables?.map(v => [v.name, v]) ?? []);
    const variables: InputVariableSpec[] = names.map(name => varMap.get(name) ?? { name });
    const fingerprint = JSON.stringify([input.operation, [...names].sort()]);
    const previous = this.keys.get(input.idempotencyKey);
    if (previous) {
      const request = this.find(previous);
      if (request.fingerprint !== fingerprint) throw new SecretInputError('REQUEST_CONFLICT');
      return this.project(request);
    }
    if (this.requests.size >= 128) throw new SecretInputError('INPUT_BUSY');
    for (const request of this.requests.values()) {
      if (request.view.names.some(name => names.includes(name))) {
        if (request.view.state === 'committing') throw new SecretInputError('NAME_CONFLICT');
        if (request.view.state === 'awaiting_input') this.finish(request, 'cancelled');
      }
    }
    const targetRevisions = this.storage.inspect(input.operation, names);
    const revisions: InputRevision[] = targetRevisions.map(target => {
      const meta = varMap.get(target.name);
      return { ...target, description: meta?.description, isSecret: meta?.isSecret };
    });
    const requestId = randomUUID();
    const shortId = this.generateShortId();
    const baseOrigin = origin ?? 'http://127.0.0.1:8767';
    const cleanUrl = `${baseOrigin}/vault/${input.operation}/${shortId}`;
    const request: PendingInput = {
      key: input.idempotencyKey,
      fingerprint,
      revisions,
      variables,
      view: {
        requestId,
        shortId,
        operation: input.operation,
        names,
        variables,
        url: cleanUrl,
        state: 'awaiting_input',
        expiresAt: this.now() + 600_000,
        launch: 'not_requested',
      },
    };
    this.requests.set(requestId, request);
    this.shortCodes.set(shortId, requestId);
    this.keys.set(input.idempotencyKey, requestId);
    if (origin && launchBrowser) {
      let launch = await this.browser.open(new URL(cleanUrl));
      if (launch === 'unavailable') {
        const fallbackAddress = new URL('/vault/' + input.operation, origin);
        fallbackAddress.searchParams.set('secrets', names.join(','));
        fallbackAddress.searchParams.set('request', shortId);
        launch = await this.browser.open(fallbackAddress);
      }
      request.view.launch = launch;
    }
    return this.project(request);
  };

  public listExistingNames = (): string[] => this.storage.listNames?.() ?? [];

  public openDashboard = async (tab?: 'overview' | 'vault' | 'rules', origin?: string): Promise<{ url: string; launch: BrowserLaunchResult }> => {
    this.admit();
    const baseOrigin = origin ?? 'http://127.0.0.1:8767';
    const fragment = '#' + (tab || 'overview');
    const targetUrl = `${baseOrigin}/${fragment}`;
    const launchUrl = this.adminToken ? `${baseOrigin}/?token=${this.adminToken}${fragment}` : targetUrl;
    const launch = await this.browser.open(new URL(launchUrl));
    return { url: targetUrl, launch };
  };

  public status = (requestId: string): SecretInputView => this.project(this.find(requestId));

  public cancel = (requestId: string): SecretInputView => {
    const request = this.find(requestId);
    if (request.view.state === 'committing') throw new SecretInputError('COMMIT_IN_PROGRESS');
    if (request.view.state === 'awaiting_input') this.finish(request, 'cancelled');
    return this.project(request);
  };

  public submit = (requestId: string, raw: unknown): Promise<SecretInputView> => {
    this.admit();
    const request = this.find(requestId);
    const parsed = inputSubmitSchema.safeParse(raw);
    if (!parsed.success) throw new SecretInputError('INVALID_INPUT');
    const input = parsed.data;
    if (request.view.state === 'completed' && request.submissionId === input.submissionId) return Promise.resolve(this.project(request));
    if (request.view.state === 'committing') throw new SecretInputError('COMMIT_IN_PROGRESS');
    if (request.view.state === 'expired') throw new SecretInputError('REQUEST_EXPIRED');
    if (request.view.state !== 'awaiting_input') throw new SecretInputError('REQUEST_CLOSED');
    const values = new Map(input.values.map(entry => [entry.name, entry]));
    if (values.size !== input.values.length || values.size !== request.view.names.length || request.view.names.some(name => !values.has(name))) throw new SecretInputError('REQUEST_CONFLICT');
    request.submissionId = input.submissionId;
    request.view.state = 'committing';
    const task = this.commit(request, values);
    this.commits.add(task);
    void task.then(() => this.commits.delete(task), () => this.commits.delete(task));
    return task;
  };

  public close = async (): Promise<void> => {
    this.stopping = true;
    for (const request of this.requests.values()) if (request.view.state === 'awaiting_input') this.finish(request, 'cancelled');
    await Promise.allSettled([...this.commits]);
  };

  private commit = async (request: PendingInput, values: Map<string, { value: string; description?: string; isSecret?: boolean }>): Promise<SecretInputView> => {
    try {
      const receipt = await this.storage.commit(request.view.operation, request.revisions.map(entry => {
        const submitted = values.get(entry.name);
        return {
          ...entry,
          value: submitted?.value ?? '',
          description: submitted?.description !== undefined ? submitted.description : entry.description,
          isSecret: submitted?.isSecret !== undefined ? submitted.isSecret : entry.isSecret,
        };
      }), request.view.requestId);
      request.view.result = receipt.variables.map(entry => ({ name: entry.name, token: entry.token }));
      if (receipt.notice) request.view.notice = { ...inputNotice };
      this.finish(request, 'completed');
    } catch (error) {
      request.view.error = SecretInputError.safe(error).public();
      this.finish(request, 'failed');
    } finally { values.clear(); }
    return this.project(request);
  };

  private admit = (): void => { if (this.stopping) throw new SecretInputError('INPUT_STOPPING'); };
  private project = (request: PendingInput): SecretInputView => inputViewSchema.parse(request.view);
  private finish = (request: PendingInput, state: SecretInputView['state']): void => { request.view.state = state; request.finishedAt = this.now(); request.revisions = []; };
  private find = (id: string): PendingInput => {
    this.prune();
    const canonicalId = this.shortCodes.get(id) ?? id;
    const request = this.requests.get(canonicalId);
    if (!request) throw new SecretInputError('REQUEST_NOT_FOUND');
    return request;
  };
  private prune = (): void => {
    for (const [id, request] of this.requests) {
      if (request.view.state === 'awaiting_input' && request.view.expiresAt <= this.now()) this.finish(request, 'expired');
      if (request.finishedAt !== undefined && request.finishedAt + 600_000 <= this.now()) {
        this.requests.delete(id);
        if (request.view.shortId) this.shortCodes.delete(request.view.shortId);
        this.keys.delete(request.key);
      }
    }
  };
  private generateShortId = (): string => {
    for (let i = 0; i < 100; i++) {
      const code = randomBytes(2).toString('hex');
      if (!this.shortCodes.has(code) && !this.requests.has(code)) return code;
    }
    return randomBytes(3).toString('hex');
  };
}
