import { useMemo } from 'react';
import { ActionIcon, Badge, Card, CopyButton, Group, SegmentedControl, Select, Stack, Text, Textarea, Tooltip } from '@mantine/core';
import { Check, Copy, Info } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { navigationStore, useNavigation } from '../stores/navigation-store.js';
import { overviewStore, useOverview } from '../stores/overview-store.js';
import { SessionPayload } from '../models/session-payload.js';
import { SessionAliases } from '../models/session-aliases.js';
import { SessionDump } from './session-dump.js';
import { RelativeTime } from './relative-time.js';
import { SessionOccurrencesView } from './session-occurrences-view.js';
import { CallSecretsPanel } from './call-secrets-panel.js';

export const CallInspector = () => {
  const { t } = useLocale();
  const nav = useNavigation();
  const overview = useOverview();
  const step = overview.step;
  const aliases = useMemo(() => new SessionAliases(step || { timestamp: '' }), [step]);
  if (!step) return <Card withBorder p="lg" w="100%"><Text role="status">{t(overview.loading ? 'sessionView.loading' : 'exchange.savedContentUnavailable')}</Text></Card>;
  const mode = nav.mode === 'simple' ? 'changes' : overview.contentMode;
  const active = step.state === 'active' || step.responseChanges?.status === 'pending';
  const status = SessionPayload.object(step.response).status ?? step.status;
  const identity = step.sessionId || overview.displayedSession || '—';
  const masked = SessionPayload.parse(step.maskedPrompt);
  return <Stack gap="md" w="100%" miw={0} aria-busy={overview.loading} data-session-inspector="occurrences-v2">
    <Group justify="space-between" align="center" gap="xs">
      <Group gap={6} wrap="nowrap" miw={0}>
        <Tooltip label={identity}><Text size="xs" c="dimmed" lineClamp={1}>{t('callHeader.session')} · {identity.slice(0, 24)}{identity.length > 24 ? '…' : ''}</Text></Tooltip>
        <CopyButton value={identity}>{({ copied, copy }) => <ActionIcon disabled={overview.loading} size="sm" variant="subtle" onClick={copy} aria-label={t('callHeader.copySessionId')}>{copied ? <Check size={14} /> : <Copy size={14} />}</ActionIcon>}</CopyButton>
        <Tooltip multiline w={320} label={t('occurrences.scope')}><ActionIcon size="sm" variant="subtle" color="gray" aria-label={t('occurrences.scopeLabel')}><Info size={15} /></ActionIcon></Tooltip>
      </Group>
      <Group gap="xs">{overview.loading ? <Text size="xs" c="dimmed" role="status">{t('sessionView.loadingPrevious')}</Text> : <RelativeTime timestamp={step.timestamp} />}{active && <Badge size="sm">{t('callHeader.executing')}</Badge>}{nav.mode === 'advanced' && Boolean(status) && <Badge color={Number(status) >= 400 ? 'red' : 'gray'} variant="light">HTTP {String(status)}</Badge>}</Group>
    </Group>
    <Group justify="space-between" gap="xs" inert={overview.loading ? true : undefined}>
      {nav.mode === 'advanced' && <SegmentedControl size="xs" value={mode} onChange={v => overviewStore.setContentMode(v as 'changes' | 'full' | 'json')} data={[{ value: 'changes', label: t('exchange.modeChanges') }, { value: 'full', label: t('exchange.modeFull') }, { value: 'json', label: t('sessionView.technical') }]} aria-label={t('exchange.viewModesAria')} />}
      <Select size="xs" w={160} value={nav.messageOrder} allowDeselect={false} onChange={v => { if (v === 'newest' || v === 'oldest') navigationStore.setMessageOrder(v); }} data={[{ value: 'newest', label: t('exchange.orderNewest') }, { value: 'oldest', label: t('exchange.orderOldest') }]} aria-label={t('exchange.orderAria')} />
    </Group>
    <Stack gap="md" miw={0} inert={overview.loading ? true : undefined} opacity={overview.loading ? 0.5 : 1}>
    <CallSecretsPanel entries={aliases.used(masked)} available={masked !== undefined && masked !== null} />
    <Stack miw={0} data-session-content>
    {mode === 'json' ? <Stack gap="xs">
      <Text size="xs" c="dimmed">{t('sessionView.technicalScope')}</Text>
      <SessionDump label={t('exchange.savedHttpRequest')} value={step.request} />
      <SessionDump label={t('occurrences.sentRequest')} value={SessionPayload.parse(step.maskedPrompt)} />
      <SessionDump label={t('exchange.savedHttpResponse')} value={step.response} />
    </Stack> : <SessionOccurrencesView step={step} aliases={aliases} full={mode === 'full'} newest={nav.messageOrder === 'newest'} />}
    </Stack>
    {nav.mode === 'advanced' && active && !overview.loading && !overview.error && overview.streamText && <Stack gap="xs" data-live-response><Textarea label={t('sessionView.livePreview')} description={t('sessionView.livePreviewScope')} value={overview.streamText} readOnly autosize minRows={2} ff="monospace" size="xs" /></Stack>}
    </Stack>
  </Stack>;
};
