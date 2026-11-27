import { useSyncExternalStore } from 'react';
import { notifications } from '@mantine/notifications';
import { apiClient } from './api-client.js';
import { localeStore } from './locale-store.js';
import type { RouteProxyConfig, RouteRecord, SystemProxyConfig, WorkspaceState } from './types.js';

export interface ConnectionsSnapshot {
  routes: RouteRecord[];
  workspace: WorkspaceState;
  loading: boolean;
}

export class ConnectionsStore {
  private routes: RouteRecord[] = [];
  private workspace: WorkspaceState = { visible: [], selected: '' };
  private loading = false;
  private listeners = new Set<() => void>();
  private snapshot!: ConnectionsSnapshot;

  constructor() {
    this.updateSnapshot();
  }

  private emit = (): void => {
    this.updateSnapshot();
    this.listeners.forEach(fn => fn());
  };

  private updateSnapshot = (): void => {
    this.snapshot = {
      routes: [...this.routes],
      workspace: { ...this.workspace, visible: [...this.workspace.visible] },
      loading: this.loading,
    };
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): ConnectionsSnapshot => this.snapshot;

  public routeFor = (endpoint?: string): string | null => {
    if (!endpoint) return null;
    let path = '';
    try { path = new URL(endpoint, 'http://localhost').pathname; } catch { return null; }
    const matches = this.routes.filter(r => {
      try {
        const prefix = r.prefix ? '/' + r.prefix : (r.cliUrl || r.incomingUrl ? new URL(r.cliUrl || r.incomingUrl!).pathname.replace(/\/$/, '') : '');
        return Boolean(prefix && (path === prefix || path.startsWith(prefix + '/')));
      } catch { return false; }
    });
    return matches.length === 1 ? matches[0].id : null;
  };

  public fetch = async (): Promise<void> => {
    this.loading = true;
    this.emit();
    try {
      const [routes, ws] = await Promise.all([apiClient.getRoutes(), apiClient.getWorkspace()]);
      this.routes = routes;
      const validVisible = ws.visible.filter(id => routes.some(r => r.id === id));
      const visible = validVisible.length > 0 ? validVisible : routes.map(r => r.id);
      const selected = visible.includes(ws.selected) ? ws.selected : (visible[0] || '');
      this.workspace = { visible, selected };
    } catch (err: unknown) {
      if ((err as { status?: number })?.status !== 401) {
        notifications.show({ message: localeStore.t('overview.refreshError', { error: (err as Error)?.message || String(err) }), color: 'red' });
      }
    } finally {
      this.loading = false;
      this.emit();
    }
  };

  public selectRoute = async (id: string): Promise<void> => {
    if (this.workspace.selected === id) return;
    this.workspace = { ...this.workspace, selected: id };
    this.emit();
    await apiClient.saveWorkspace(this.workspace).catch(() => {});
  };

  public fetchSystemProxy = async (): Promise<SystemProxyConfig> => {
    const res = await apiClient.request<Partial<SystemProxyConfig>>('/api/system-proxy');
    return { httpProxy: res.httpProxy ?? '', httpsProxy: res.httpsProxy ?? '', noProxy: res.noProxy ?? '' };
  };

  public createRoute = async (payload: { name: string; prefix: string; upstreamUrl: string; suffix?: string } & RouteProxyConfig): Promise<RouteRecord> => {
    const created = await apiClient.request<RouteRecord>('/api/routes', { method: 'POST', body: JSON.stringify({ suffix: '', ...payload }) });
    this.routes.push(created);
    if (!this.workspace.visible.includes(created.id)) this.workspace.visible.push(created.id);
    this.workspace.selected = created.id;
    await apiClient.saveWorkspace(this.workspace).catch(() => {});
    this.emit();
    notifications.show({ message: localeStore.t('toasts.connectionAdded'), color: 'teal' });
    return created;
  };

  public updateRoute = async (id: string, upstreamUrl: string, name?: string, suffix?: string, proxy?: RouteProxyConfig): Promise<RouteRecord> => {
    const updated = await apiClient.request<RouteRecord>(`/api/routes/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ upstreamUrl, name, suffix, ...proxy }) });
    this.routes = this.routes.map(r => r.id === id ? updated : r);
    this.emit();
    notifications.show({ message: localeStore.t('toasts.connectionSaved'), color: 'teal' });
    return updated;
  };

  public deleteRoute = async (id: string): Promise<void> => {
    await apiClient.deleteRoute(id);
    this.routes = this.routes.filter(r => r.id !== id);
    let nextVisible = this.workspace.visible.filter(v => v !== id);
    if (nextVisible.length === 0 && this.routes.length > 0) {
      nextVisible = [this.routes[0].id];
    }
    const nextSelected = this.workspace.selected === id ? (nextVisible[0] || '') : this.workspace.selected;
    this.workspace = { visible: nextVisible, selected: nextSelected };
    await apiClient.saveWorkspace(this.workspace).catch(() => {});
    this.emit();
    notifications.show({ message: localeStore.t('toasts.connectionDeleted'), color: 'teal' });
  };
}

export const connectionsStore = new ConnectionsStore();
export const useConnections = () => useSyncExternalStore(connectionsStore.subscribe, connectionsStore.getSnapshot);
