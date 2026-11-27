import { Accordion, Paper, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionStep } from '../stores/types.js';
import { SessionPayload } from '../models/session-payload.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { PayloadViewer } from './payload-viewer.js';
import { SessionCallResponse } from './session-call-response.js';

export const SessionConversation = ({ body, step, secretsMap, newest }: { body: unknown; step: SessionStep; secretsMap: Map<string, SessionAlias>; newest: boolean }) => {
  const { t } = useLocale();
  const { setup, turns } = SessionPayload.turns(SessionPayload.messages(body));
  const ordered = newest ? [...turns].reverse() : turns;
  return <Stack gap="lg" miw={0}>
    <Text size="xs" c="dimmed">{t('sessionView.snapshotLimit')}</Text>
    {!turns.length && <Text size="sm" c="dimmed">{t('sessionView.noTurns')}</Text>}
    {ordered.map(turn => <Paper key={turn.id} p="sm" withBorder miw={0} data-session-turn={turn.index}>
      <Stack gap="md">
        <Text fw={700} size="sm">{t('sessionView.turn', { index: turn.index })}</Text>
        {turn.messages.map((message, i) => <Stack key={message.id} gap="xs">
          {i === 1 && <Text fw={600} size="xs" c="dimmed">{t('sessionView.following')}</Text>}
          <PayloadViewer data={message.body} role={message.role} label={message.role === 'unknown' ? t('sessionView.unknownRole') : undefined} secretsMap={secretsMap} />
        </Stack>)}
        {turn === turns.at(-1) && <SessionCallResponse step={step} secretsMap={secretsMap} />}
      </Stack>
    </Paper>)}
    {setup.length > 0 && <Accordion variant="separated"><Accordion.Item value="setup"><Accordion.Control>{t('sessionView.setup')}</Accordion.Control><Accordion.Panel><Stack gap="xs">{setup.map(message => <PayloadViewer key={message.id} data={message.body} role={message.role} secretsMap={secretsMap} />)}</Stack></Accordion.Panel></Accordion.Item></Accordion>}
    {body !== undefined && !turns.length && !setup.length && <PayloadViewer data={body} secretsMap={secretsMap} />}
    {!turns.length && <SessionCallResponse step={step} secretsMap={secretsMap} />}
  </Stack>;
};
