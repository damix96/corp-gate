import { useCallback, useRef, useState } from 'react';
import { Alert, Group, Loader, Paper, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { connectionsStore } from '../../stores/connections-store.js';
import { useLocale } from '../../stores/locale-store.js';
import type { ProxyMode, RouteProxyConfig } from '../../stores/types.js';

export interface ProxyFormState {
  proxyMode: ProxyMode;
  httpProxy: string;
  httpsProxy: string;
  noProxy: string;
}

export const DEFAULT_PROXY: ProxyFormState = { proxyMode: 'direct', httpProxy: '', httpsProxy: '', noProxy: '' };

export const toProxyPayload = (state: ProxyFormState): RouteProxyConfig => state.proxyMode === 'direct'
  ? { proxyMode: 'direct', httpProxy: '', httpsProxy: '', noProxy: '' }
  : { proxyMode: state.proxyMode, httpProxy: state.httpProxy.trim(), httpsProxy: state.httpsProxy.trim(), noProxy: state.noProxy.trim() };

export const useConnectionProxyState = () => {
  const [proxy, setProxy] = useState<ProxyFormState>(DEFAULT_PROXY);
  const [proxyLoading, setProxyLoading] = useState(false);
  const [proxyError, setProxyError] = useState<string | null>(null);
  const reqId = useRef(0);

  const loadSystemProxy = useCallback(async () => {
    const id = ++reqId.current;
    setProxyLoading(true);
    setProxyError(null);
    try {
      const sys = await connectionsStore.fetchSystemProxy();
      if (id !== reqId.current) return;
      setProxy(prev => prev.proxyMode === 'system' ? { proxyMode: 'system', ...sys } : prev);
    } catch (e: unknown) {
      if (id !== reqId.current) return;
      setProxyError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === reqId.current) setProxyLoading(false);
    }
  }, []);

  const resetProxy = useCallback((next: ProxyFormState = DEFAULT_PROXY) => {
    reqId.current++;
    setProxy(next);
    setProxyLoading(false);
    setProxyError(null);
    if (next.proxyMode === 'system') void loadSystemProxy();
  }, [loadSystemProxy]);

  const setProxyMode = useCallback((mode: ProxyMode) => {
    setProxyError(null);
    if (mode === 'system') {
      setProxy(prev => ({ ...prev, proxyMode: 'system' }));
      void loadSystemProxy();
      return;
    }
    reqId.current++;
    setProxyLoading(false);
    setProxy(prev => ({ ...prev, proxyMode: mode }));
  }, [loadSystemProxy]);

  const setProxyField = useCallback((field: 'httpProxy' | 'httpsProxy' | 'noProxy', value: string) => {
    reqId.current++;
    setProxyLoading(false);
    setProxyError(null);
    setProxy(prev => ({ ...prev, proxyMode: prev.proxyMode === 'system' ? 'custom' : prev.proxyMode, [field]: value }));
  }, []);

  return { proxy, proxyLoading, proxyError, resetProxy, setProxyMode, setProxyField };
};

export const ConnectionProxySection = ({ value, loading, error, onModeChange, onFieldChange }: {
  value: ProxyFormState;
  loading: boolean;
  error: string | null;
  onModeChange: (mode: ProxyMode) => void;
  onFieldChange: (field: 'httpProxy' | 'httpsProxy' | 'noProxy', val: string) => void;
}) => {
  const { t } = useLocale();
  const descKey = value.proxyMode === 'system' ? 'connections.proxySystemDesc' : value.proxyMode === 'custom' ? 'connections.proxyCustomDesc' : 'connections.proxyDirectDesc';
  const modeData = [
    { value: 'direct', label: t('connections.proxyDirect') },
    { value: 'system', label: t('connections.proxySystem') },
    { value: 'custom', label: t('connections.proxyCustom') },
  ];

  return (
    <Paper withBorder p="sm" radius="sm" bg="dark.8">
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" fw={500}>{t('connections.proxyHeading')}</Text>
          {loading && <Loader size={14} />}
        </Group>
        <SegmentedControl size="xs" fullWidth value={value.proxyMode} onChange={v => onModeChange(v as ProxyMode)} data={modeData} />
        <Text size="xs" c="dimmed">{t(descKey)}</Text>
        {error && <Alert color="red">{t('connections.proxyLoadError', { error })}</Alert>}
        {value.proxyMode !== 'direct' && (
          <Stack gap="xs">
            <TextInput size="xs" label={t('connections.proxyHttpLabel')} placeholder={t('connections.proxyNotSet')} value={value.httpProxy} onChange={e => onFieldChange('httpProxy', e.currentTarget.value)} />
            <TextInput size="xs" label={t('connections.proxyHttpsLabel')} placeholder={t('connections.proxyNotSet')} value={value.httpsProxy} onChange={e => onFieldChange('httpsProxy', e.currentTarget.value)} />
            <TextInput size="xs" label={t('connections.proxyNoProxyLabel')} placeholder={t('connections.proxyNotSet')} value={value.noProxy} onChange={e => onFieldChange('noProxy', e.currentTarget.value)} />
          </Stack>
        )}
      </Stack>
    </Paper>
  );
};
