import { useSyncExternalStore } from 'react';
import { ru } from '../locales/ru.js';
import { en } from '../locales/en.js';

export type LocaleCode = 'ru' | 'en';
export type TranslationParams = Record<string, string | number>;
export type LocaleDictionary = Record<string, unknown>;

const isRecord = (val: unknown): val is LocaleDictionary => Boolean(val && typeof val === 'object' && !Array.isArray(val));

const mergeBranch = (target: LocaleDictionary, source: LocaleDictionary): LocaleDictionary => {
  const out: LocaleDictionary = { ...target };
  for (const [k, v] of Object.entries(source)) {
    out[k] = isRecord(v) && isRecord(out[k]) ? mergeBranch(out[k] as LocaleDictionary, v) : v;
  }
  return out;
};

export class LocaleStore {
  private currentLocale: LocaleCode = 'en';
  private dictionaries = new Map<LocaleCode, LocaleDictionary>();
  private listeners = new Set<() => void>();

  constructor() {
    this.register('ru', ru as LocaleDictionary);
    this.register('en', en as LocaleDictionary);
    try {
      const saved = localStorage.getItem('cg-locale');
      if (saved === 'ru' || saved === 'en') this.currentLocale = saved;
    } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = this.currentLocale;
  }

  public register = (locale: LocaleCode, dict: LocaleDictionary): void => {
    const prev = this.dictionaries.get(locale) || {};
    this.dictionaries.set(locale, mergeBranch(prev, dict));
  };

  public setLocale = (locale: LocaleCode): void => {
    if (this.currentLocale === locale) return;
    this.currentLocale = locale;
    try {
      localStorage.setItem('cg-locale', locale);
    } catch {}
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
    this.listeners.forEach(fn => fn());
  };

  public toggleLocale = (): void =>
    this.setLocale(this.currentLocale === 'ru' ? 'en' : 'ru');

  public getLocale = (): LocaleCode => this.currentLocale;

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private resolveKey = (dict: LocaleDictionary | undefined, key: string): string | undefined => {
    if (!dict) return undefined;
    if (typeof dict[key] === 'string') return dict[key] as string;
    const val = key.split('.').reduce<unknown>((acc, part) => (isRecord(acc) ? acc[part] : undefined), dict);
    return typeof val === 'string' ? val : undefined;
  };

  public t = (key: string, params?: TranslationParams): string => {
    const alt: LocaleCode = this.currentLocale === 'ru' ? 'en' : 'ru';
    const raw = this.resolveKey(this.dictionaries.get(this.currentLocale), key)
      ?? this.resolveKey(this.dictionaries.get(alt), key)
      ?? key;
    return params
      ? raw.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, k) => (k in params ? String(params[k]) : m))
      : raw;
  };
}

export const localeStore = new LocaleStore();

export const useLocale = () => {
  const locale = useSyncExternalStore(localeStore.subscribe, localeStore.getLocale);
  return { locale, t: localeStore.t, setLocale: localeStore.setLocale, toggleLocale: localeStore.toggleLocale };
};
