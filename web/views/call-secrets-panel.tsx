import { Group, Spoiler, Stack, Text } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { SessionAliases } from '../models/session-aliases.js';
import { SecretTokenBadge } from './secret-token-badge.js';

export const CallSecretsPanel = ({ entries, available }: { entries: SessionAlias[]; available: boolean }) => {
  const { t } = useLocale();
  const sorted = SessionAliases.frequency(entries);
  return <Stack gap={4} miw={0} role="region" aria-label={t('callSecrets.ariaLabel')}>
      <Group justify="space-between" wrap="nowrap" gap={6}><Group gap={6} wrap="nowrap"><Text size="xs" fw={600}>{t('callSecrets.heading')}</Text><Text size="xs" c="dimmed" data-substitution-total aria-label={`${t('callSecrets.uniqueTitle')}: ${available ? entries.length : '—'}`}>{available ? entries.length : '—'}</Text></Group><Text size="xs" c="dimmed">{t('sessionView.listScope')}</Text></Group>
      {!available && <Text size="xs">{t('exchange.notSaved')}</Text>}
      {available && !entries.length && <Text size="xs" c="dimmed">{t('callSecrets.empty')}</Text>}
      {available && entries.length > 0 && <Spoiler fz="xs" maxHeight={52} transitionDuration={0} showLabel={t('sessionView.listShowMore')} hideLabel={t('sessionView.listShowLess')}><Group gap={4} align="flex-start" role="list">{sorted.map(item => <SecretTokenBadge key={item.alias} token={item.alias} baseKey={item.key} realValue={item.realValue} format={item.format} entryExists={item.known} valueHidden={item.valueHidden} summaryCount={SessionAliases.knownCount(item) ?? null} />)}</Group></Spoiler>}
    </Stack>;
};
