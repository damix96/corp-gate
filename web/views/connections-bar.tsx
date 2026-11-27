import { useState } from 'react';
import { ActionIcon, Button, Card, Code, CopyButton, Group, Paper, Stack, Tabs, Text, Tooltip } from '@mantine/core';
import { Check, Copy, Plus } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { connectionsStore, useConnections } from '../stores/connections-store.js';
import { ConnectionCreateModal, ConnectionInstructionsModal, ConnectionSettingsModal } from './modals/connection-modal.js';

export const ConnectionsBar = () => {
  const { t } = useLocale();
  const conn = useConnections();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  const visibleRoutes = conn.routes.filter(r => conn.workspace.visible.includes(r.id));
  const activeRoute = conn.routes.find(r => r.id === conn.workspace.selected) || visibleRoutes[0] || null;

  const handleTabChange = (val: string | null) => {
    if (val && val !== conn.workspace.selected) connectionsStore.selectRoute(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) || visibleRoutes.length === 0) return;
    e.preventDefault();
    const idx = visibleRoutes.findIndex(r => r.id === conn.workspace.selected);
    let nextIdx = idx;
    if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + visibleRoutes.length) % visibleRoutes.length;
    else if (e.key === 'ArrowRight') nextIdx = (idx + 1) % visibleRoutes.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = visibleRoutes.length - 1;
    if (nextIdx !== idx) {
      const nextId = visibleRoutes[nextIdx].id;
      connectionsStore.selectRoute(nextId);
      requestAnimationFrame(() => {
        const tabEl = document.querySelector<HTMLElement>(`button[role="tab"][data-value="${nextId}"]`);
        tabEl?.focus?.({ preventScroll: true });
      });
    }
  };

  if (conn.routes.length === 0 && !conn.loading) {
    return (
      <Card withBorder p="lg">
        <Stack align="center" gap="xs">
          <Text fw={600}>{t('connections.notAdded')}</Text>
          <Text size="sm" c="dimmed">{t('connections.notAddedDesc')}</Text>
          <Button leftSection={<Plus size={16} />} onClick={() => setCreateOpen(true)}>{t('connections.addBtn')}</Button>
        </Stack>
        <ConnectionCreateModal opened={createOpen} onClose={() => setCreateOpen(false)} />
      </Card>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:4000';
  const incoming = activeRoute ? (activeRoute.incomingUrl || activeRoute.cliUrl || `${origin}/${activeRoute.prefix}`) : '';

  return (
    <Stack gap="xs" onKeyDown={handleKeyDown} tabIndex={0}>
      <Group justify="space-between" align="center" wrap="nowrap">
        <Tabs value={conn.workspace.selected} onChange={handleTabChange} variant="outline" aria-label={t('connections.tabsAria')}>
          <Tabs.List>
            {visibleRoutes.map(route => (
              <Tabs.Tab key={route.id} value={route.id}>
                {route.name}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>
        <Tooltip label={t('connections.addConnectionAria')}>
          <ActionIcon variant="light" size="sm" aria-label={t('connections.addConnectionAria')} onClick={() => setCreateOpen(true)}>
            <Plus size={16} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {activeRoute && (
        <Paper withBorder p="xs">
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Group gap="xs" wrap="nowrap" align="center">
              <Code fz="sm">{incoming}</Code>
              <CopyButton value={incoming}>
                {({ copied, copy }) => (
                  <Tooltip label={t('connections.copyAddress')}>
                    <ActionIcon size="xs" variant="subtle" color={copied ? 'teal' : 'gray'} onClick={copy}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>

            <Group gap="xs" wrap="nowrap" align="center">
              <Button size="xs" variant="default" onClick={() => setInstructionsOpen(true)}>
                {t('connections.howToConnect')}
              </Button>
              <Button size="xs" variant="default" onClick={() => setSettingsOpen(true)}>
                {t('connections.settingsBtn')}
              </Button>
            </Group>
          </Group>
        </Paper>
      )}

      <ConnectionCreateModal opened={createOpen} onClose={() => setCreateOpen(false)} />
      <ConnectionSettingsModal route={activeRoute} opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <ConnectionInstructionsModal route={activeRoute} opened={instructionsOpen} onClose={() => setInstructionsOpen(false)} />
    </Stack>
  );
};
