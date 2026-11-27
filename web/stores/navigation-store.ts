import { useSyncExternalStore } from 'react';
import { notifications } from '@mantine/notifications';
import { localeStore } from './locale-store.js';

export type MainTab = 'overview' | 'secrets' | 'rules';
export type RulesSubTab = 'rules' | 'detections';
export type InterfaceMode = 'simple' | 'advanced';
export type MessageOrder = 'newest' | 'oldest';

export const isSecretInputPath = (pathname: string): boolean =>
  /^\/vault\/set(?:\/[a-zA-Z0-9_-]+)?\/?$/.test(pathname);

export interface NavigationSnapshot {
  activeTab: MainTab;
  rulesSubTab: RulesSubTab;
  mode: InterfaceMode;
  messageOrder: MessageOrder;
  online: boolean;
  secretCount: number;
  highlightedSecretKey: string | null;
  exportModalOpen: boolean;
}

export class NavigationStore {
  private state: NavigationSnapshot = {
    activeTab: 'overview',
    rulesSubTab: 'rules',
    mode: 'simple',
    messageOrder: 'newest',
    online: true,
    secretCount: 0,
    highlightedSecretKey: null,
    exportModalOpen: false,
  };
  private listeners = new Set<() => void>();
  private tabChangeListeners = new Set<(tab: MainTab) => void>();
  private highlightTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    try {
      const savedMode = localStorage.getItem('corpgate.interface-mode');
      if (savedMode === 'simple' || savedMode === 'advanced') this.state = { ...this.state, mode: savedMode };
      const savedOrder = localStorage.getItem('corpgate.message-order');
      if (savedOrder === 'newest' || savedOrder === 'oldest') this.state = { ...this.state, messageOrder: savedOrder };
    } catch {}
    this.syncFromHash();
    window.addEventListener('hashchange', this.syncFromHash);
  }

  private emit = (): void => this.listeners.forEach(fn => fn());

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public onTabChange = (listener: (tab: MainTab) => void): (() => void) => {
    this.tabChangeListeners.add(listener);
    return () => this.tabChangeListeners.delete(listener);
  };

  public getSnapshot = (): NavigationSnapshot => this.state;

  public syncFromHash = (): void => {
    if (typeof location !== 'undefined' && isSecretInputPath(location.pathname)) return;
    const raw = location.hash.slice(1);
    const valid = ['overview', 'secrets', 'vault', 'rules'].includes(raw);
    const tab: MainTab = raw === 'vault' || raw === 'secrets' ? 'secrets' : raw === 'rules' ? 'rules' : 'overview';
    if (!valid && location.hash !== '#overview' && (location.pathname === '/' || location.pathname === '/dashboard')) {
      window.history.replaceState(null, '', '#overview');
    }
    if (this.state.activeTab !== tab) {
      notifications.clean();
      this.state = { ...this.state, activeTab: tab };
      this.emit();
      this.tabChangeListeners.forEach(fn => fn(tab));
    }
  };

  public setTab = (tab: MainTab): void => {
    notifications.clean();
    const normalized: MainTab = ['overview', 'secrets', 'rules'].includes(tab) ? tab : 'overview';
    if (location.hash !== '#' + normalized) history.pushState(null, '', '#' + normalized);
    this.state = { ...this.state, activeTab: normalized };
    this.emit();
    this.tabChangeListeners.forEach(fn => fn(normalized));
  };

  public setRulesSubTab = (rulesSubTab: RulesSubTab): void => {
    this.state = { ...this.state, rulesSubTab };
    this.emit();
  };

  public setMode = (mode: InterfaceMode): void => {
    try {
      localStorage.setItem('corpgate.interface-mode', mode);
    } catch {
      notifications.show({ message: localeStore.t('toasts.storagePermissionNotice'), color: 'yellow' });
    }
    this.state = { ...this.state, mode };
    this.emit();
  };

  public setMessageOrder = (messageOrder: MessageOrder): void => {
    try {
      localStorage.setItem('corpgate.message-order', messageOrder);
    } catch {
      notifications.show({ message: localeStore.t('toasts.storagePermissionNotice'), color: 'yellow' });
    }
    this.state = { ...this.state, messageOrder };
    this.emit();
  };

  public setGatewayStatus = (online: boolean, secretCount = this.state.secretCount): void => {
    if (this.state.online === online && this.state.secretCount === secretCount) return;
    this.state = { ...this.state, online, secretCount };
    this.emit();
  };

  public setExportModalOpen = (exportModalOpen: boolean): void => {
    this.state = { ...this.state, exportModalOpen };
    this.emit();
  };

  public navigateToSecret = (key: string, isAuto: boolean): void => {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    const activeTab: MainTab = isAuto ? 'rules' : 'secrets';
    const rulesSubTab: RulesSubTab = isAuto ? 'detections' : this.state.rulesSubTab;
    if (location.hash !== '#' + activeTab) history.pushState(null, '', '#' + activeTab);
    this.state = { ...this.state, activeTab, rulesSubTab, highlightedSecretKey: key };
    this.emit();
    this.highlightTimer = setTimeout(() => {
      this.state = { ...this.state, highlightedSecretKey: null };
      this.emit();
    }, 1800);
  };
}

export const navigationStore = new NavigationStore();
export const useNavigation = () => useSyncExternalStore(navigationStore.subscribe, navigationStore.getSnapshot);
