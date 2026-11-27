import { authStore } from './auth-store.js';

export interface GatewayEvent {
  type: string;
  timestamp?: string;
  details?: Record<string, unknown>;
}

export class EventStreamService {
  private source: EventSource | null = null;
  private listeners = new Set<(event: GatewayEvent) => void>();
  private statusListeners = new Set<(connected: boolean) => void>();
  private connected = false;

  constructor() {
    authStore.onRequire(() => this.close());
    authStore.onUnlock(() => this.reconnect());
  }

  public connect = (url = '/api/events'): void => {
    if (this.source || authStore.isRequired()) return;
    const pendingLogin = authStore.waitPendingLogin();
    if (pendingLogin) {
      void pendingLogin.then(() => { if (!authStore.isRequired() && !this.source) this.connect(url); });
      return;
    }
    try {
      const sse = new EventSource(url);
      this.source = sse;
      sse.onopen = () => this.setConnected(true);
      sse.onerror = () => this.setConnected(false);
      sse.onmessage = e => {
        try {
          const parsed = JSON.parse(e.data) as GatewayEvent;
          this.listeners.forEach(fn => fn(parsed));
        } catch {}
      };
    } catch {
      this.setConnected(false);
    }
  };

  private setConnected = (state: boolean): void => {
    if (this.connected === state) return;
    this.connected = state;
    this.statusListeners.forEach(fn => fn(state));
  };

  public isConnected = (): boolean => this.connected;

  public onEvent = (listener: (event: GatewayEvent) => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public onStatus = (listener: (connected: boolean) => void): (() => void) => {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  };

  public close = (): void => {
    this.source?.close();
    this.source = null;
    this.setConnected(false);
  };

  public reconnect = (url = '/api/events'): void => {
    this.close();
    this.connect(url);
  };
}

export const eventStream = new EventStreamService();
