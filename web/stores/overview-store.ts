import { useSyncExternalStore } from 'react';
import { notifications } from '@mantine/notifications';
import { apiClient } from './api-client.js';
import { authStore } from './auth-store.js';
import { connectionsStore } from './connections-store.js';
import { eventStream, type GatewayEvent } from './event-stream.js';
import { localeStore } from './locale-store.js';
import { navigationStore } from './navigation-store.js';
import { vaultStore } from './vault-store.js';
import type { SessionStep, SessionSummary } from './types.js';
import { SessionPayload } from '../models/session-payload.js';

export interface OverviewSnapshot {
  sessions: SessionSummary[];
  selectedSession: string | null;
  displayedSession: string | null;
  step: SessionStep | null;
  pendingCount: number;
  lastResult: { status: number; timestamp?: string } | null;
  streamText: string;
  live: boolean;
  contentMode: 'changes' | 'full' | 'json';
  exchangeSide: 'masked' | 'original';
  messageOrder: 'newest' | 'oldest';
  error: string | null;
  loading: boolean;
  sessionPreviews: Record<string, string>;
}

export class OverviewStore {
  private sessions: SessionSummary[] = [];
  private selectedSession: string | null = null;
  private displayedSession: string | null = null;
  private selectionVersion = 0;
  private step: SessionStep | null = null;
  private pending = new Map<string, { started: number; route: string | null; session: string }>();
  private results = new Map<string, { status: number; timestamp?: string }>();
  private currentStream: { id: string; session: string; route: string | null; text: string } | null = null;
  private expectedStreamId = '';
  private endedStreamId = '';
  private streamText = '';
  private live = false;
  private contentMode: 'changes' | 'full' | 'json' = 'changes';
  private exchangeSide: 'masked' | 'original' = 'masked';
  private error: string | null = null;
  private loading = false;
  private sessionPreviews: Record<string, string> = {};
  private listeners = new Set<() => void>();
  private snapshot!: OverviewSnapshot;

  constructor() {
    this.updateSnapshot();
    eventStream.onStatus(connected => {
      this.live = connected;
      if (!connected) {
        this.currentStream = null;
        this.streamText = '';
      } else {
        this.refresh();
      }
      this.emit();
    });
    eventStream.onEvent(this.handleEvent);
    eventStream.connect();
    authStore.onUnlock(() => { void this.init(); });
    navigationStore.onTabChange(tab => {
      if (tab === 'overview') this.refresh();
    });
  }

  private emit = (): void => {
    this.updateSnapshot();
    this.listeners.forEach(fn => fn());
  };

  private updateSnapshot = (): void => {
    const retained = new Set(this.sessions.map(session => session.id));
    this.sessionPreviews = Object.fromEntries(Object.entries(this.sessionPreviews).filter(([id]) => retained.has(id)));
    if (this.step && this.displayedSession) {
      const parsed = SessionPayload.parse(this.step.request?.body);
      const first = SessionPayload.messages(parsed).find(message => message.role === 'user');
      const preview = first ? SessionPayload.text(SessionPayload.safe(first.body)) : SessionPayload.text(SessionPayload.safe(parsed));
      if (preview) this.sessionPreviews[this.displayedSession] = preview.replace(/\s+/g, ' ').slice(0, 140);
    }
    const activeRouteId = connectionsStore.getSnapshot().workspace.selected;
    let pendingCount = 0;
    for (const item of this.pending.values()) if (!activeRouteId || item.route === activeRouteId) pendingCount++;
    const streamVisible = this.live && !this.loading && !this.error && this.currentStream !== null && this.currentStream.session === this.selectedSession && this.displayedSession === this.selectedSession && this.step !== null && this.currentStream.id === this.step.id && (this.step.state === 'active' || this.step.responseChanges?.status === 'pending') && this.streamText !== '';
    this.snapshot = {
      sessions: [...this.sessions],
      selectedSession: this.selectedSession,
      displayedSession: this.displayedSession,
      step: this.step,
      pendingCount,
      lastResult: activeRouteId && this.results.has(activeRouteId) ? { ...this.results.get(activeRouteId)! } : null,
      streamText: streamVisible ? this.streamText : '',
      live: this.live,
      contentMode: this.contentMode,
      exchangeSide: this.exchangeSide,
      messageOrder: navigationStore.getSnapshot().messageOrder,
      error: this.error,
      loading: this.loading,
      sessionPreviews: { ...this.sessionPreviews },
    };
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): OverviewSnapshot => this.snapshot;

  public getFilteredSessions = (): SessionSummary[] => {
    const sel = connectionsStore.getSnapshot().workspace.selected;
    if (!sel) return this.sessions;
    return this.sessions
      .filter(s => (s.endpoints && s.endpoints.length > 0 ? s.endpoints : [s.endpoint]).some(ep => connectionsStore.routeFor(ep) === sel))
      .sort((a, b) => new Date(b.lastSeen || b.timestamp || 0).getTime() - new Date(a.lastSeen || a.timestamp || 0).getTime());
  };

  public init = async (): Promise<void> => {
    this.loading = true;
    this.emit();
    try {
      await connectionsStore.fetch();
      const sessions = await apiClient.getSessions();
      this.sessions = sessions;
      const filtered = this.getFilteredSessions();
      if (filtered.length > 0 && !this.selectedSession) await this.selectSession(filtered[0].id);
      this.error = null;
    } catch (err: unknown) {
      this.error = (err as Error)?.message || String(err);
    } finally {
      this.loading = false;
      this.emit();
    }
  };

