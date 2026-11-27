import { useSyncExternalStore } from 'react';
import { connectionsStore } from './connections-store.js';
import { overviewStore } from './overview-store.js';
import { navigationStore } from './navigation-store.js';
import type { RouteRecord, SessionStep, SessionSummary, WorkspaceState } from './types.js';

export interface TelemetrySnapshot {
  routes: RouteRecord[];
  workspace: WorkspaceState;
  sessions: SessionSummary[];
  selectedSession: string | null;
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
}

export class TelemetryStore {
  private listeners = new Set<() => void>();

  constructor() {
    connectionsStore.subscribe(this.emit);
    overviewStore.subscribe(this.emit);
    navigationStore.subscribe(this.emit);
    overviewStore.init();
  }

  private emit = (): void => {
    this.listeners.forEach(fn => fn());
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): TelemetrySnapshot => {
    const conn = connectionsStore.getSnapshot();
    const ov = overviewStore.getSnapshot();
    return {
      routes: conn.routes,
      workspace: conn.workspace,
      sessions: ov.sessions,
      selectedSession: ov.selectedSession,
      step: ov.step,
      pendingCount: ov.pendingCount,
      lastResult: ov.lastResult,
      streamText: ov.streamText,
      live: ov.live,
      contentMode: ov.contentMode,
      exchangeSide: ov.exchangeSide,
      messageOrder: ov.messageOrder,
      error: ov.error,
      loading: conn.loading || ov.loading,
    };
  };

  public routeFor = (endpoint?: string): string | null => connectionsStore.routeFor(endpoint);
  public getFilteredSessions = (): SessionSummary[] => overviewStore.getFilteredSessions();
  public fetchInitial = (): Promise<void> => overviewStore.init();
  public refresh = (): Promise<void> => overviewStore.refresh();
  public selectRoute = async (id: string): Promise<void> => {
    await connectionsStore.selectRoute(id);
    const filtered = overviewStore.getFilteredSessions();
    if (!filtered.some(s => s.id === overviewStore.getSnapshot().selectedSession)) {
      await overviewStore.selectSession(filtered[0]?.id ?? null);
    }
  };
  public selectSession = (id: string | null): Promise<void> => overviewStore.selectSession(id);
  public createRoute = (payload: { name: string; prefix: string; upstreamUrl: string; suffix?: string }): Promise<RouteRecord> => connectionsStore.createRoute(payload);
  public updateRoute = (id: string, upstreamUrl: string, name?: string, suffix?: string): Promise<RouteRecord> => connectionsStore.updateRoute(id, upstreamUrl, name, suffix);
  public deleteRoute = (id: string): Promise<void> => connectionsStore.deleteRoute(id);
  public setContentMode = (mode: 'changes' | 'full' | 'json'): void => overviewStore.setContentMode(mode);
  public setExchangeSide = (side: 'masked' | 'original'): void => overviewStore.setExchangeSide(side);
  public setMessageOrder = (order: 'newest' | 'oldest'): void => navigationStore.setMessageOrder(order);
}

export const telemetryStore = new TelemetryStore();
export const useTelemetry = () => useSyncExternalStore(telemetryStore.subscribe, telemetryStore.getSnapshot);
