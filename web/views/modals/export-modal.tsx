import { useRef, useState } from 'react';
import { Alert, Anchor, Button, Checkbox, Group, Modal, Stack, Text } from '@mantine/core';
import { Download } from 'lucide-react';
import { apiClient } from '../../stores/api-client.js';
import { useLocale } from '../../stores/locale-store.js';
import { navigationStore, useNavigation } from '../../stores/navigation-store.js';

export const ExportModal = () => {
  const { t } = useLocale();
  const { exportModalOpen } = useNavigation();
  const [selected, setSelected] = useState<string[]>(['connections', 'patterns', 'secrets', 'hooks', 'proxy,settings']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const anchorRef = useRef<HTMLAnchorElement>(null);

  const handleClose = () => {
    setError(null);
    navigationStore.setExportModalOpen(false);
  };

  const handleDownload = async () => {
    if (selected.length === 0) {
      setError(t('dialogs.selectOneSection'));
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await apiClient.exportConfig(selected);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const name = `corpgate-export-${new Date().toISOString().slice(0, 10)}.json`;
      if (anchorRef.current) {
        anchorRef.current.href = url;
        anchorRef.current.download = name;
        anchorRef.current.click();
      }
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      handleClose();
    } catch (err: unknown) {
      setError((err as Error)?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      opened={exportModalOpen}
      onClose={handleClose}
      title={<Text fw={600}>{t('dialogs.exportHeading')}</Text>}
      size="md"
      centered
      trapFocus
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">{t('dialogs.exportHelp')}</Text>
        {error && <Alert color="red">{error}</Alert>}
        <Checkbox.Group
          label={t('dialogs.whatToInclude')}
          value={selected}
          onChange={val => {
            setSelected(val);
            if (val.length > 0) setError(null);
          }}
        >
          <Stack gap="xs" mt="xs">
            <Checkbox value="connections" label={t('dialogs.groups.connections')} />
            <Checkbox value="patterns" label={t('dialogs.groups.patterns')} />
            <Checkbox value="secrets" label={t('dialogs.groups.secrets')} />
            <Checkbox value="hooks" label={t('dialogs.groups.hooks')} />
            <Checkbox value="proxy,settings" label={t('dialogs.groups.settings')} />
          </Stack>
        </Checkbox.Group>

        <Anchor ref={anchorRef} display="none">download</Anchor>

        <Group justify="flex-end" gap="xs" mt="md">
          <Button variant="default" onClick={handleClose}>{t('dialogs.close')}</Button>
          <Button
            variant="filled"
            leftSection={<Download size={15} />}
            onClick={handleDownload}
            loading={loading}
            disabled={selected.length === 0}
          >
            {t('dialogs.downloadJson')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
};
