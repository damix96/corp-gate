import type { ResponseChangeFragment, ResponseRestoration } from '../stores/types.js';

export interface FragmentRange { start: number; end: number; }
export interface RestorationWindow { id: string; source?: string; fieldId?: string; text: string; start: number; totalLength?: number; anchored: boolean; matches: Array<ResponseRestoration & FragmentRange>; }

export class SessionFragments {
  static around = (text: string, start: number, end: number, cap = 100): FragmentRange => {
    let from = Math.max(0, start - cap);
    let to = Math.min(text.length, end + cap);
    const before = [...text.slice(from, start).matchAll(/\r\n|\r|\n/g)];
    const after = [...text.slice(end, to).matchAll(/\r\n|\r|\n/g)];
    if (before.length > 1) from += before.at(-2)!.index! + before.at(-2)![0].length;
    const tail = end > start && (text[end - 1] === '\n' || text[end - 1] === '\r' && text[end] !== '\n') ? 0 : 1;
    if (after.length > tail) to = end + after[tail]!.index!;
    if (from < start && (/[\uDC00-\uDFFF]/.test(text[from]) || text[from] === '\n' && text[from - 1] === '\r')) from++;
    if (to > end && (/[\uD800-\uDBFF]/.test(text[to - 1]) || text[to - 1] === '\r' && text[to] === '\n')) to--;
    return { start: from, end: to };
  };

  static windows = (text: string, matches: FragmentRange[]): FragmentRange[] => {
    const ranges: FragmentRange[] = [];
    for (const match of matches) {
      const next = SessionFragments.around(text, match.start, match.end);
      const previous = ranges.at(-1);
      if (previous && next.start <= previous.end) previous.end = Math.max(previous.end, next.end); else ranges.push(next);
    }
    return ranges;
  };

  static valid = (fragment: unknown, expected: string): fragment is ResponseChangeFragment => {
    if (!fragment || typeof fragment !== 'object') return false;
    const f = fragment as ResponseChangeFragment;
    return typeof f.text === 'string' && Number.isInteger(f.start) && Number.isInteger(f.end) && f.start >= 0 && f.end >= f.start && f.end <= f.text.length && f.text.slice(f.start, f.end) === expected && (f.contextStart === undefined || Number.isInteger(f.contextStart) && f.contextStart >= 0) && (f.totalLength === undefined || Number.isInteger(f.totalLength) && f.totalLength >= (f.contextStart || 0) + f.text.length);
  };

  static restorations = (items: ResponseRestoration[], side: 'before' | 'after' = 'after'): { windows: RestorationWindow[]; rejected: number } => {
    const windows: RestorationWindow[] = [];
    let rejected = 0;
    for (const [i, item] of items.entries()) {
      const value = side === 'before' ? item.alias : item.value;
      const field = item[side];
      if (!SessionFragments.valid(field, value)) { rejected++; continue; }
      const clip = SessionFragments.around(field.text, field.start, field.end, 96);
      const start = (field.contextStart || 0) + clip.start;
      windows.push({ id: item.id || String(i), source: item.source, fieldId: item.fieldId, anchored: field.contextStart !== undefined, start, totalLength: field.totalLength, text: field.text.slice(clip.start, clip.end), matches: [{ ...item, start: field.start - clip.start, end: field.end - clip.start }] });
    }
    windows.sort((a, b) => String(a.source).localeCompare(String(b.source)) || String(a.fieldId).localeCompare(String(b.fieldId)) || a.start - b.start);
    const merged: RestorationWindow[] = [];
    for (const window of windows) {
      const prior = merged.at(-1);
      const offset = prior ? window.start - prior.start : -1;
      const overlap = prior ? prior.text.length - offset : -1;
      const compatible = prior && prior.anchored && window.anchored && window.fieldId !== undefined && window.source !== undefined && prior.fieldId === window.fieldId && prior.source === window.source && prior.totalLength === window.totalLength && offset >= 0 && overlap >= 0 && prior.text.slice(offset, offset + Math.min(overlap, window.text.length)) === window.text.slice(0, overlap);
      if (!compatible) { merged.push(window); continue; }
      prior.text += window.text.slice(overlap);
      for (const match of window.matches) {
        const next = { ...match, start: match.start + offset, end: match.end + offset };
        if (prior.matches.some(m => m.start === next.start && m.end === next.end && m.alias === next.alias)) continue;
        if (prior.matches.some(m => next.start < m.end && next.end > m.start)) { rejected++; continue; }
        prior.matches.push(next);
      }
    }
    return { windows: merged, rejected };
  };
}
