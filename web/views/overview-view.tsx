import { Alert, Badge, Card, Group, Stack, Text } from '@mantine/core';
import { Radio } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { overviewStore, useOverview } from '../stores/overview-store.js';
import { CallInspector } from './call-inspector.js';
import { ConnectionsBar } from './connections-bar.js';
import { SessionsList } from './sessions-list.js';

export const OverviewView = () => {
  const { t } = useLocale();
  const overview = useOverview();
  const routeSessions = overviewStore.getFilteredSessions();

  return (
    <Stack gap="md" w="100%">
      <ConnectionsBar />
      <Group justify="space-between" align="center" wrap="nowrap">
        <Group gap="xs" align="center">
          <Badge size="xs" variant="dot" color={overview.live ? 'teal' : 'yellow'}>
            {overview.live ? t('overview.eventsConnected') : t('overview.reconnecting')}
          </Badge>
          {overview.pendingCount > 0 && (
            <Text size="xs" c="dimmed">
              {t('overview.executingRequests', { count: overview.pendingCount })}
            </Text>
          )}
        </Group>
      </Group>
      {overview.error && (
        <Alert color="red" role="alert">
          {t(overview.step ? 'overview.refreshError' : overview.selectedSession ? 'sessionView.loadError' : 'sessionView.loadDataError', { error: overview.error })}
        </Alert>
      )}
      {routeSessions.length === 0 ? (
        <Card withBorder p="xl" w="100%">
          <Stack align="center" justify="center" h={300} gap="xs">
            <Radio size={32} />
            <Text fw={600} role="status">{t(overview.loading ? 'sessionView.loading' : 'overview.noRequests')}</Text>
            {!overview.loading && <Text size="sm" c="dimmed" ta="center">{t('overview.noRequestsDesc')}</Text>}
          </Stack>
        </Card>
      ) : (
        <Group align="flex-start" wrap="nowrap" gap="md" w="100%">
          <SessionsList />
          <Stack flex={1} miw={0}><CallInspector key={overview.displayedSession} /></Stack>
        </Group>
      )}
    </Stack>
  );
};
