import { Badge, Code, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionStep } from '../stores/types.js';
import { SessionAliases } from '../models/session-aliases.js';
import { SessionOccurrences } from '../models/session-occurrences.js';
import { SessionPayload } from '../models/session-payload.js';
import { SessionFragments } from '../models/session-fragments.js';
import { OccurrenceLines, visibleOccurrenceFields } from './occurrence-lines.js';
import { RestorationView } from './restoration-view.js';

export const SessionOccurrencesView = ({ step, aliases, full, newest }: { step: SessionStep; aliases: SessionAliases; full: boolean; newest: boolean }) => {
  const { t } = useLocale();
  const turns = SessionOccurrences.turns(step, aliases);
  const maskedBody = SessionPayload.parse(step.maskedPrompt);
  const responseBody = SessionPayload.responseBody(step.response);
  const finalFields = SessionOccurrences.fields(responseBody, aliases, 'response');
  const visibleFinal = visibleOccurrenceFields(finalFields, full);
  const pending = step.state === 'active' || step.responseChanges?.status === 'pending';
  const evidence = SessionFragments.restorations(step.responseChanges?.version === 1 ? step.responseChanges.items || [] : []);
  const restored = evidence.windows.reduce((sum, window) => sum + window.matches.length, 0);
  const ordered = SessionOccurrences.ordered(turns, newest);
  const count = (fields: ReturnType<typeof SessionOccurrences.fields>) => fields.reduce((sum, field) => sum + field.matches.length, 0);
  return <Stack gap="xl" miw={0}>
    {ordered.map(({ turn, sides }) => {
      const visibleRequest = visibleOccurrenceFields(turn.request, full);
      const visibleHistory = visibleOccurrenceFields(turn.response, full);
      return <Stack key={turn.id} gap="md" data-session-turn={turn.index ?? 'unbound'}>
      {sides.map(side => side === 'request' ? <Paper key={side} withBorder p="md" miw={0} data-occurrence-side="request">
        <Stack gap="sm">
          <Group gap="xs"><Text fw={700}>{t('occurrences.request')}{turn.index !== undefined ? ` ${turn.index}` : ''}</Text><Tooltip label={t('occurrences.count')}><Badge size="sm" variant="light" color="gray">{count(turn.request)}</Badge></Tooltip></Group>
          {turn.index === undefined && <Text size="xs" c="dimmed">{t('sessionView.noTurns')}</Text>}
          <OccurrenceLines fields={turn.request} secretsMap={aliases.entries} full={full} />
          {full && !visibleRequest.length && maskedBody != null && <Paper withBorder radius="sm" p="sm" bg="dark.8" miw={0}><Code block fz="xs">{JSON.stringify(SessionPayload.safe(maskedBody), null, 2)}</Code></Paper>}
          {!count(turn.request) && (!full || maskedBody == null) && <Text size="sm" c="dimmed">{t(maskedBody == null ? 'exchange.notSaved' : 'occurrences.none')}</Text>}
        </Stack>
      </Paper> : <Paper key={side} withBorder p="md" miw={0} data-occurrence-side="response">
        <Stack gap="sm">
          <Group gap="xs"><Text fw={700}>{t('occurrences.response')}{turn.index !== undefined ? ` ${turn.index}` : ''}</Text><Tooltip label={t('occurrences.count')}><Badge size="sm" variant="light" color="gray">{count(turn.response) + (turn.latest ? count(finalFields) + restored : 0)}</Badge></Tooltip></Group>
          {visibleHistory.length > 0 && <><Text size="xs" c="dimmed">{t('occurrences.history')}</Text><OccurrenceLines fields={turn.response} secretsMap={aliases.entries} full={full} /></>}
          {turn.latest && <>
            {pending && <Text role="status">{t('exchange.incomingResponse')}</Text>}
            {visibleFinal.length > 0 && <><Text size="xs" c="dimmed">{t('occurrences.savedResponse')}</Text><OccurrenceLines fields={finalFields} secretsMap={aliases.entries} full={full} /></>}
            {full && !visibleFinal.length && !visibleHistory.length && responseBody != null && <Paper withBorder radius="sm" p="sm" bg="dark.8" miw={0}><Code block fz="xs">{JSON.stringify(SessionPayload.safe(responseBody), null, 2)}</Code></Paper>}
            {full && restored > 0 && <Text size="xs" c="dimmed">{t('sessionView.restoration')}</Text>}
            <RestorationView step={step} plain hideEmpty={pending || count(turn.response) + count(finalFields) > 0 || (full && (visibleFinal.length > 0 || responseBody != null))} />
          </>}
          {!turn.latest && !count(turn.response) && !full && <Text size="sm" c="dimmed">{t('occurrences.none')}</Text>}
        </Stack>
      </Paper>)}
    </Stack>;
    })}
  </Stack>;
};
