export interface SessionMessage { id: string; role: string; body: unknown; }
export interface SessionTurn { id: string; index: number; messages: SessionMessage[]; }
export interface TextField { path: string; role: string; text: string; }

export class SessionPayload {
  static parse = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
  };

  static object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

  static role = (body: unknown): string => {
    const obj = SessionPayload.object(body);
    const isResult = (value: unknown) => {
      const block = SessionPayload.object(value);
      return ['tool_result', 'function_call_output', 'custom_tool_call_output'].includes(String(block.type)) || Boolean(block.functionResponse);
    };
    const blocks = Array.isArray(obj.content) ? obj.content : Array.isArray(obj.parts) ? obj.parts : [];
    if (isResult(obj) || blocks.length > 0 && blocks.every(isResult)) return 'tool';
    return typeof obj.role === 'string' ? obj.role : 'unknown';
  };

  static safe = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const parsed = SessionPayload.parse(value);
      if (parsed !== value && parsed !== null && typeof parsed === 'object') return JSON.stringify(SessionPayload.safe(parsed));
      return value.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [hidden]').replace(/([?&](?:api[-_]?key|token|password)=)[^&#\s"]+/gi, '$1[hidden]');
    }
    if (Array.isArray(value)) return value.map(SessionPayload.safe);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /authorization|cookie|password|api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|^raw$/i.test(key) ? '[hidden]' : SessionPayload.safe(item)]));
    return value;
  };

  static fields = (body: unknown, path = 'request', role = ''): TextField[] => {
    if (typeof body === 'string') return [{ path, role, text: body }];
    if (Array.isArray(body)) return body.flatMap((item, i) => SessionPayload.fields(item, `${path}[${i}]`, role));
    if (!body || typeof body !== 'object') return [];
    const obj = SessionPayload.object(body);
    const ownRole = SessionPayload.role(obj);
    const nextRole = ownRole === 'unknown' ? role : ownRole;
    return Object.entries(obj).flatMap(([key, item]) => SessionPayload.fields(item, `${path}.${key}`, nextRole));
  };

  static decodedFields = (body: unknown, path = 'request'): TextField[] => SessionPayload.fields(body, path).flatMap(field => {
    const parsed = SessionPayload.parse(field.text);
    return parsed !== null && typeof parsed === 'object' ? SessionPayload.decodedFields(parsed, field.path) : [field];
  });

  static messages = (body: unknown): SessionMessage[] => {
    const data = SessionPayload.parse(body);
    const obj = SessionPayload.object(data);
    if (typeof obj.role === 'string' && (obj.content !== undefined || obj.parts !== undefined)) return [{ id: 'message', role: SessionPayload.role(data), body: data }];
    const prefix: SessionMessage[] = ['system', 'systemInstruction', 'system_instruction', 'instructions'].filter(key => obj[key] !== undefined).map(key => ({ id: key, role: 'system', body: obj[key] }));
    const key = ['messages', 'contents', 'input'].find(key => Array.isArray(obj[key]) || typeof obj[key] === 'string');
    const source = key ? obj[key] : Array.isArray(data) ? data : undefined;
    if (source === undefined) return prefix;
    const list = Array.isArray(source) ? source : [{ role: 'user', content: source }];
    return [...prefix, ...list.map((item, i) => ({ id: `${key || 'items'}[${i}]`, role: SessionPayload.role(item), body: item }))];
  };

  static responseBody = (response: unknown): unknown => {
    if (response === null || response === undefined) return undefined;
    if (typeof response === 'string') return SessionPayload.parse(response);
    if (typeof response === 'object' && !Array.isArray(response)) {
      if ('body' in response) return (response as { body?: unknown }).body;
      if (!('status' in response) && !('headers' in response)) return response;
    }
    return undefined;
  };

  static turns = (messages: SessionMessage[]): { setup: SessionMessage[]; turns: SessionTurn[] } => {
    const setup: SessionMessage[] = [];
    const turns: SessionTurn[] = [];
    for (const message of messages) {
      if (message.role === 'user') turns.push({ id: message.id, index: turns.length + 1, messages: [] });
      if (turns.length) turns.at(-1)!.messages.push(message); else setup.push(message);
    }
    return { setup, turns };
  };

  static text = (body: unknown): string => {
    if (typeof body === 'string') return body;
    if (Array.isArray(body)) return body.map(SessionPayload.text).filter(Boolean).join('\n');
    const obj = SessionPayload.object(body);
    const keys = ['text', 'content', 'parts', 'output', 'refusal', 'prompt', 'response'];
    const direct = keys.filter(key => obj[key] !== undefined).map(key => SessionPayload.text(obj[key])).filter(Boolean).join('\n');
    return direct || SessionPayload.decodedFields(body).map(field => field.text).filter(Boolean).join('\n');
  };
}
