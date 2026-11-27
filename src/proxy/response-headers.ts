import { FastifyReply } from 'fastify';

export class ResponseHeaders {
  private static excluded = new Set([
    'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'proxy-authentication-info',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'content-encoding',
  ]);

  private static skipSet = (headers: Headers): Set<string> => new Set([
    ...ResponseHeaders.excluded,
    ...(headers.get('connection') || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean),
  ]);

  public static apply = (headers: Headers, reply: FastifyReply): void => {
    const excluded = ResponseHeaders.skipSet(headers);
    headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (excluded.has(lower) || lower.startsWith('access-control-') || lower === 'set-cookie') return;
      if (lower === 'vary') {
        const fields = [...new Set((String(reply.getHeader(lower) || '') + ',' + value).split(',').map(field => field.trim().toLowerCase()).filter(Boolean))];
        reply.header(lower, fields.includes('*') ? '*' : fields.join(', '));
      } else if (!reply.hasHeader(lower)) reply.header(lower, value);
    });
  };

  public static collect = (headers: Headers, overrides: Record<string, string> = {}): Record<string, string> => {
    const excluded = ResponseHeaders.skipSet(headers);
    const result: Record<string, string> = {};
    headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (!excluded.has(lower) && !lower.startsWith('access-control-') && lower !== 'set-cookie') result[lower] = value;
    });
    return { ...result, ...Object.fromEntries(Object.entries(overrides).map(([k, v]) => [k.toLowerCase(), v])) };
  };
}
