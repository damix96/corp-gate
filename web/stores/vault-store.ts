import { useSyncExternalStore } from 'react';
import { notifications } from '@mantine/notifications';
import { apiClient } from './api-client.js';
import { authStore } from './auth-store.js';
import { localeStore } from './locale-store.js';
import { navigationStore } from './navigation-store.js';
import { eventStream } from './event-stream.js';
import { rulesStore } from './rules-store.js';
import type { PatchSecretPayload, SecretRecord } from './types.js';

export interface SecretDraft { key: string; realValue?: string; description?: string; isSecret?: boolean; }

export interface VaultSnapshot {
  manualSecrets: SecretRecord[]; autoSecrets: SecretRecord[]; searchQuery: string; loading: boolean;
  modalOpened: boolean; modalSecretKey: string | null; togglingKeys: string[]; revealedKeys: string[]; cleanupPending: boolean;
}

export class VaultStore {
  private manualSecrets: SecretRecord[] = [];
  private autoSecrets: SecretRecord[] = [];
  private searchQuery = '';
  private loading = false;
  private modalOpened = false;
  private modalSecretKey: string | null = null;
  private togglingKeys = new Set<string>();
  private revealedKeys = new Set<string>();
  private revealedValues = new Map<string, string>();
  private cleanupPending = false;
  private drafts = new Map<string, SecretDraft>();
  private listeners = new Set<() => void>();
  private pendingFetch = false;
  private snapshot: VaultSnapshot;

  constructor() {
    this.snapshot = this.computeSnapshot();
    eventStream.onEvent(e => { if (e.type === 'transaction_completed') this.fetchData(); });
    authStore.onUnlock(() => { void this.fetchData(true); });
    if (typeof window !== 'undefined') {
      const flushPending = () => { if (this.pendingFetch && !window.getSelection()?.toString() && !document.querySelector('[data-secret-record]:focus-within')) this.fetchData(true); };
      document.addEventListener('selectionchange', flushPending);
      document.addEventListener('focusout', flushPending);
      setInterval(() => { if (!this.loading && !authStore.isRequired()) this.fetchData(); }, 4000);
    }
  }

  private computeSnapshot = (): VaultSnapshot => ({
    manualSecrets: this.manualSecrets, autoSecrets: this.autoSecrets, searchQuery: this.searchQuery,
    loading: this.loading, modalOpened: this.modalOpened, modalSecretKey: this.modalSecretKey,
    togglingKeys: Array.from(this.togglingKeys), revealedKeys: Array.from(this.revealedKeys), cleanupPending: this.cleanupPending,
  });

  private emit = (): void => {
    this.snapshot = this.computeSnapshot();
    this.listeners.forEach(fn => fn());
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): VaultSnapshot => this.snapshot;

  public fetchData = async (force = false): Promise<void> => {
    if (this.loading || (authStore.isRequired() && !force)) return;
    this.loading = true;
    try {
      const res = await apiClient.getVault();
      const nextManual = res.manualSecrets ?? res.manual ?? [];
      const nextAuto = res.autoSecrets ?? res.auto ?? [];
      this.cleanupPending = Boolean(res.retention?.cleanupPending);
      navigationStore.setGatewayStatus(true, nextManual.length + nextAuto.length);
      const hasSelection = typeof window !== 'undefined' && Boolean(window.getSelection()?.toString());
      const hasFocus = typeof window !== 'undefined' && Boolean(document.querySelector('[data-secret-record]:focus-within'));
      if (!force && (hasSelection || hasFocus)) {
        this.pendingFetch = true;
        return;
      }
      this.manualSecrets = nextManual.map(entry => {
        const cached = this.revealedValues.get(entry.key);
        return cached !== undefined ? { ...entry, realValue: cached } : entry;
      });
      this.autoSecrets = nextAuto;
      this.pendingFetch = false;
      this.emit();
    } catch (err: unknown) {
      if ((err as { status?: number })?.status !== 401) navigationStore.setGatewayStatus(false, 0);
    } finally {
      this.loading = false;
    }
  };

