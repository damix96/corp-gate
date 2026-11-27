import { useSyncExternalStore } from 'react';
import { localeStore } from './locale-store.js';

export interface AuthSnapshot { required: boolean; submitting: boolean; error: string | null }

export class AuthStore {
  private required = false;
  private submitting = false;
  private error: string | null = null;
  private listeners = new Set<() => void>();
  private unlockListeners = new Set<() => void>();
  private requireListeners = new Set<() => void>();
  private snapshot: AuthSnapshot = { required: false, submitting: false, error: null };
  private pendingUrlLogin: Promise<boolean> | null = null;

  constructor() {
    this.consumeQueryToken();
  }

  private emit = (): void => {
    this.snapshot = { required: this.required, submitting: this.submitting, error: this.error };
    this.listeners.forEach(fn => fn());
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public onUnlock = (listener: () => void): (() => void) => {
    this.unlockListeners.add(listener);
    return () => this.unlockListeners.delete(listener);
  };

  public onRequire = (listener: () => void): (() => void) => {
    this.requireListeners.add(listener);
    return () => this.requireListeners.delete(listener);
  };

  public getSnapshot = (): AuthSnapshot => this.snapshot;
  public isRequired = (): boolean => this.required;
  public waitPendingLogin = (): Promise<boolean> | null => this.pendingUrlLogin;

  public requireAuth = (): void => {
    if (this.required) return;
    this.required = true;
    this.emit();
    this.requireListeners.forEach(fn => fn());
  };

  public clearAuth = (): void => {
    if (!this.required && !this.error) return;
    this.required = false;
    this.error = null;
    this.emit();
  };

  public clearError = (): void => {
    if (!this.error) return;
    this.error = null;
    this.emit();
  };

  public submitToken = async (rawToken: string): Promise<boolean> => {
    const token = rawToken.trim();
    if (!token) return false;
    this.submitting = true;
    this.error = null;
    this.emit();
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.error = res.status === 401 ? localeStore.t('auth.invalidToken') : localeStore.t('auth.failed', { error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` });
        this.required = true;
        return false;
      }
      this.required = false;
      this.error = null;
      this.emit();
      this.unlockListeners.forEach(fn => fn());
      return true;
    } catch (err: unknown) {
      this.error = localeStore.t('auth.failed', { error: (err as Error)?.message || String(err) });
      return false;
    } finally {
      this.submitting = false;
      this.emit();
    }
  };

  private consumeQueryToken = (): void => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return;
    params.delete('token');
    const query = params.toString();
    const next = window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
    window.history.replaceState(null, '', next);
    this.pendingUrlLogin = this.submitToken(token).finally(() => { this.pendingUrlLogin = null; });
  };
}

export const authStore = new AuthStore();
export const useAuth = () => useSyncExternalStore(authStore.subscribe, authStore.getSnapshot);
