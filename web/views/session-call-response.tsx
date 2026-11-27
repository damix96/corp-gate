import { Accordion, Badge, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionStep } from '../stores/types.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { SessionPayload } from '../models/session-payload.js';
import { PayloadViewer } from './payload-viewer.js';
import { RestorationView } from './restoration-view.js';

export const SessionCallResponse = ({ step, secretsMap }: { step: SessionStep; secretsMap: Map<string, SessionAlias> }) => {
  const { t } = useLocale();
  if (step.state === 'active' || step.responseChanges?.status === 'pending') return <Text size="sm" role="status">{t('exchange.incomingResponse')}</Text>;
  return <Stack gap="xs">
    <Badge variant="light" color="teal">{t('sessionView.delivered')}</Badge>
    <PayloadViewer data={SessionPayload.responseBody(step.response)} secretsMap={secretsMap} />
    <Text size="xs" c="dimmed">{t('sessionView.cliLimit')}</Text>
    <Accordion variant="separated"><Accordion.Item value="evidence"><Accordion.Control>{t('sessionView.restoration')}</Accordion.Control><Accordion.Panel><RestorationView step={step} /></Accordion.Panel></Accordion.Item></Accordion>
  </Stack>;
};