  public setSearchQuery = (searchQuery: string): void => { this.searchQuery = searchQuery; this.emit(); };
  private matches = (s: SecretRecord, q: string): boolean => !q || s.key.toLowerCase().includes(q) || Boolean(s.realValue?.toLowerCase().includes(q)) || Boolean(s.alias?.toLowerCase().includes(q)) || Boolean(s.description?.toLowerCase().includes(q));
  public getFilteredManual = (): SecretRecord[] => { const q = this.searchQuery.trim().toLowerCase(); return this.manualSecrets.filter(s => this.matches(s, q)); };
  public getFilteredAuto = (): SecretRecord[] => { const q = this.searchQuery.trim().toLowerCase(); return this.autoSecrets.filter(s => this.matches(s, q)); };

  public toggleSecretMasking = async (key: string): Promise<boolean> => {
    const target = this.manualSecrets.find(s => s.key === key);
    if (!target) return false;
    const prev = Boolean(target.maskInAi);
    target.maskInAi = !prev;
    this.togglingKeys.add(key);
    this.emit();
    try {
      await apiClient.toggleSecret(key);
      notifications.show({ message: localeStore.t('toasts.maskUpdated'), color: 'teal' });
      return true;
    } catch (err: unknown) {
      target.maskInAi = prev;
      const error = (err as Error)?.message || String(err);
      notifications.show({ message: localeStore.t('toasts.maskUpdateFailed', { error }), color: 'red' });
      return false;
    } finally {
      this.togglingKeys.delete(key);
      this.emit();
    }
  };

  public isRevealed = (key: string): boolean => this.revealedKeys.has(key);

  public revealSecret = async (key: string): Promise<string> => {
    const target = this.manualSecrets.find(s => s.key === key);
    const cached = this.revealedValues.get(key);
    if (cached !== undefined) {
      this.revealedKeys.add(key);
      if (target) target.realValue = cached;
      this.emit();
      return cached;
    }
    if (target?.realValue !== undefined && target.realValue !== '') {
      this.revealedKeys.add(key);
      this.revealedValues.set(key, target.realValue);
      this.emit();
      return target.realValue;
    }
    try {
      const res = await apiClient.revealSecret(key);
      const val = res.realValue ?? '';
      if (target) target.realValue = val;
      this.revealedKeys.add(key);
      this.revealedValues.set(key, val);
      this.emit();
      return val;
    } catch {
      return '';
    }
  };

  public toggleRevealSecret = async (key: string): Promise<void> => {
    if (this.revealedKeys.has(key)) {
      this.revealedKeys.delete(key);
      this.revealedValues.delete(key);
      const target = this.manualSecrets.find(s => s.key === key);
      if (target?.isSecret) target.realValue = '';
      this.emit();
      return;
    }
    await this.revealSecret(key);
  };

