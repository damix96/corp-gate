import { useSyncExternalStore } from 'react';
import { notifications } from '@mantine/notifications';
import { apiClient } from './api-client.js';
import { authStore } from './auth-store.js';
import { localeStore } from './locale-store.js';
import { rulePreviewService } from './rule-preview-service.js';
import type { PatternRecord } from './types.js';

export interface RulesSnapshot {
  patterns: PatternRecord[];
  loading: boolean;
  searchQuery: string;
  modalOpened: boolean;
  editingPattern: PatternRecord | null;
  editingBaseline: PatternRecord | null;
  isDeletedOnServer: boolean;
  isChangedOnServer: boolean;
  togglingIds: string[];
}

export class RulesStore {
  private patterns: PatternRecord[] = [];
  private loading = false;
  private searchQuery = '';
  private modalOpened = false;
  private editingPattern: PatternRecord | null = null;
  private editingBaseline: PatternRecord | null = null;
  private isDeletedOnServer = false;
  private isChangedOnServer = false;
  private togglingIds = new Set<string>();
  private drafts = new Map<string, { baseline: PatternRecord | null; draft: Partial<PatternRecord>; revision: number }>();
  private listeners = new Set<() => void>();
  private snapshot: RulesSnapshot;

  constructor() {
    this.snapshot = this.computeSnapshot();
    authStore.onUnlock(() => { void this.fetchPatterns(); });
  }

  private computeSnapshot = (): RulesSnapshot => ({
    patterns: this.patterns,
    loading: this.loading,
    searchQuery: this.searchQuery,
    modalOpened: this.modalOpened,
    editingPattern: this.editingPattern,
    editingBaseline: this.editingBaseline,
    isDeletedOnServer: this.isDeletedOnServer,
    isChangedOnServer: this.isChangedOnServer,
    togglingIds: Array.from(this.togglingIds),
  });

  private emit = (): void => {
    this.snapshot = this.computeSnapshot();
    this.listeners.forEach(fn => fn());
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getSnapshot = (): RulesSnapshot => this.snapshot;

  public fetchPatterns = async (): Promise<void> => {
    this.loading = true;
    this.emit();
    try {
      this.patterns = await apiClient.getPatterns();
      if (this.modalOpened && this.editingBaseline) {
        const found = this.patterns.find(p => p.id === this.editingBaseline?.id);
        if (!found) this.isDeletedOnServer = true;
        else if (
          found.pattern !== this.editingBaseline.pattern ||
          found.name !== this.editingBaseline.name ||
          (found.label_template ?? null) !== (this.editingBaseline.label_template ?? null) ||
          Number(found.enabled) !== Number(this.editingBaseline.enabled) ||
          found.type !== this.editingBaseline.type
        ) {
          this.isChangedOnServer = true;
        }
      }
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      if ((err as { name?: string })?.name !== 'AbortError' && (err as { status?: number })?.status !== 401) {
        notifications.show({ message: localeStore.t('toasts.patternsLoadFailed', { error }), color: 'red' });
      }
    } finally {
      this.loading = false;
      this.emit();
    }
  };

  public setSearchQuery = (searchQuery: string): void => {
    this.searchQuery = searchQuery;
    this.emit();
  };

  public getFilteredPatterns = (): PatternRecord[] => {
    const q = this.searchQuery.trim().toLowerCase();
    if (!q) return this.patterns;
    return this.patterns.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.pattern.toLowerCase().includes(q) ||
      (p.type && p.type.toLowerCase().includes(q)) ||
      (p.label_template && p.label_template.toLowerCase().includes(q))
    );
  };

