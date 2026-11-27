import { Accordion, Alert, Box, Paper, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionStep } from '../stores/types.js';
import { SessionFragments, type RestorationWindow } from '../models/session-fragments.js';
import { SecretTokenBadge } from './secret-token-badge.js';
import { SessionLiteral } from './session-literal.js';

export const RestorationView = ({ step, side = 'after', plain = false, hideEmpty = false }: { step: SessionStep; side?: 'before' | 'after'; plain?: boolean; hideEmpty?: boolean }) => {
  const { t } = useLocale();
  const evidence = step.responseChanges;
  if (!plain && (step.state === 'active' || evidence?.status === 'pending')) return <Text size="sm" role="status">{t('exchange.incomingResponse')}</Text>;
  if (evidence?.version !== 1) return plain && step.state === 'active' ? null : <Text size="sm" c="dimmed">{t(plain ? 'occurrences.responseUnavailable' : 'exchange.noResponseEvidence')}</Text>;
  const { windows, rejected } = SessionFragments.restorations(evidence.items || [], side);
  const render = (window: RestorationWindow) => {
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of [...window.matches].sort((a, b) => a.start - b.start)) {
      parts.push(window.text.slice(cursor, match.start));
      parts.push(<SecretTokenBadge key={`${match.id}-${match.start}`} token={match.alias} baseKey={match.key} realValue={match.value} entryExists valueHidden={match.valueHidden} inbound={side === 'after'} />);
      cursor = match.end;
    }
    parts.push(window.text.slice(cursor));
    return <Paper key={window.id} p="sm" withBorder radius="sm" bg={plain ? 'dark.8' : undefined} miw={0} data-occurrence-line data-formatted-fragment={plain || undefined}>
      <Stack gap="xs">
        {!plain && <Text size="xs" c="dimmed">{t(window.source === 'tool-arguments' ? 'exchange.toolArguments' : 'sessionView.restoration')} · {window.fieldId || window.id}</Text>}
        <Box fz="sm" lh={1.7} ff={plain ? 'monospace' : undefined}>{window.start > 0 && '… '}{parts.flatMap<React.ReactNode>((part, i) => typeof part === 'string' ? part.split(/\r\n|\r|\n/).flatMap((line, j) => j ? [<Box component="br" key={`br-${i}.${j}`} />, <SessionLiteral key={`${i}.${j}`} text={line} />] : [<SessionLiteral key={`${i}.${j}`} text={line} />]) : [part])}{window.totalLength !== undefined && window.start + window.text.length < window.totalLength && ' …'}</Box>
      </Stack>
    </Paper>;
  };
  const regular = windows.filter(w => w.source !== 'protocol-snapshot');
  const protocol = windows.filter(w => w.source === 'protocol-snapshot');
  return <Stack gap="xs">
    {side === 'before' && <Text size="sm" c="dimmed">{t('sessionView.beforeLimit')}</Text>}
    {evidence.postHookModified && <Alert color="yellow">{t('exchange.postHookNotice')}</Alert>}
    {evidence.status === 'interrupted' && <Alert color="yellow">{t('exchange.interruptedNotice')}</Alert>}
    {rejected > 0 && <Alert color="yellow">{t('sessionView.invalidEvidence', { count: rejected })}</Alert>}
    {!windows.length && !hideEmpty && <Text size="sm" c="dimmed">{t(evidence.status === 'complete' ? plain ? 'occurrences.none' : 'exchange.noRestorations' : evidence.status === 'interrupted' ? 'exchange.responseInterrupted' : 'exchange.noRestorationPass')}</Text>}
    {regular.map(render)}
    {protocol.length > 0 && (plain ? <Stack gap="xs"><Text size="xs" c="dimmed">{t('occurrences.protocol')}</Text>{protocol.map(render)}</Stack> : <Accordion variant="separated"><Accordion.Item value="protocol"><Accordion.Control>{t('exchange.protocolRestorations')}</Accordion.Control><Accordion.Panel><Stack gap="xs">{protocol.map(render)}</Stack></Accordion.Panel></Accordion.Item></Accordion>)}
  </Stack>;
};
