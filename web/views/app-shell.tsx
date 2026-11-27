import { useEffect, useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import { Alert, AppShell, Badge, Button, Container, Group, SegmentedControl, Tabs, Title } from '@mantine/core';
import { Download, Globe, KeyRound, Radar, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { useAuth } from '../stores/auth-store.js';
import { navigationStore, useNavigation, type MainTab } from '../stores/navigation-store.js';
import { vaultStore } from '../stores/vault-store.js';
import { AuthView } from './auth-view.js';
import { ExportModal } from './modals/export-modal.js';
import { OverviewView } from './overview-view.js';
import { RulesView } from './rules-view.js';
import { VaultView } from './vault-view.js';

export const AppShellView = () => {
  const { locale, t, toggleLocale } = useLocale();
  const auth = useAuth();
  const nav = useNavigation();
  const wideHeader = useMediaQuery('(min-width: 48em)');
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    document.title = `CorpGate · ${t('nav.workspace')}`;
  }, [t, locale]);

  useEffect(() => {
    const findSecretTarget = (e: Event): HTMLElement | undefined => {
      const path = e.composedPath();
      for (const node of path) {
        if (node instanceof HTMLElement && (node.hasAttribute('data-secret-key') || node.hasAttribute('data-secret-open'))) {
          return node;
        }
      }
      return undefined;
    };
    const handleGlobalClick = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = findSecretTarget(e);
      if (!target) return;
      const key = target.getAttribute('data-secret-key') || target.getAttribute('data-secret-open');
      if (!key || (typeof window !== 'undefined' && Boolean(window.getSelection()?.toString().trim()))) return;
      if (e.ctrlKey || e.metaKey || target.hasAttribute('data-secret-open')) {
        e.preventDefault();
        e.stopPropagation();
        vaultStore.navigateToSecret(key);
      }
    };
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.repeat) {
        const target = findSecretTarget(e);
        if (!target) return;
        const key = target.getAttribute('data-secret-key') || target.getAttribute('data-secret-open');
        if (!key || (typeof window !== 'undefined' && Boolean(window.getSelection()?.toString().trim()))) return;
        e.preventDefault();
        e.stopPropagation();
        vaultStore.navigateToSecret(key);
      }
    };
    const handleError = (e: ErrorEvent) => setStartupError(e.message || String(e.error));

    window.addEventListener('keydown', handleGlobalKeyDown, true);
    window.addEventListener('click', handleGlobalClick, true);
    window.addEventListener('error', handleError);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, true);
      window.removeEventListener('click', handleGlobalClick, true);
      window.removeEventListener('error', handleError);
    };
  }, []);

  const handleTabChange = (val: string | null) => {
    if (val) navigationStore.setTab(val as MainTab);
  };

  return (
    <AppShell header={{ height: { base: 112, sm: 64 } }} padding="md">
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group justify="space-between" align="center" h="100%" wrap="wrap" gap="xs">
            <Group gap="xs" wrap="nowrap" flex={{ base: '1 0 100%', sm: '0 1 auto' }} justify="space-between">
              <Button component="a" href="#overview" role="button" variant="subtle" p={0} onClick={() => navigationStore.setTab('overview')}>
                <Group gap="xs" wrap="nowrap">
                  <Badge size="lg" radius="sm" variant="filled" color="indigo" aria-hidden="true">C</Badge>
                  <Title order={4} visibleFrom="md">CorpGate</Title>
                </Group>
              </Button>
              {!auth.required && (
                <Tabs value={nav.activeTab} onChange={handleTabChange} variant="pills" aria-label={t('nav.mainNavAria')}>
                  <Tabs.List>
                    <Tabs.Tab value="overview" leftSection={wideHeader ? <Radar size={16} /> : undefined}>{t('nav.overview')}</Tabs.Tab>
                    <Tabs.Tab value="secrets" leftSection={wideHeader ? <KeyRound size={16} /> : undefined}>{t('nav.vault')}</Tabs.Tab>
                    <Tabs.Tab value="rules" leftSection={wideHeader ? <ShieldCheck size={16} /> : undefined}>{t('nav.rules')}</Tabs.Tab>
                  </Tabs.List>
                </Tabs>
              )}
            </Group>

            <Group gap="xs" wrap="nowrap">
              {!auth.required && !nav.online && (
                <Badge color="red" variant="filled" leftSection={<ShieldAlert size={14} />}>
                  {t('status.noConnection')}
                </Badge>
              )}
              {!auth.required && (
                <>
                  <SegmentedControl size="xs" value={nav.mode} onChange={v => navigationStore.setMode(v as 'simple' | 'advanced')} data={[{ value: 'simple', label: t('nav.simpleMode') }, { value: 'advanced', label: t('nav.advancedMode') }]} aria-label={t('nav.modeSwitchAria')} />
                  <Button variant="default" size="xs" leftSection={<Download size={14} />} onClick={() => navigationStore.setExportModalOpen(true)}>
                    {t('nav.export')}
                  </Button>
                </>
              )}
              <Button variant="subtle" size="xs" leftSection={<Globe size={14} />} onClick={toggleLocale}>
                {locale === 'ru' ? 'EN' : 'RU'}
              </Button>
            </Group>
          </Group>
        </Container>
      </AppShell.Header>

      <AppShell.Main>
        <Container size="xl">
          {startupError && (
            <Alert id="startupError" role="alert" color="red" mb="md">
              {t('toasts.startupError', { error: startupError })}
            </Alert>
          )}
          {auth.required ? <AuthView /> : (
            <>
              {nav.activeTab === 'overview' && <OverviewView />}
              {nav.activeTab === 'secrets' && <VaultView />}
              {nav.activeTab === 'rules' && <RulesView />}
            </>
          )}
        </Container>
      </AppShell.Main>

      {!auth.required && <ExportModal />}
    </AppShell>
  );
};
