import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, AppShell, Autocomplete, Badge, Button, Card, Container, Group, PasswordInput, Stack, Switch, Text, TextInput, Title } from '@mantine/core';
import { ArrowLeft, CheckCircle2, Globe, Lock, Plus, Trash2, XCircle } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { SecretInputStore } from '../stores/secret-input-store.js';

export const SecretInputView = () => {
  const { locale, t, toggleLocale } = useLocale();
  const [store] = useState(() => new SecretInputStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useEffect(() => {
    let active = true;
    void store.load(window.location.href).then(() => { if (active) window.history.replaceState(null, '', '/vault/set'); });
    const clear = () => store.dispose();
    window.addEventListener('pagehide', clear);
    return () => { active = false; window.removeEventListener('pagehide', clear); store.dispose(); };
  }, [store]);
  const terminalLabels: Record<string, { title: string; desc: string; color: string }> = {
    completed: { title: 'secretInput.successTitle', desc: 'secretInput.successDesc', color: 'teal' },
    cancelled: { title: 'secretInput.cancelledTitle', desc: 'secretInput.cancelledDesc', color: 'gray' },
    expired: { title: 'secretInput.expiredTitle', desc: 'secretInput.expiredDesc', color: 'red' },
    failed: { title: 'secretInput.failedTitle', desc: 'secretInput.failedTitle', color: 'red' },
    unavailable: { title: 'secretInput.unavailableTitle', desc: 'secretInput.unavailableTitle', color: 'red' },
  };
  const outcome = state.terminal ? terminalLabels[state.terminal] : null;
  const disabled = state.loading || state.submitting || state.review;

  return (
    <AppShell header={{ height: 64 }} padding="md">
      <AppShell.Header>
        <Container size="xl" h="100%">
          <Group justify="space-between" align="center" h="100%" wrap="nowrap">
            <Group gap="md" wrap="nowrap">
              <Button component="a" href="/#overview" role="button" variant="subtle" p={0}><Group gap="xs" wrap="nowrap"><Badge size="lg" radius="sm" variant="filled" color="indigo" aria-hidden="true">C</Badge><Title order={4}>CorpGate</Title></Group></Button>
              <Button component="a" href="/#overview" variant="light" size="xs" leftSection={<ArrowLeft size={14} />}>{t('secretInput.toDashboard')}</Button>
            </Group>
            <Button variant="subtle" size="xs" leftSection={<Globe size={14} />} onClick={toggleLocale}>{locale === 'ru' ? 'EN' : 'RU'}</Button>
          </Group>
        </Container>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="sm" py="xl">
          <Card withBorder radius="md" p="xl">
            <Stack gap="md">
              <Group justify="space-between" align="center"><Title order={3}>{t('secretInput.setHeading')}</Title><Badge variant="light">{t('secretInput.setBadge')}</Badge></Group>
              <Text size="sm" c="dimmed">{t('secretInput.setDesc')}</Text>
              {outcome && <Alert id="secretInputResult" color={outcome.color} icon={state.terminal === 'completed' ? <CheckCircle2 size={18} /> : <XCircle size={18} />} title={t(outcome.title)}><Stack gap="xs"><Text size="sm">{t(outcome.desc)}</Text>{state.notice && <Text size="xs" c="dimmed">{state.notice}</Text>}</Stack></Alert>}
              {!state.terminal && (
                <Stack component="form" id="secretInputForm" onSubmit={event => { event.preventDefault(); void store.save(); }} gap="md">
                  {(state.error || state.errorKey) && <Alert color="red">{state.errorKey ? t(state.errorKey) : state.error}</Alert>}
                  {state.loading && <Text size="sm" c="dimmed">{t('secretInput.loading')}</Text>}
                  <Stack id="secretInputRows" gap="md">
                    {state.rows.map((row, index) => (
                      <Card key={index} withBorder p="sm" radius="sm">
                        <Stack gap="xs">
                          <Group justify="space-between" align="center">
                            <Group gap="xs" align="center"><Text fw={600} size="sm">#{index + 1}</Text>{row.name && <Badge size="xs" variant="light">{t(state.existing.some(entry => entry.name === row.name) ? 'secretInput.existingVariable' : 'secretInput.availableName')}</Badge>}</Group>
                            {state.rows.length > 1 && <Button variant="subtle" color="red" size="xs" disabled={disabled} onClick={() => store.remove(index)} leftSection={<Trash2 size={14} />}>{t('secretInput.removeRow')}</Button>}
                          </Group>
                          <Autocomplete id={`secretInputName${index}`} label={t('secretInput.nameLabel')} value={row.name} data={state.existing.map(entry => entry.name)} placeholder="INTERNAL_TOKEN" onChange={name => store.edit(index, { name })} disabled={disabled} required />
                          <PasswordInput id={`secretInputValue${index}`} label={t('secretInput.valLabel')} placeholder={t('secretInput.valPlaceholder')} value={row.value} onChange={event => store.edit(index, { value: event.currentTarget.value })} leftSection={<Lock size={14} />} disabled={disabled} required />
                          <TextInput id={`secretInputDesc${index}`} label={t('secretInput.descLabel')} value={row.description} placeholder={t('secretEditor.descPlaceholder')} onChange={event => store.edit(index, { description: event.currentTarget.value })} disabled={disabled} />
                          <Switch id={`secretInputDpapi${index}`} label={t('secretInput.dpapiSwitch')} description={t('secretInput.dpapiDesc')} checked={row.isSecret} onChange={event => store.edit(index, { isSecret: event.currentTarget.checked })} disabled={disabled} />
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                  <Button id="secretInputAdd" variant="light" size="xs" disabled={disabled || state.rows.length >= 32} onClick={store.add} leftSection={<Plus size={14} />}>{t('secretInput.addRow')}</Button>
                  <Group justify="flex-end" gap="xs" mt="sm">
                    <Button id="secretInputCancel" variant="default" onClick={() => void store.cancel()} disabled={state.submitting}>{t('secretInput.cancelBtn')}</Button>
                    {state.review ? <Button type="button" onClick={() => void store.review()} loading={state.submitting}>{t('secretInput.checkingBtn')}</Button> : <Button type="submit" loading={state.submitting} disabled={state.loading}>{t('secretInput.saveBtn')}</Button>}
                  </Group>
                </Stack>
              )}
            </Stack>
          </Card>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
};
