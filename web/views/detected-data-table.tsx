import { Fragment, useEffect, useId, useMemo, useState } from 'react';
import { Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { DetectionGroups } from '../models/detection-groups.js';
import type { SecretRecord } from '../stores/types.js';
import { DetectedSecretRow, type DetectedRowProps } from './detected-secret-row.js';

export const DetectedDataTable = ({ records, highlightedKey, onCopy, onDelete }: { records: SecretRecord[]; highlightedKey: string | null; onCopy: DetectedRowProps['onCopy']; onDelete: DetectedRowProps['onDelete'] }) => {
  const { t } = useLocale();
  const baseId = useId();
  const groups = useMemo(() => DetectionGroups.build(records), [records]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    const target = groups.find(group => group.prefix && group.records.some(record => record.key === highlightedKey));
    if (target) setExpanded(prior => new Set([...prior, target.id]));
  }, [groups, highlightedKey]);
  const toggle = (id: string) => setExpanded(prior => { const next = new Set(prior); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Stack gap="xs">
    <Text size="xs" c="dimmed" px="sm" pt="sm">{t('detectionGroups.scope')}</Text>
    <Table.ScrollContainer minWidth={620}>
      <Table highlightOnHover withColumnBorders verticalSpacing="sm" aria-label={t('rules.tabDetections')}>
        <Table.Thead><Table.Tr><Table.Th>{t('rules.colToken')}</Table.Th><Table.Th>{t('rules.colValue')}</Table.Th><Table.Th w={104}>{t('rules.colHits')}</Table.Th><Table.Th w={96} aria-label={t('rules.colActions')} /></Table.Tr></Table.Thead>
        {groups.map((group, index) => {
          const open = expanded.has(group.id);
          const contentId = `${baseId}-${index}-rows`;
          const controlId = `${baseId}-${index}-toggle`;
          return <Fragment key={group.id}>
            {group.prefix && <Table.Tbody><Table.Tr bg="dark.6" data-detection-group={group.prefix}>
              <Table.Th scope="row"><Button id={controlId} variant="subtle" color="gray" size="sm" leftSection={open ? <ChevronDown size={16} /> : <ChevronRight size={16} />} onClick={() => toggle(group.id)} aria-label={t('detectionGroups.toggle', { name: group.prefix })} aria-expanded={open} aria-controls={contentId}>{group.prefix}</Button></Table.Th>
              <Table.Td><Badge variant="outline" size="sm">{t('vault.recordsCount', { count: group.records.length })}</Badge></Table.Td>
              <Table.Td><Text size="xs" aria-label={t('detectionGroups.groupHits')}>{group.unknownHits ? t('detectionGroups.partialHits', { known: group.hits, unknown: group.unknownHits }) : group.hits}</Text></Table.Td><Table.Td />
            </Table.Tr></Table.Tbody>}
            <Table.Tbody id={contentId} hidden={Boolean(group.prefix && !open)} aria-labelledby={group.prefix ? controlId : undefined}>
              {group.records.map(secret => <DetectedSecretRow key={secret.key} secret={secret} highlighted={secret.key === highlightedKey} onCopy={onCopy} onDelete={onDelete} />)}
            </Table.Tbody>
          </Fragment>;
        })}
      </Table>
    </Table.ScrollContainer>
  </Stack>;
};
