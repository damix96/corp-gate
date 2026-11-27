import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { modals } from '@mantine/modals';
import { Trash2, Zap } from 'lucide-react';
import { useLocale } from '../../stores/locale-store.js';
import { connectionsStore, useConnections } from '../../stores/connections-store.js';
import type { RouteRecord } from '../../stores/types.js';
import { ConnectionInstructionsModal, getInstructionKind } from './connection-instructions-modal.js';
import { ConnectionProxySection, toProxyPayload, useConnectionProxyState, type ProxyFormState } from './connection-proxy-section.js';

export { ConnectionInstructionsModal, getInstructionKind };

const PRESETS = [
  { id: 'anthropic', name: 'Claude / Anthropic', url: 'https://api.anthropic.com' },
  { id: 'openai', name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { id: 'opencode', name: 'opencode', url: 'https://opencode.ai/inference/v1' },
  { id: 'openrouter', name: 'openrouter', url: 'https://openrouter.ai/api/v1' },
  { id: 'ollama', name: 'Ollama', url: 'http://127.0.0.1:11434/v1' },
];
const RESERVED = new Set(['api', 'health', 'dashboard', 'zen']);
const settingsDrafts = new Map<string, { target: string; name: string } & ProxyFormState>();

const slugify = (text: string) => text.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

const resolvePrefix = (base: string, existing: Set<string>): string => {
  const clean = slugify(base) || 'connection';
  if (!RESERVED.has(clean) && !existing.has(clean)) return clean;
  let i = 2;
  while (RESERVED.has(`${clean}-${i}`) || existing.has(`${clean}-${i}`)) i++;
  return `${clean}-${i}`;
};

const validateUrl = (raw: string, t: (k: string) => string): string | null => {
  if (!raw.trim()) return t('validation.upstreamRequired');
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return t('validation.upstreamProtocol');
    if (u.username || u.password || u.search || u.hash) return t('validation.upstreamClean');
    return null;
  } catch {
    return t('validation.upstreamExample');
  }
};

