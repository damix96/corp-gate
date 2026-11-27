import { Badge, Code, Group, Paper, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import { SessionPayload } from '../models/session-payload.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { SessionText } from './session-text.js';
import { SessionDump } from './session-dump.js';

interface PayloadViewerProps { data: unknown; label?: string; role?: string; path?: string; secretsMap?: Map<string, SessionAlias>; savedDump?: unknown; savedLabel?: string; }

export const PayloadViewer = ({ data, label, role: messageRole, secretsMap, savedDump, savedLabel }: PayloadViewerProps) => {
  const { t } = useLocale();
  const render = (value: unknown, id: string): React.ReactNode => {
    if (typeof value === 'string') return <SessionText key={id} text={String(SessionPayload.safe(value))} secretsMap={secretsMap} />;
    if (value === null || value === undefined) return <Text size="xs" c="dimmed" key={id}>{t('exchange.savedContentUnavailable')}</Text>;
    if (typeof value !== 'object') return <Code key={id}>{String(value)}</Code>;
    if (Array.isArray(value)) return <Stack gap="xs" key={id}>{value.map((v, i) => render(v, `${id}.${i}`))}</Stack>;
    const obj = SessionPayload.object(value);
    const normalizedRole = id === 'body' && messageRole ? messageRole : SessionPayload.role(obj);
    const role = normalizedRole === 'unknown' ? '' : normalizedRole;
    const type = String(obj.type || '');
    const known = ['text', 'refusal', 'thinking', 'content', 'parts', 'output', 'choices', 'candidates', 'message', 'delta'].filter(k => obj[k] !== undefined);
    const tools = ['tool_calls', 'function_call', 'functionCall', 'functionResponse', 'input', 'arguments'].filter(k => obj[k] !== undefined);
    const rest = Object.fromEntries(Object.entries(obj).filter(([k]) => ![...known, ...tools, 'role', 'type', 'raw'].includes(k)));
    const extracted = Object.keys(rest).length > 0 ? SessionPayload.decodedFields(rest, id) : [];
    const roleKey = role === 'user' ? 'roleUser' : ['assistant', 'model'].includes(role) ? 'roleAssistant' : role === 'system' ? 'roleSystem' : role === 'developer' ? 'roleDeveloper' : ['tool', 'function'].includes(role) ? 'toolResult' : '';
    return <Stack gap="xs" key={id} miw={0}>
      {(role || type) && <Group gap="xs"><Badge size="xs" variant="light">{roleKey ? t(`exchange.${roleKey}`) : role || t('exchange.block', { type })}</Badge></Group>}
      {known.map(k => render(obj[k], `${id}.${k}`))}
      {tools.map(k => <SessionDump key={k} label={t(type.includes('output') || type.includes('result') || k === 'functionResponse' ? 'exchange.toolResult' : 'exchange.toolCall')} value={obj[k]} />)}
      {extracted.map(field => <Paper key={field.path} withBorder radius="sm" p="xs" bg="dark.8" miw={0}>
        <Stack gap={4} miw={0}>
          <Code fz="xs" w="fit-content">{field.path.slice(id.length + 1)}</Code>
          <SessionText text={field.text} secretsMap={secretsMap} />
        </Stack>
      </Paper>)}
      {Object.keys(rest).length > 0 && <SessionDump label={t('exchange.serviceFields', { count: Object.keys(rest).length })} value={rest} />}
      {!known.length && !tools.length && !Object.keys(rest).length && <Text size="xs" c="dimmed">{t('exchange.savedContentUnavailable')}</Text>}
    </Stack>;
  };
  return <Stack gap="xs" miw={0}>
    {label && <Text size="xs" c="dimmed">{label}</Text>}
    <Paper p="sm" withBorder miw={0}>{render(SessionPayload.safe(data), 'body')}</Paper>
    {savedDump !== undefined && <SessionDump value={savedDump} label={savedLabel || t('exchange.savedDataJson')} />}
  </Stack>;
};
