import { useState, useMemo } from 'react';
import { ActionIcon, Card, Code, Group, Paper, ScrollArea, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { Clock, Search, X } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { overviewStore, useOverview } from '../stores/overview-store.js';
import { RelativeTime } from './relative-time.js';

export const SessionsList = () => {
  const { t } = useLocale();
  const overview = useOverview();
  const [query, setQuery] = useState('');

  const routeSessions = overviewStore.getFilteredSessions();

  const filteredSessions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return routeSessions;
    return routeSessions.filter(s => [s.id, s.client, s.name, overview.sessionPreviews[s.id]].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [routeSessions, query, overview.sessionPreviews]);

  return (
    <Card withBorder p="xs" w={240} miw={240} aria-label={t('overview.sessionsAria')}>
      <Stack gap="xs" h="100%" miw={0} w="100%">
        <TextInput size="xs" placeholder={t('sessionView.sessionSearch')} aria-label={t('sessionView.sessionSearch')} leftSection={<Search size={14} />} value={query} onChange={e => setQuery(e.currentTarget.value)} rightSection={query ? <ActionIcon size="xs" variant="subtle" aria-label={t('sessionView.clearSearch')} onClick={() => setQuery('')}><X size={12} /></ActionIcon> : null} />

        <ScrollArea.Autosize mah={520} w="100%" miw={0} scrollbars="y" scrollbarSize={12} offsetScrollbars="y">
          <Stack gap={6} w={206} maw="100%" miw={0}>
            {filteredSessions.length === 0 ? (
              <Paper p="sm" withBorder>
                <Text size="xs" c="dimmed" ta="center">{t('overview.noSessions')}</Text>
              </Paper>
            ) : (
              filteredSessions.map(session => {
                const isSelected = session.id === overview.selectedSession;
                const rawTs = session.lastSeen || session.timestamp;
                const title = session.name || overview.sessionPreviews[session.id];
                const client = session.client || t('overview.defaultClient');
                const details = [title, session.id, client].filter(Boolean).join('\n');

                return (
                  <Tooltip key={session.id} multiline w={320} color="dark.5" c="gray.0" withArrow events={{ hover: true, focus: true, touch: false }} label={<Textarea variant="unstyled" size="xs" readOnly autosize minRows={1} tabIndex={-1} aria-label={t('sessionView.sessionDetails')} value={details} />}>
                  <Paper
                    key={session.id}
                    withBorder
                    p="xs"
                    data-selected={isSelected ? 'true' : undefined}
                    bg={isSelected ? 'dark.5' : undefined}
                    onClick={() => overviewStore.selectSession(session.id)}
                    component="button" w="100%" miw={0} maw="100%" ta="left" aria-pressed={isSelected}
                  >
                    <Stack gap={2} miw={0} w="100%">
                      {title && <Text size="sm" fw={600} lineClamp={2} miw={0} maw="100%">{title}</Text>}
                      <Code fw={700} fz="xs" display="block" maw="100%"><Text component="span" inherit truncate display="block">{session.id}</Text></Code>
                      <Group justify="space-between" align="center" wrap="nowrap">
                        <Text size="xs" c="dimmed" flex={1} miw={0} truncate>{client}</Text>
                        <Group gap={4} wrap="nowrap" flex="0 0 auto" maw="100%">
                          <Clock size={10} />
                          <RelativeTime timestamp={rawTs} />
                        </Group>
                      </Group>
                    </Stack>
                  </Paper>
                  </Tooltip>
                );
              })
            )}
          </Stack>
        </ScrollArea.Autosize>
      </Stack>
    </Card>
  );
};