export const ConnectionCreateModal = ({ opened, onClose }: { opened: boolean; onClose: () => void }) => {
  const { t } = useLocale();
  const conn = useConnections();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { proxy, proxyLoading, proxyError, resetProxy, setProxyMode, setProxyField } = useConnectionProxyState();

  const existingPrefixes = new Set(conn.routes.map(r => r.prefix));

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setName(preset.name);
    setUrl(preset.url);
    setError(null);
    setNameError(null);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError(t('validation.connNameRequired'));
      return;
    }
    const err = validateUrl(url, t);
    if (err) {
      setError(err);
      return;
    }
    const finalName = name.trim();
    const finalPrefix = resolvePrefix(finalName, existingPrefixes);
    setSaving(true);
    try {
      await connectionsStore.createRoute({ name: finalName, upstreamUrl: url.trim(), prefix: finalPrefix, ...toProxyPayload(proxy) });
      setName('');
      setUrl('');
      setError(null);
      setNameError(null);
      resetProxy();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={t('connections.addDialogTitle')} size="md">
      <Stack gap="md">
        <Stack gap="xs">
          <Text size="xs" c="dimmed">{t('connections.fillFromPreset')}</Text>
          <Group gap="xs" wrap="wrap">
            {PRESETS.map(p => (
              <Button key={p.id} size="xs" variant="light" leftSection={<Zap size={12} />} onClick={() => applyPreset(p)}>{p.name}</Button>
            ))}
          </Group>
        </Stack>
        <TextInput label={t('ruleEditor.nameLabel')} placeholder="opencode" value={name} onChange={e => { setName(e.currentTarget.value); setNameError(null); }} error={nameError} required />
        <TextInput label={t('connections.urlLabel')} placeholder={t('connections.urlPlaceholder')} description={t('connections.urlDesc')} value={url} onChange={e => { setUrl(e.currentTarget.value); setError(null); }} error={error} required />
        <ConnectionProxySection value={proxy} loading={proxyLoading} error={proxyError} onModeChange={setProxyMode} onFieldChange={setProxyField} />
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>{t('common.close')}</Button>
          <Button onClick={handleSave} loading={saving}>{t('common.add')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
};

export const ConnectionSettingsModal = ({ route, opened, onClose }: { route: RouteRecord | null; opened: boolean; onClose: () => void }) => {
  const { t } = useLocale();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { proxy, proxyLoading, proxyError, resetProxy, setProxyMode, setProxyField } = useConnectionProxyState();
  const scrollPos = useRef({ x: 0, y: 0 });
  const conversationScroll = useRef(0);
  const sessionsScroll = useRef(0);

  useEffect(() => {
    if (route && opened) {
      const draft = settingsDrafts.get(route.id);
      setName(draft?.name ?? route.name ?? '');
      setUrl(draft?.target ?? route.upstreamUrl ?? '');
      resetProxy(draft
        ? { proxyMode: draft.proxyMode, httpProxy: draft.httpProxy, httpsProxy: draft.httpsProxy, noProxy: draft.noProxy }
        : { proxyMode: route.proxyMode ?? 'direct', httpProxy: route.httpProxy ?? '', httpsProxy: route.httpsProxy ?? '', noProxy: route.noProxy ?? '' });
      setError(null);
      scrollPos.current = { x: window.scrollX, y: window.scrollY };
      conversationScroll.current = document.getElementById('overviewConversation')?.scrollTop ?? 0;
      sessionsScroll.current = document.getElementById('overviewSessions')?.scrollTop ?? 0;
    }
  }, [opened, route?.id, route?.name, route?.upstreamUrl, route?.proxyMode, route?.httpProxy, route?.httpsProxy, route?.noProxy, resetProxy]);

  if (!route) return null;

  const handleClose = () => {
    settingsDrafts.set(route.id, { target: url, name, ...proxy });
    onClose();
    requestAnimationFrame(() => {
      window.scrollTo(scrollPos.current.x, scrollPos.current.y);
      const conv = document.getElementById('overviewConversation');
      if (conv) conv.scrollTop = conversationScroll.current;
      const sess = document.getElementById('overviewSessions');
      if (sess) sess.scrollTop = sessionsScroll.current;
    });
  };

  const handleSave = async () => {
    const err = validateUrl(url, t);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      await connectionsStore.updateRoute(route.id, url.trim(), name.trim(), undefined, toProxyPayload(proxy));
      settingsDrafts.delete(route.id);
      onClose();
      requestAnimationFrame(() => {
        window.scrollTo(scrollPos.current.x, scrollPos.current.y);
        const conv = document.getElementById('overviewConversation');
        if (conv) conv.scrollTop = conversationScroll.current;
        const sess = document.getElementById('overviewSessions');
        if (sess) sess.scrollTop = sessionsScroll.current;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    modals.openConfirmModal({
      title: t('connections.deleteConfirmTitle', { name: route.name }),
      children: <Text size="sm">{t('connections.deleteConfirmNote')}</Text>,
      labels: { confirm: t('common.delete'), cancel: t('common.cancel') },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        await connectionsStore.deleteRoute(route.id);
        settingsDrafts.delete(route.id);
        onClose();
      },
    });
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={t('connections.settingsHeading', { name: route.name })} size="md">
      <Stack gap="md">
        {saving && <Text size="xs" c="dimmed">{t('connections.savingAddress')}</Text>}
        {error && (
          <Stack gap={4}>
            <Alert color="red">{error}</Alert>
            <Text size="xs" c="yellow.5">{t('connections.draftKept')}</Text>
          </Stack>
        )}
        <TextInput label={t('connections.settingsNameLabel')} description={t('connections.settingsNameDesc')} value={name} onChange={e => setName(e.currentTarget.value)} />
        <TextInput label={t('connections.urlLabel')} description={t('connections.urlDesc')} value={url} onChange={e => setUrl(e.currentTarget.value)} required />
        <ConnectionProxySection value={proxy} loading={proxyLoading} error={proxyError} onModeChange={setProxyMode} onFieldChange={setProxyField} />
        <Group justify="space-between">
          {route.isCustom ? (
            <Button color="red" variant="subtle" size="xs" leftSection={<Trash2 size={14} />} onClick={confirmDelete}>{t('connections.deleteConnection')}</Button>
          ) : <Text size="xs" c="dimmed">{t('connections.presetVariant')}</Text>}
          <Group gap="xs">
            <Button variant="default" onClick={handleClose}>{t('common.close')}</Button>
            <Button onClick={handleSave} loading={saving}>{t('common.save')}</Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
};
