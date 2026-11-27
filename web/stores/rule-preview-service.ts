import { useSyncExternalStore } from 'react';
import { apiClient } from './api-client.js';
import type { PreviewMatch } from './types.js';

interface PreviewRunState {
  pattern: string;
  type: string;
  label_template: string | null;
  anyIp?: boolean;
  snapshot: string;
  revision?: number;
  offset: number;
  matchOffset: number;
  shown: number;
}

export interface PreviewSnapshot {
  status: 'idle' | 'empty' | 'waiting' | 'searching' | 'done' | 'conflict' | 'error';
  results: PreviewMatch[];
  contexts: Record<string, string>;
  notices: string[];
  offset: number;
  matchOffset: number;
  total: number;
  scanned: boolean;
  error: string | null;
  hasMore: boolean;
}

export class RulePreviewService {
  private status: PreviewSnapshot['status'] = 'empty';
  private results: PreviewMatch[] = [];
  private contexts: Record<string, string> = {};
  private notices = new Set<string>();
  private offset = 0;
  private matchOffset = 0;
  private total = 0;
  private scanned = false;
  private error: string | null = null;
  private hasMore = false;
  private revision = 0;
  private abortController: AbortController | null = null;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private state: PreviewRunState | null = null;
  private lastInput: { pattern: string; type: string; label_template: string | null; anyIp?: boolean } | null = null;
  private listeners = new Set<() => void>();
  private snapshot: PreviewSnapshot;

  constructor() {
    this.snapshot = this.computeSnapshot();
  }

  private computeSnapshot = (): PreviewSnapshot => ({
    status: this.status,
    results: this.results,
    contexts: this.contexts,
    notices: Array.from(this.notices),
    offset: this.offset,
    matchOffset: this.matchOffset,
    total: this.total,
    scanned: this.scanned,
    error: this.error,
    hasMore: this.hasMore,
  });

  private emit = (): void => {
    this.snapshot = this.computeSnapshot();
    this.listeners.forEach(fn => fn());
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): PreviewSnapshot => this.snapshot;

  public reset = (): void => {
    this.revision++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    this.status = 'empty';
    this.results = [];
    this.contexts = {};
    this.notices.clear();
    this.offset = 0;
    this.matchOffset = 0;
    this.total = 0;
    this.scanned = false;
    this.error = null;
    this.hasMore = false;
    this.state = null;
    this.lastInput = null;
    this.emit();
  };

  public schedule = (input: { pattern: string; type: string; label_template: string | null; anyIp?: boolean }): void => {
    this.revision++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
    this.lastInput = input;
    this.results = [];
    this.contexts = {};
    this.notices.clear();
    this.offset = 0;
    this.matchOffset = 0;
    this.total = 0;
    this.scanned = false;
    this.error = null;
    this.hasMore = false;
    this.state = null;
    if (!input.pattern.trim()) {
      this.status = 'empty';
      this.emit();
      return;
    }
    this.status = 'waiting';
    this.emit();
    const rev = this.revision;
    this.debounceTimer = setTimeout(() => this.runLoop(input, rev), 300);
  };

  public loadMore = (): void => {
    if (this.state) {
      const rev = ++this.revision;
      this.runLoop(this.state, rev);
    }
  };

  public retry = (): void => {
    const rev = ++this.revision;
    if (this.status === 'conflict' || !this.state) {
      this.state = null;
      this.results = [];
      this.contexts = {};
      this.notices.clear();
      if (this.lastInput) this.schedule(this.lastInput);
    } else {
      this.runLoop(this.state, rev);
    }
  };

  public cancel = (): void => {
    this.revision++;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.abortController) { this.abortController.abort(); this.abortController = null; }
  };

  private runLoop = async (input: { pattern: string; type: string; label_template: string | null; anyIp?: boolean }, revId: number): Promise<void> => {
    if (!this.state) {
      this.state = {
        pattern: input.pattern,
        type: input.type,
        label_template: input.label_template,
        anyIp: input.anyIp,
        snapshot: new Date().toISOString(),
        offset: 0,
        matchOffset: 0,
        shown: 0,
      };
    }
    const state = this.state;
    if (!state.pattern.trim()) {
      this.status = 'empty';
      this.emit();
      return;
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;
    const initialShown = state.shown;
    this.status = 'searching';
    this.error = null;
    this.hasMore = false;
    this.emit();

    try {
      while (!signal.aborted) {
        const payload: Record<string, unknown> = {
          pattern: state.pattern,
          type: state.type,
          label_template: state.label_template,
          anyIp: Boolean(state.anyIp),
          snapshot: state.snapshot,
          offset: state.offset,
          matchOffset: state.matchOffset,
          shown: state.shown,
        };
        if (state.revision !== undefined) payload.revision = state.revision;

        const data = await apiClient.previewPattern(payload, signal);
        if (revId !== this.revision || signal.aborted) return;

        state.revision = data.revision;
        for (const match of data.results) {
          if (match.labelNotice) this.notices.add(match.labelNotice);
          const cid = `${match.transaction || ''}_${match.session}_${match.path}_${this.results.length}`;
          match.contextId = cid;
          const contextVal = data.contexts?.[match.path] ?? (data.contexts?.[cid] ?? '');
          this.contexts[cid] = contextVal;
          if (!this.contexts[match.path]) this.contexts[match.path] = contextVal;
        }
        this.results = [...this.results, ...data.results];
        state.shown += data.results.length;
        state.offset = data.next;
        state.matchOffset = data.matchOffset || 0;
        this.offset = state.offset;
        this.total = data.total;

        const done = state.offset >= data.total;
        if (done) {
          this.scanned = true;
          this.status = 'done';
          this.hasMore = false;
          break;
        }
        if (state.shown - initialShown >= 50) {
          this.hasMore = true;
          this.status = 'done';
          break;
        }
      }
    } catch (err: unknown) {
      if (revId !== this.revision || signal.aborted) return;
      const status = (err as { status?: number })?.status;
      if (status === 409) {
        this.status = 'conflict';
        this.state = null;
        this.results = [];
        this.contexts = {};
        this.notices.clear();
      } else {
        this.status = 'error';
        this.error = (err as Error)?.message || String(err);
      }
    } finally {
      if (revId === this.revision) {
        this.emit();
      }
    }
  };
}

export const rulePreviewService = new RulePreviewService();
export const useRulePreview = () => useSyncExternalStore(rulePreviewService.subscribe, rulePreviewService.getSnapshot);
