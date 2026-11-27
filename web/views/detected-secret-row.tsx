import { ActionIcon, Badge, Code, CopyButton, Group, Table, Text, Tooltip } from '@mantine/core';
import { BookmarkPlus, Check, Copy, Trash2 } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { vaultStore } from '../stores/vault-store.js';
import type { SecretRecord } from '../stores/types.js';

export interface DetectedRowProps { secret: SecretRecord; highlighted?: boolean; onCopy: (value: string, copy?: () => void) => void; onDelete: (key: string) => void; }

export const DetectedSecretRow = ({ secret, highlighted, onCopy, onDelete }: DetectedRowProps) => {
  const { t } = useLocale();
  const value = secret.realValue;
  const hidden = secret.valueHidden;
  const validHits = Number.isSafeInteger(secret.hitCount) && secret.hitCount! >= 0;
  return <Table.Tr data-secret-record={secret.key} tabIndex={-1} bg={highlighted ? 'blue.9' : undefined}>
    <Table.Td><Group gap="xs" wrap="nowrap">
      <Text fw={600} size="sm">{secret.key}</Text>
      <CopyButton value={secret.alias}>{({ copied, copy }) => <Tooltip label={t(copied ? 'common.copied' : 'vault.copyToken')}><ActionIcon aria-label={t('vault.copyToken')} size="sm" variant="subtle" onClick={() => onCopy(secret.alias, copy)}>{copied ? <Check size={12} /> : <Copy size={12} />}</ActionIcon></Tooltip>}</CopyButton>
    </Group></Table.Td>
    <Table.Td><Group gap="xs" wrap="nowrap">
      {hidden ? <Text size="sm" c="dimmed">{t('exchange.valueHidden')}</Text> : value === undefined ? <Text size="sm">—</Text> : value === '' ? <Text size="sm" c="dimmed" fs="italic">{t('common.emptyString')}</Text> : <Code>{value}</Code>}
      {!hidden && value !== undefined && <CopyButton value={value}>{({ copied, copy }) => <Tooltip label={t(copied ? 'common.copied' : 'vault.copyItem', { name: secret.key })}><ActionIcon aria-label={t('vault.copyItem', { name: secret.key })} size="sm" variant="subtle" onClick={() => onCopy(value, copy)}>{copied ? <Check size={12} /> : <Copy size={12} />}</ActionIcon></Tooltip>}</CopyButton>}
    </Group></Table.Td>
    <Table.Td w={104}><Tooltip label={t(validHits ? 'rules.hitsCount' : 'detectionGroups.hitsUnknown')}><Badge size="sm" variant="light">{validHits ? secret.hitCount : '—'}</Badge></Tooltip></Table.Td>
    <Table.Td w={96}><Group gap={6} wrap="nowrap" justify="flex-end">
      <Tooltip label={t('rules.saveToVault')}><ActionIcon size="sm" variant="light" color="teal" aria-label={t('rules.saveToVault')} onClick={() => vaultStore.promoteSecret(secret.key)}><BookmarkPlus size={15} /></ActionIcon></Tooltip>
      <Tooltip label={t('common.delete')}><ActionIcon size="sm" variant="subtle" c="red" aria-label={t('common.delete')} onClick={() => onDelete(secret.key)}><Trash2 size={15} /></ActionIcon></Tooltip>
    </Group></Table.Td>
  </Table.Tr>;
};