  public togglePattern = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const target = this.patterns.find(p => p.id === id);
    if (!target) return { success: false, error: 'Pattern not found' };
    const prev = Boolean(target.enabled);
    target.enabled = !prev;
    this.togglingIds.add(id);
    this.emit();
    try {
      const res = await apiClient.togglePattern(id);
      if (res.pattern) {
        const idx = this.patterns.findIndex(p => p.id === id);
        if (idx >= 0) this.patterns[idx] = res.pattern;
      }
      return { success: true };
    } catch (err: unknown) {
      target.enabled = prev;
      return { success: false, error: (err as Error)?.message || String(err) };
    } finally {
      this.togglingIds.delete(id);
      this.emit();
    }
  };

  public createPattern = async (payload: { name: string; pattern: string; type: string; label_template: string | null }): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await apiClient.createPattern(payload);
      if (res.pattern) this.patterns = [...this.patterns, res.pattern];
      this.clearDraft('');
      this.closeModal();
      notifications.show({ message: localeStore.t('toasts.ruleCreated'), color: 'teal' });
      this.emit();
      return { success: true };
    } catch (err: unknown) {
      return { success: false, error: (err as Error)?.message || String(err) };
    }
  };

  public updatePattern = async (
    id: string,
    payload: { name: string; pattern: string; type: string; label_template: string | null; enabled: number | boolean; baseline: PatternRecord }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const body = {
        name: payload.name,
        pattern: payload.pattern,
        type: payload.type,
        label_template: payload.label_template,
        enabled: payload.enabled ? 1 : 0,
        baseline: {
          name: payload.baseline.name,
          pattern: payload.baseline.pattern,
          type: payload.baseline.type,
          label_template: payload.baseline.label_template ?? null,
          enabled: payload.baseline.enabled ? 1 : 0,
        },
      };
      const res = await apiClient.updatePattern(id, body);
      if (res.pattern) {
        const idx = this.patterns.findIndex(p => p.id === id);
        if (idx >= 0) this.patterns[idx] = res.pattern;
      }
      this.clearDraft(id);
      this.closeModal();
      notifications.show({ message: localeStore.t('toasts.ruleSaved'), color: 'teal' });
      this.emit();
      return { success: true };
    } catch (err: unknown) {
      await this.fetchPatterns();
      return { success: false, error: (err as Error)?.message || String(err) };
    }
  };

  public deletePattern = async (id: string): Promise<boolean> => {
    try {
      await apiClient.deletePattern(id);
      this.patterns = this.patterns.filter(p => p.id !== id);
      notifications.show({ message: localeStore.t('toasts.ruleDeleted'), color: 'teal' });
      this.emit();
      return true;
    } catch (err: unknown) {
      const error = (err as Error)?.message || String(err);
      notifications.show({ message: localeStore.t('toasts.error', { error }), color: 'red' });
      return false;
    }
  };

  public openCreateModal = (): void => {
    this.modalOpened = true;
    this.editingPattern = null;
    this.editingBaseline = null;
    this.isDeletedOnServer = false;
    this.isChangedOnServer = false;
    rulePreviewService.reset();
    this.emit();
  };

  public openEditModal = async (pattern: PatternRecord): Promise<void> => {
    try {
      const fresh = await apiClient.getPatterns();
      this.patterns = fresh;
      const found = fresh.find(p => p.id === pattern.id);
      if (!found) {
        notifications.show({ message: localeStore.t('toasts.ruleNoLongerExists'), color: 'red' });
        this.emit();
        return;
      }
      this.editingPattern = found;
      this.editingBaseline = { ...found };
    } catch {
      this.editingPattern = pattern;
      this.editingBaseline = { ...pattern };
    }
    this.modalOpened = true;
    this.isDeletedOnServer = false;
    this.isChangedOnServer = false;
    rulePreviewService.reset();
    this.emit();
  };

  public closeModal = (): void => {
    this.modalOpened = false;
    this.editingPattern = null;
    this.editingBaseline = null;
    this.isDeletedOnServer = false;
    this.isChangedOnServer = false;
    rulePreviewService.reset();
    this.emit();
  };

  public setDraft = (id: string, baseline: PatternRecord | null, draft: Partial<PatternRecord>): void => {
    const cur = this.drafts.get(id);
    this.drafts.set(id, { baseline, draft, revision: (cur?.revision ?? 0) + 1 });
  };

  public getDraft = (id: string) => this.drafts.get(id);
  public clearDraft = (id: string): void => { this.drafts.delete(id); };

  public schedulePreview = (input: { pattern: string; type: string; label_template: string | null; anyIp?: boolean }): void => {
    rulePreviewService.schedule(input);
  };

  public resetPreview = (): void => {
    rulePreviewService.reset();
  };

  public retryPreview = (): void => {
    rulePreviewService.retry();
  };

  public loadMorePreview = (): void => {
    rulePreviewService.loadMore();
  };
}

export const rulesStore = new RulesStore();
export const useRules = () => useSyncExternalStore(rulesStore.subscribe, rulesStore.getSnapshot);
