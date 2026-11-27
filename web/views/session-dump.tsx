import { Accordion, Stack, Text, Textarea } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import { SessionPayload } from '../models/session-payload.js';

export const SessionDump = ({ value, label }: { value: unknown; label: string }) => {
  const { t } = useLocale();
  return <Accordion variant="separated">
    <Accordion.Item value="technical"><Accordion.Control>{label}</Accordion.Control>
      <Accordion.Panel><Stack gap="xs">
        <Text size="xs" c="dimmed">{t('sessionView.credentialsHidden')}</Text>
        <Textarea label={label} readOnly value={JSON.stringify(SessionPayload.safe(value), null, 2) ?? '—'} autosize minRows={4} maxRows={16} ff="monospace" size="xs" />
      </Stack></Accordion.Panel>
    </Accordion.Item>
  </Accordion>;
};
