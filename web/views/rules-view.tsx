import { useEffect, useMemo, useState } from 'react';
import { Accordion, ActionIcon, Badge, Button, Card, Code, CopyButton, Group, Stack, Switch, Tabs, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { Check, Copy, Plus, Search } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { useNavigation, navigationStore, type RulesSubTab } from '../stores/navigation-store.js';
import { rulesStore, useRules } from '../stores/rules-store.js';
import { useVault, vaultStore } from '../stores/vault-store.js';
import { RuleModal } from './modals/rule-modal.js';
import { DetectedDataTable } from './detected-data-table.js';
import type { PatternRecord } from '../stores/types.js';

export const RulesView = () => {
  const { t } = useLocale();
  const { patterns, searchQuery, togglingIds } = useRules();
  const { autoSecrets } = useVault();
  const { rulesSubTab, highlightedSecretKey } = useNavigation();
  const [ruleFeedback, setRuleFeedback] = useState<Record<string, { message: string; color: string }>>({});

  useEffect(() => {
    rulesStore.fetchPatterns();
    vaultStore.fetchData();
  }, []);

  const filteredPatterns = rulesStore.getFilteredPatterns();

  const filteredAutoSecrets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return autoSecrets;
    return autoSecrets.filter(s =>
      s.key.toLowerCase().includes(q) ||
      (s.realValue && s.realValue.toLowerCase().includes(q)) ||
      (s.alias && s.alias.toLowerCase().includes(q)) ||
      (s.description && s.description.toLowerCase().includes(q))
    );
  }, [autoSecrets, searchQuery]);

  const handleTabsKeyDown = (e: React.KeyboardEvent) => {
    const tabs: RulesSubTab[] = ['rules', 'detections'];
    const curIdx = tabs.indexOf(rulesSubTab);
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const nextIdx = delta !== 0 ? (curIdx + delta + tabs.length) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (nextIdx >= 0) {
      e.preventDefault();
      navigationStore.setRulesSubTab(tabs[nextIdx]);
      setTimeout(() => (document.querySelector(`button[role="tab"][value="${tabs[nextIdx]}"]`) as HTMLElement | null)?.focus(), 10);
    }
  };

  const handleToggleRule = async (pattern: PatternRecord) => {
    const res = await rulesStore.togglePattern(pattern.id);
    const message = t(res.success ? 'toasts.changeSaved' : 'toasts.saveFailed', { error: res.error || '' });
    setRuleFeedback(prev => ({ ...prev, [pattern.id]: { message, color: res.success ? 'teal' : 'red' } }));
    setTimeout(() => setRuleFeedback(prev => { const n = { ...prev }; delete n[pattern.id]; return n; }), 2500);
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

  const openDeleteRuleConfirm = (pattern: PatternRecord) => modals.openConfirmModal({
    title: t('rules.deleteConfirmTitle', { name: t('rules.names.' + pattern.name) !== 'rules.names.' + pattern.name ? t('rules.names.' + pattern.name) : pattern.name }),
    children: <Text size="sm">{t('rules.deleteConfirmNote')}</Text>,
    labels: { confirm: t('dialogs.delete'), cancel: t('dialogs.keep') },
    confirmProps: { color: 'red' },
    onConfirm: () => rulesStore.deletePattern(pattern.id),
  });

  const openDeleteAutoConfirm = (key: string) => modals.openConfirmModal({
    title: t('vault.deleteAutoConfirmTitle', { name: key }),
    children: <Text size="sm">{t('vault.deleteAutoConfirmNote')}</Text>,
    labels: { confirm: t('dialogs.delete'), cancel: t('dialogs.keep') },
    confirmProps: { color: 'red' },
    onConfirm: () => vaultStore.deleteSecret(key, true),
  });

  return (
    <Stack gap="md">
      <Card withBorder padding="lg">
        <Group justify="space-between" align="center" wrap="wrap" gap="md">
          <Stack gap={4}><Title order={3}>{t('rules.heading')}</Title><Text size="sm" c="dimmed">{t('rules.description')}</Text></Stack>
          {rulesSubTab === 'rules' && <Button variant="filled" leftSection={<Plus size={16} />} onClick={rulesStore.openCreateModal}>{t('rules.addBtn')}</Button>}
        </Group>
      </Card>

      <Tabs value={rulesSubTab} onChange={val => navigationStore.setRulesSubTab((val as RulesSubTab) || 'rules')} onKeyDown={handleTabsKeyDown}>
        <Tabs.List aria-label={t('rules.tabsAria')}>
          <Tabs.Tab value="rules"><Group gap={6} wrap="nowrap"><Text size="sm">{t('rules.tabRules')}</Text><Badge size="xs" variant="light">{patterns.length}</Badge></Group></Tabs.Tab>
          <Tabs.Tab value="detections"><Group gap={6} wrap="nowrap"><Text size="sm">{t('rules.tabDetections')}</Text><Badge size="xs" variant="light">{autoSecrets.length}</Badge></Group></Tabs.Tab>
        </Tabs.List>

        <TextInput mt="md" placeholder={t('rules.searchPlaceholder')} aria-label={t('rules.searchPlaceholder')} leftSection={<Search size={16} />} value={searchQuery} onChange={e => rulesStore.setSearchQuery(e.currentTarget.value)} />

        <Tabs.Panel value="rules" pt="md">
          {patterns.length === 0 ? <Card withBorder padding="xl"><Text ta="center" c="dimmed">{t('rules.empty')}</Text></Card> : filteredPatterns.length === 0 ? <Card withBorder padding="xl"><Text ta="center" c="dimmed">{t('common.noMatches')}</Text></Card> : (
            <Stack gap="sm">
              {filteredPatterns.map(pattern => {
                const name = t('rules.names.' + pattern.name) !== 'rules.names.' + pattern.name ? t('rules.names.' + pattern.name) : pattern.name;
                const tokenTemplate = pattern.label_template || `AUTO_${(pattern.type || 'CUSTOM').toUpperCase()}_<${t('rules.hashPlaceholder')}>`;
                const feedback = ruleFeedback[pattern.id];
                const isToggling = togglingIds.includes(pattern.id);
                return (
                  <Card key={pattern.id} withBorder padding="md">
                    <Stack gap="xs">
                      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                        <Stack gap={2}><Text fw={600} size="sm">{name}</Text><Group gap={4} wrap="nowrap"><Text size="xs" c="dimmed">{t('rules.tokenTemplateLabel')}</Text><Code>{tokenTemplate}</Code></Group></Stack>
                        <Group gap="sm" wrap="nowrap">
                          {feedback && <Text role="status" size="xs" c={feedback.color}>{feedback.message}</Text>}
                          <Group gap="xs" wrap="nowrap">
                            <Switch checked={Boolean(pattern.enabled)} disabled={isToggling} aria-label={`${t('rules.searchAriaPrefix')}: ${name}`} onChange={() => handleToggleRule(pattern)} />
                            <Text size="xs" fw={500}>{t(pattern.enabled ? 'common.enabled' : 'common.disabled')}</Text>
                          </Group>
                          <Button size="xs" variant="default" onClick={() => rulesStore.openEditModal(pattern)}>{t('common.edit')}</Button>
                        </Group>
                      </Group>
                      <Accordion variant="separated">
                        <Accordion.Item value="details">
                          <Accordion.Control>{t('rules.expressionAndParams')}</Accordion.Control>
                          <Accordion.Panel>
                            <Group justify="space-between" mb={6}>
                              <Text size="xs" fw={600}>{t('ruleEditor.expressionHeading')}</Text>
                              <CopyButton value={pattern.pattern || pattern.regex || ''}>
                                {({ copied, copy }) => (<Tooltip label={copied ? t('common.copied') : t('rules.copyExpression')}><ActionIcon size="xs" variant="subtle" onClick={() => handleCopy(pattern.pattern || pattern.regex || '', copy)}>{copied ? <Check size={12} /> : <Copy size={12} />}</ActionIcon></Tooltip>)}
                              </CopyButton>
                            </Group>
                            <Code block mb="xs">{pattern.pattern || pattern.regex}</Code>
                            <Group justify="space-between" align="center" wrap="wrap" gap="xs">
                              <Text size="xs" c="dimmed">{t('rules.searchParamsLabel')} {pattern.id === 'pat_any_ip' ? t('rules.paramsAnyIp') : t('rules.paramsDefault')}</Text>
                              <Button size="xs" variant="subtle" c="red" onClick={() => openDeleteRuleConfirm(pattern)}>{t('rules.deleteBtn')}</Button>
                            </Group>
                          </Accordion.Panel>
                        </Accordion.Item>
                      </Accordion>
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="detections" pt="md">
          {autoSecrets.length === 0 ? <Card withBorder padding="xl"><Text ta="center" c="dimmed">{t('rules.emptyDetections')}</Text></Card> : filteredAutoSecrets.length === 0 ? <Card withBorder padding="xl"><Text ta="center" c="dimmed">{t('common.noMatches')}</Text></Card> : (
            <Card withBorder padding={0}>
              <DetectedDataTable records={filteredAutoSecrets} highlightedKey={highlightedSecretKey} onCopy={handleCopy} onDelete={openDeleteAutoConfirm} />
            </Card>
          )}
        </Tabs.Panel>
      </Tabs>
      <RuleModal />
    </Stack>
  );
};
