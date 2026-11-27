import { useState } from 'react';
import { Button, Paper, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionStep } from '../stores/types.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { SessionAliases } from '../models/session-aliases.js';
import { SessionPayload } from '../models/session-payload.js';
import { SessionFragments } from '../models/session-fragments.js';
import { SessionText } from './session-text.js';

export const ContextDiffView = ({ step, secretsMap, promptData }: { step: SessionStep; secretsMap: Map<string, SessionAlias>; promptData: unknown }) => {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const aliases = new SessionAliases(step);
  aliases.entries = secretsMap;
  const fields = SessionPayload.fields(SessionPayload.safe(promptData)).map(field => ({ ...field, matches: [...field.text.matchAll(aliases.matcher())].map(m => ({ start: m.index!, end: m.index! + m[0].length })) })).filter(field => field.matches.length);
  return <Stack gap="md">
    <Text size="xs" c="dimmed">{t('sessionView.requestChangesLimit')}</Text>
    {!fields.length && <Text size="sm" c="dimmed">{t(promptData === undefined ? 'exchange.notSaved' : 'exchange.noSubstitutionsInRequest')}</Text>}
    {fields.map(field => {
      const windows = expanded.has(field.path) ? [{ start: 0, end: field.text.length }] : SessionFragments.windows(field.text, field.matches);
      const role = field.role === 'user' ? 'roleUser' : ['assistant', 'model'].includes(field.role) ? 'roleAssistant' : ['tool', 'function'].includes(field.role) ? 'toolResult' : field.role === 'system' ? 'roleSystem' : 'requestField';
      return <Paper key={field.path} withBorder p="sm" miw={0}>
        <Stack gap="xs">
          <Text size="xs" fw={600}>{t(`exchange.${role}`)} · {field.path} · {t('sessionView.hits', { count: field.matches.length })}</Text>
          {windows.map((range, i) => <Stack key={i} gap={4}><Text size="xs" c="dimmed">{(range.start > 0 || i > 0) && '…'}</Text><SessionText text={field.text.slice(range.start, range.end)} secretsMap={secretsMap} compact={false} />{range.end < field.text.length && <Text size="xs" c="dimmed">…</Text>}</Stack>)}
          <Button size="compact-xs" variant="subtle" onClick={() => setExpanded(prior => { const next = new Set(prior); if (next.has(field.path)) next.delete(field.path); else next.add(field.path); return next; })}>{t(expanded.has(field.path) ? 'exchange.collapseToChanges' : 'exchange.showFullField')}</Button>
        </Stack>
      </Paper>;
    })}
  </Stack>;
};
