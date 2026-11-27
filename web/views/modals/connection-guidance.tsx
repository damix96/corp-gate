import { Accordion, Button, Code, CopyButton, Group, Paper, Stack, Text } from '@mantine/core';
import { Check, Copy } from 'lucide-react';
import { useLocale } from '../../stores/locale-store.js';
import type { RouteRecord } from '../../stores/types.js';

export const ConnectionGuidance = ({ route, incoming }: { route: RouteRecord; incoming: string }) => {
  const { t } = useLocale();
  const upstream = route.upstreamUrl || route.targetUrl || '';
  const steps = ['discover', 'upstream', 'test', 'record', 'switch'];
  const probe = `npx corp-gate probe --connection ${route.prefix} --model YOUR_EXISTING_MODEL_ID --api-format API_FORMAT`;
  const note = [t('onboarding.noteTitle'), route.name, t('onboarding.noteSource'), t('onboarding.notePrevious'), `${t('onboarding.providerLabel')}: ${upstream}`, `${t('onboarding.clientLabel')}: ${incoming}`, t('onboarding.noteAuthentication'), ...steps.map((step, index) => `${index + 1}. ${t('onboarding.' + step)}`), t('onboarding.probe'), 'npx corp-gate doctor', probe, t('onboarding.probeAuth'), t('onboarding.recoveryTitle'), 'npx corp-gate status', 'npx corp-gate start', t('onboarding.recovery'), t('onboarding.recoveryConfig'), t('onboarding.noteRestore'), t('onboarding.autostart')].join('\n\n');

  return (
    <Stack gap="sm">
      <Text fw={600}>{t('onboarding.beforeTitle')}</Text>
      {steps.map((step, index) => (
        <Stack key={step} gap={2}>
          <Text size="sm" fw={600}>{index + 1}. {t('onboarding.' + step + 'Title')}</Text>
          <Text size="sm">{t('onboarding.' + step)}</Text>
        </Stack>
      ))}
      <Paper withBorder p="sm">
        <Stack gap="xs">
          <Text size="xs" c="dimmed">{t('onboarding.providerLabel')}</Text>
          <Code block>{upstream || t('connections.addressUnavailable')}</Code>
          <Text size="xs" c="dimmed">{t('onboarding.clientLabel')}</Text>
          <Code block>{incoming}</Code>
          <CopyButton value={note}>
            {({ copied, copy }) => <Button variant="light" size="xs" leftSection={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>{copied ? t('common.copied') : t('onboarding.copyNote')}</Button>}
          </CopyButton>
        </Stack>
      </Paper>
      <Accordion variant="separated">
        <Accordion.Item value="checks">
          <Accordion.Control>{t('onboarding.probeTitle')}</Accordion.Control>
          <Accordion.Panel><Stack gap="xs"><Text size="sm">{t('onboarding.probe')}</Text><Code block>npx corp-gate doctor</Code><Code block>{probe}</Code><Text size="sm">{t('onboarding.probeAuth')}</Text></Stack></Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="recovery">
          <Accordion.Control>{t('onboarding.recoveryTitle')}</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="xs">
              <Text size="sm">{t('onboarding.recovery')}</Text>
              <Group gap="xs"><Code>npx corp-gate status</Code><Code>npx corp-gate start</Code></Group>
              <Text size="sm">{t('onboarding.recoveryConfig')}</Text>
              <Text size="sm">{t('onboarding.autostart')}</Text>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
};
