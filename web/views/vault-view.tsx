import { useEffect } from 'react';
import { ActionIcon, Alert, Badge, Button, Card, Code, CopyButton, Group, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Check, Copy, Eye, EyeOff, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { useNavigation } from '../stores/navigation-store.js';
import { useVault, vaultStore } from '../stores/vault-store.js';
import { SecretModal } from './modals/secret-modal.js';

export const VaultView = () => {
  const { t } = useLocale();
  const { manualSecrets, searchQuery, togglingKeys, revealedKeys, cleanupPending } = useVault();
  const { highlightedSecretKey } = useNavigation();

  useEffect(() => {
    vaultStore.fetchData();
  }, []);

  const filtered = vaultStore.getFilteredManual();

  const openDeleteConfirm = (key: string) => {
    modals.openConfirmModal({
      title: t('vault.deleteConfirmTitle', { name: key }),
      children: <Text size="sm">{t('vault.deleteConfirmNote')}</Text>,
      labels: { confirm: t('dialogs.delete'), cancel: t('dialogs.keep') },
      confirmProps: { color: 'red' },
      onConfirm: () => vaultStore.deleteSecret(key),
    });
  };

  const handleCopy = async (val: string, copyFn?: () => void) => {
    try {
      await navigator.clipboard.writeText(val);
      copyFn?.();
      notifications.show({ message: t('toasts.copied'), color: 'teal' });
    } catch {
      notifications.show({ message: t('toasts.copyFailed'), color: 'red' });
    }
  };

  return (
    <Stack gap="md">
      <Card withBorder padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Stack gap={4}>
            <Title order={3}>{t('vault.heading')}</Title>
            <Text size="sm" c="dimmed">{t('vault.description')}</Text>
          </Stack>
          <Button variant="filled" leftSection={<Plus size={16} />} onClick={vaultStore.openCreateModal}>
            {t('vault.addBtn')}
          </Button>
        </Group>
      </Card>

      <TextInput
        placeholder={t('vault.searchPlaceholder')}
        aria-label={t('vault.searchAria')}
        leftSection={<Search size={16} />}
        value={searchQuery}
        onChange={e => vaultStore.setSearchQuery(e.currentTarget.value)}
      />

      {cleanupPending && (
        <Alert color="yellow">{t('vault.cleanupNotice')}</Alert>
      )}

      {manualSecrets.length === 0 ? (
        <Card withBorder padding="xl">
          <Text ta="center" c="dimmed">{t('vault.empty')}</Text>
        </Card>
      ) : filtered.length === 0 ? (
        <Card withBorder padding="xl">
          <Text ta="center" c="dimmed">{t('common.noMatches')}</Text>
        </Card>
      ) : (
        <Card withBorder padding={0} aria-label={t('vault.recordsAria')}>
          <Table highlightOnHover withColumnBorders verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('vault.colName')}</Table.Th>
                <Table.Th>{t('vault.colValue')}</Table.Th>
                <Table.Th w={84}>{t('vault.colStorage')}</Table.Th>
                <Table.Th w={104}>{t('vault.colEncrypt')}</Table.Th>
                <Table.Th w={96} aria-label={t('vault.colActions')} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {filtered.map(secret => {
                const isHighlighted = highlightedSecretKey === secret.key;
                const isToggling = togglingKeys.includes(secret.key);
                const isRevealed = revealedKeys.includes(secret.key);
                return (
                  <Table.Tr
                    key={secret.key}
                    data-secret-record={secret.key}
                    tabIndex={-1}
                    bg={isHighlighted ? 'blue.9' : undefined}
                  >
                    <Table.Td>
                      <Stack gap={4}>
                        <Group gap="xs" wrap="nowrap">
                          <Text fw={600} size="sm">{secret.key}</Text>
                          <CopyButton value={secret.alias} timeout={1500}>
                            {({ copied, copy }) => (
                              <Tooltip label={copied ? t('common.copied') : t('vault.copyToken')}>
                                <ActionIcon size="xs" variant="subtle" onClick={() => handleCopy(secret.alias, copy)}>
                                  {copied ? <Check size={12} /> : <Copy size={12} />}
                                </ActionIcon>
                              </Tooltip>
                            )}
                          </CopyButton>
                        </Group>
                        {secret.description && secret.description !== 'Promoted from auto-secret' && (
                          <Text size="xs" c="dimmed">{secret.description}</Text>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        {secret.isSecret ? (
                          isRevealed ? (
                            <>
                              {secret.realValue === undefined ? <Text size="sm">—</Text> : secret.realValue === '' ? <Text size="sm" c="dimmed" fs="italic">{t('common.emptyVal')}</Text> : <Code>{secret.realValue}</Code>}
                              {secret.realValue !== undefined && secret.realValue !== '' && (
                                <CopyButton value={secret.realValue} timeout={1500}>
                                  {({ copied, copy }) => (
                                    <Tooltip label={copied ? t('common.copied') : t('vault.copyItem', { name: secret.key })}>
                                      <ActionIcon size="xs" variant="subtle" onClick={() => handleCopy(secret.realValue!, copy)}>
                                        {copied ? <Check size={12} /> : <Copy size={12} />}
                                      </ActionIcon>
                                    </Tooltip>
                                  )}
                                </CopyButton>
                              )}
                              <Tooltip label={t('vault.hideValue')}>
                                <ActionIcon size="xs" variant="subtle" aria-label={t('vault.hideValue')} onClick={() => vaultStore.toggleRevealSecret(secret.key)}>
                                  <EyeOff size={13} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          ) : (
                            <>
                              <Text size="xs" c="dimmed" ff="monospace">••••••••••••••••</Text>
                              <Tooltip label={t('vault.revealValue')}>
                                <ActionIcon size="xs" variant="subtle" aria-label={t('vault.revealValue')} onClick={() => vaultStore.toggleRevealSecret(secret.key)}>
                                  <Eye size={13} />
                                </ActionIcon>
                              </Tooltip>
                            </>
                          )
                        ) : (
                          <>
                            {secret.realValue === undefined ? <Text size="sm">—</Text> : secret.realValue === '' ? <Text size="sm" c="dimmed" fs="italic">{t('common.emptyVal')}</Text> : <Code>{secret.realValue}</Code>}
                            {secret.realValue !== undefined && secret.realValue !== '' && (
                              <CopyButton value={secret.realValue} timeout={1500}>
                                {({ copied, copy }) => (
                                  <Tooltip label={copied ? t('common.copied') : t('vault.copyItem', { name: secret.key })}>
                                    <ActionIcon size="xs" variant="subtle" onClick={() => handleCopy(secret.realValue!, copy)}>
                                      {copied ? <Check size={12} /> : <Copy size={12} />}
                                    </ActionIcon>
                                  </Tooltip>
                                )}
                              </CopyButton>
                            )}
                          </>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td w={84}>
                      {secret.isSecret ? (
                        <Badge size="xs" color="indigo" variant="light">{t('vault.badgeDpapi')}</Badge>
                      ) : (
                        <Badge size="xs" color="gray" variant="outline">{t('vault.badgePlain')}</Badge>
                      )}
                    </Table.Td>
                    <Table.Td w={104}>
                      <Group gap="xs" wrap="nowrap">
                        <Switch
                          checked={Boolean(secret.maskInAi)}
                          disabled={isToggling}
                          aria-label={'Encrypt: ' + secret.key}
                          onChange={() => vaultStore.toggleSecretMasking(secret.key)}
                        />
                        <Text size="xs" fw={500}>{secret.maskInAi ? 'ON' : 'OFF'}</Text>
                      </Group>
                    </Table.Td>
                    <Table.Td w={96}>
                      <Group gap={6} wrap="nowrap" justify="flex-end">
                        <Tooltip label={t('common.edit')}>
                          <ActionIcon size="sm" variant="subtle" aria-label={t('common.edit')} onClick={() => vaultStore.openEditModal(secret.key)}>
                            <Pencil size={15} />
                          </ActionIcon>
                        </Tooltip>
                        <Tooltip label={t('common.delete')}>
                          <ActionIcon size="sm" variant="subtle" c="red" aria-label={t('common.delete')} onClick={() => openDeleteConfirm(secret.key)}>
                            <Trash2 size={15} />
                          </ActionIcon>
                        </Tooltip>
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Card>
      )}

      <SecretModal />
    </Stack>
  );
};