  public refresh = async (): Promise<void> => {
    const version = this.selectionVersion;
    try {
      await connectionsStore.fetch();
      const sessions = await apiClient.getSessions();
      if (version !== this.selectionVersion) return;
      this.sessions = sessions;
      const filtered = this.getFilteredSessions();
      if (this.selectedSession && sessions.some(s => s.id === this.selectedSession)) {
        const selected = this.selectedSession;
        if (this.loading) return;
        const steps = await apiClient.getSession(selected);
        if (this.selectedSession !== selected || version !== this.selectionVersion) return;
        this.step = steps[0] ?? null;
        this.displayedSession = selected;
      } else if (filtered.length > 0) {
        await this.selectSession(filtered[0].id);
      } else {
        this.selectedSession = null;
        this.step = null;
        this.displayedSession = null;
      }
      this.error = null;
      this.emit();
    } catch (err: unknown) {
      if (version !== this.selectionVersion) return;
      this.error = (err as Error)?.message || String(err);
      this.emit();
    }
  };

  public selectSession = async (id: string | null): Promise<void> => {
    if (id && id === this.selectedSession && (this.loading || (this.displayedSession === id && this.step))) return;
    const version = ++this.selectionVersion;
    this.selectedSession = id;
    this.loading = Boolean(id);
    this.streamText = '';
    this.currentStream = null;
    this.expectedStreamId = '';
    this.endedStreamId = '';
    this.error = null;
    if (!id) {
      this.step = null;
      this.displayedSession = null;
    }
    this.emit();
    if (!id) return;
    try {
      const steps = await apiClient.getSession(id);
      if (this.selectedSession !== id || version !== this.selectionVersion) return;
      this.step = steps[0] ?? null;
      this.displayedSession = id;
      this.loading = false;
      this.error = null;
      this.emit();
    } catch (error: unknown) {
      if (this.selectedSession !== id || version !== this.selectionVersion) return;
      this.step = null;
      this.displayedSession = null;
      this.loading = false;
      this.error = error instanceof Error ? error.message : String(error);
      this.emit();
    }
  };

  public setContentMode = (mode: 'changes' | 'full' | 'json'): void => {
    this.contentMode = mode;
    this.emit();
  };

  public setExchangeSide = (side: 'masked' | 'original'): void => {
    this.exchangeSide = side;
    this.emit();
  };

  public handleEvent = (event: GatewayEvent): void => {
    const details = event.details || {};
    const tid = String(details.transactionId || '');
    const sid = String(details.sessionId || '');
    if (event.type === 'request_started') {
      if (tid) this.pending.set(tid, { started: Date.now(), route: connectionsStore.routeFor(details.endpoint as string), session: sid });
      if (sid === this.selectedSession) {
        this.streamText = '';
        this.currentStream = null;
        this.expectedStreamId = tid;
        this.endedStreamId = '';
        this.emit();
      }
      this.refresh();
    } else if (event.type === 'stream_progress') {
      const expectedId = this.expectedStreamId || this.step?.id;
      if (this.live && sid === this.selectedSession && typeof details.text === 'string' && tid !== this.endedStreamId && (!expectedId || tid === expectedId)) {
        this.currentStream = { id: tid, session: sid, route: null, text: details.text };
        this.streamText = details.text;
        this.emit();
      }
    } else if (event.type === 'transaction_completed') {
      if (sid === this.selectedSession && tid === (this.currentStream?.id || this.expectedStreamId || this.step?.id)) {
        this.currentStream = null;
        this.endedStreamId = tid;
        this.streamText = '';
        this.emit();
      }
      const route = (tid && this.pending.get(tid)?.route) || connectionsStore.routeFor(details.endpoint as string);
      if (tid) this.pending.delete(tid);
      if (route && details.latest !== false) this.results.set(route, { status: Number(details.status || 200), timestamp: event.timestamp });
      vaultStore.fetchData();
      if (details.latest !== false) this.refresh(); else this.emit();
    } else if (event.type === 'session_removed') {
      for (const [id, item] of this.pending) if (item.session === sid) this.pending.delete(id);
      this.sessions = this.sessions.filter(s => s.id !== sid);
      const wasSelected = this.selectedSession === sid;
      if (wasSelected) {
          this.selectionVersion++;
        this.selectedSession = null;
          this.displayedSession = null;
          this.loading = false;
        this.step = null;
        this.streamText = '';
        this.currentStream = null;
        const remaining = this.getFilteredSessions();
        if (remaining.length > 0) this.selectSession(remaining[0].id);
      }
      if (details.reason === 'budget' && wasSelected) {
        notifications.show({ message: localeStore.t('toasts.sessionBudget'), color: 'yellow' });
      }
      this.emit();
    } else if (event.type === 'sessions_cleared') {
      this.selectionVersion++;
      this.pending.clear();
      this.results.clear();
      this.sessions = [];
      this.selectedSession = null;
      this.displayedSession = null;
      this.loading = false;
      this.step = null;
      this.currentStream = null;
      this.streamText = '';
      this.expectedStreamId = '';
      this.endedStreamId = '';
      this.emit();
    }
  };
}

export const overviewStore = new OverviewStore();
export const useOverview = () => useSyncExternalStore(overviewStore.subscribe, overviewStore.getSnapshot);
