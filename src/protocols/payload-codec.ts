import { TextTransform } from './types.js';

const SERVICE_KEYS = new Set([
  'model', 'role', 'type', 'id', 'object', 'finish_reason', 'stop_reason', 'stop_sequence',
  'index', 'encoding_format', 'tool_call_id', 'call_id', 'status', 'event', 'created', 'usage', 'signature',
]);
const MEDIA_DATA_URI = /^data:(?:image\/|audio\/|video\/|application\/pdf)/i;

export class PayloadCodec {
  public request = (body: unknown, _url: string, transform: TextTransform): unknown => {
    if (typeof body === 'string') {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return transform(body); }
      return JSON.stringify(this.walk(parsed, transform, new WeakMap()));
    }
    return this.walk(body, transform, new WeakMap());
  };

  public response = (body: unknown, transform: TextTransform): unknown => {
    if (typeof body === 'string') return transform(body);
    return this.walk(body, transform, new WeakMap());
  };

  private walk = (value: unknown, transform: TextTransform, seen: WeakMap<object, unknown>, key?: string, inPayloadContent = false): unknown => {
    if (!inPayloadContent && key && SERVICE_KEYS.has(key)) return this.clone(value, seen);
    if (typeof value === 'string') {
      if (!inPayloadContent && MEDIA_DATA_URI.test(value)) return value;
      if (key === 'arguments') {
        try {
          const parsed = JSON.parse(value);
          if (parsed !== null && typeof parsed === 'object') return JSON.stringify(this.walk(parsed, (text, source) => transform(text, source ?? 'tool-arguments'), seen, undefined, true));
          if (typeof parsed === 'string') return JSON.stringify(transform(parsed, 'tool-arguments'));
          return value;
        } catch { return transform(value, 'tool-arguments'); }
      }
      return transform(value);
    }
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      for (const item of value) result.push(this.walk(item, transform, seen, undefined, inPayloadContent));
      return result;
    }
    const result: Record<string, unknown> = {};
    seen.set(value, result);
    const record = value as Record<string, unknown>;
    const isToolUse = record.type === 'tool_use';
    const skipData = !inPayloadContent && (record.type === 'base64' || key === 'inlineData');
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const nextKey = inPayloadContent ? transform(entryKey) : entryKey;
      const nextInPayload = inPayloadContent || (isToolUse && entryKey === 'input') || (key === 'functionCall' && entryKey === 'args') || (key === 'functionResponse' && entryKey === 'response');
      const mappedValue = skipData && entryKey === 'data' ? this.clone(entryValue, seen) : this.walk(entryValue, transform, seen, entryKey, nextInPayload);
      if (nextKey === '__proto__') Object.defineProperty(result, nextKey, { value: mappedValue, enumerable: true, configurable: true, writable: true });
      else result[nextKey] = mappedValue;
    }
    return result;
  };

  private clone = (value: unknown, seen: WeakMap<object, unknown>): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      for (const item of value) result.push(this.clone(item, seen));
      return result;
    }
    const result: Record<string, unknown> = {};
    seen.set(value, result);
    for (const [entryKey, entryValue] of Object.entries(value)) result[entryKey] = this.clone(entryValue, seen);
    return result;
  };
}