  public patchSecret = async (key: string, payload: PatchSecretPayload): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiClient.patchSecret(key, payload);
      const saved = res.secret;
      const idx = this.manualSecrets.findIndex(s => s.key === key);
      if (idx >= 0 && saved) this.manualSecrets[idx] = { ...this.manualSecrets[idx], ...saved };
      this.drafts.delete(key);
      this.closeModal();
      notifications.show({ message: localeStore.t('toasts.secretSaved'), color: 'teal' });
      this.emit();
      return { success: true };
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      return { success: false, error };
    }
  };

  public toggleDpapiEncryption = async (key: string): Promise<boolean> => {
    const target = this.manualSecrets.find(s => s.key === key);
    if (!target) return false;
    const nextIsSecret = !target.isSecret;
    this.togglingKeys.add(key);
    this.emit();
    try {
      const res = await this.patchSecret(key, { isSecret: nextIsSecret, expectedRevision: target.writeRevision });
      if (res.success) {
        target.isSecret = nextIsSecret;
        notifications.show({ message: localeStore.t('toasts.secretSaved'), color: 'teal' });
        return true;
      }
      return false;
    } finally {
      this.togglingKeys.delete(key);
      this.emit();
    }
  };

  public saveSecret = async (payload: { key: string; realValue?: string; description?: string; isSecret?: boolean }): Promise<{ success: boolean; error?: string }> => {
    try {
      const existing = this.manualSecrets.find(s => s.key === payload.key);
      if (existing) {
        return await this.patchSecret(payload.key, {
          isSecret: payload.isSecret,
          realValue: payload.realValue,
          description: payload.description,
          expectedRevision: existing.writeRevision,
        });
      }
      const res = await apiClient.saveSecret({ ...payload, operation: 'create' });
      const saved = res.secret || { key: payload.key, realValue: payload.realValue, alias: '$${<' + payload.key + '>}', description: payload.description, maskInAi: true, isSecret: payload.isSecret };
      this.manualSecrets = [saved, ...this.manualSecrets];
      this.drafts.delete(payload.key);
      this.drafts.delete('');
      this.closeModal();
      notifications.show({ message: localeStore.t('toasts.secretSaved'), color: 'teal' });
      this.emit();
      return { success: true };
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      return { success: false, error };
    }
  };

  public deleteSecret = async (key: string, isAuto = false): Promise<boolean> => {
    try {
      await apiClient.deleteSecret(key);
      this.revealedKeys.delete(key);
      this.revealedValues.delete(key);
      if (isAuto) this.autoSecrets = this.autoSecrets.filter(s => s.key !== key);
      else this.manualSecrets = this.manualSecrets.filter(s => s.key !== key);
      notifications.show({ message: localeStore.t(isAuto ? 'toasts.detectedDeleted' : 'toasts.secretDeleted'), color: 'teal' });
      this.emit();
      return true;
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      notifications.show({ message: localeStore.t('toasts.error', { error }), color: 'red' });
      return false;
    }
  };

  public promoteSecret = async (key: string): Promise<boolean> => {
    try {
      const res = await apiClient.promoteSecret({ key });
      const found = this.autoSecrets.find(s => s.key === key);
      this.autoSecrets = this.autoSecrets.filter(s => s.key !== key);
      const promoted = res.secret || (found ? { ...found, maskInAi: true } : { key, realValue: '', alias: '$${<' + key + '>}', maskInAi: true });
      this.manualSecrets = [promoted, ...this.manualSecrets];
      notifications.show({ message: localeStore.t('toasts.promotedToVault'), color: 'teal' });
      this.emit();
      return true;
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      notifications.show({ message: localeStore.t('toasts.error', { error }), color: 'red' });
      return false;
    }
  };

  public openCreateModal = (): void => { this.modalOpened = true; this.modalSecretKey = null; this.emit(); };
  public openEditModal = (key: string): void => { this.modalOpened = true; this.modalSecretKey = key; this.emit(); };
  public closeModal = (): void => { this.modalOpened = false; this.modalSecretKey = null; this.emit(); };
  public setDraft = (key: string, draft: SecretDraft): void => { this.drafts.set(key, draft); };
  public getDraft = (key: string): SecretDraft | undefined => this.drafts.get(key);
  public clearDraft = (key: string): void => { this.drafts.delete(key); };

  public navigateToSecret = async (key: string): Promise<void> => {
    if (typeof window !== 'undefined' && Boolean(window.getSelection()?.toString())) return;
    try {
      await this.fetchData(true);
      const isManual = this.manualSecrets.some(s => s.key === key);
      const isAuto = !isManual && this.autoSecrets.some(s => s.key === key);
      if (!isManual && !isAuto) {
        notifications.show({ message: localeStore.t('toasts.secretNoLongerSaved'), color: 'orange' });
        return;
      }
      this.searchQuery = '';
      rulesStore.setSearchQuery('');
      (document.activeElement as HTMLElement)?.blur?.();
      navigationStore.navigateToSecret(key, isAuto);
      this.emit();
      setTimeout(() => {
        const el = document.querySelector(`[data-secret-record="${key}"]`) as HTMLElement | null;
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth' });
          el.focus?.({ preventScroll: true });
        }
      }, 100);
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      notifications.show({ message: localeStore.t('toasts.secretOpenFailed', { error }), color: 'red' });
    }
  };
}

export const vaultStore = new VaultStore();
export const useVault = () => useSyncExternalStore(vaultStore.subscribe, vaultStore.getSnapshot);
