import { Accordion, Anchor, Button, Code, CopyButton, Group, Modal, Paper, Stack, Text } from '@mantine/core';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { useLocale } from '../../stores/locale-store.js';
import type { RouteRecord } from '../../stores/types.js';
import { ConnectionGuidance } from './connection-guidance.js';

export const getInstructionKind = (route: RouteRecord): 'claude' | 'zen' | 'openai' | 'go' | 'unknown' => {
  if (route.instructionKind) return route.instructionKind as 'claude' | 'zen' | 'openai' | 'go' | 'unknown';
  const target = (route.upstreamUrl || route.targetUrl || '').replace(/\/+$/, '');
  const serviceMap: Record<string, 'claude' | 'zen' | 'openai' | 'go'> = {
    'https://api.anthropic.com': 'claude', 'https://api.anthropic.com/v1': 'claude',
    'https://api.openai.com': 'openai', 'https://api.openai.com/v1': 'openai',
    'https://opencode.ai/inference': 'zen', 'https://opencode.ai/inference/v1': 'zen',
    'https://opencode.ai/inference/go': 'go',
    'http://127.0.0.1:11434': 'openai', 'http://127.0.0.1:11434/v1': 'openai',
  };
  if (serviceMap[target]) return serviceMap[target];
  let path = '';
  try { path = new URL(route.cliUrl || route.incomingUrl || '').pathname.replace(/\/$/, ''); } catch {}
  const known: Record<string, 'claude' | 'zen' | 'openai' | 'go'> = { '/anthropic': 'claude', '/anthropic/v1': 'claude', '/openai': 'openai', '/openai/v1': 'openai', '/ollama': 'openai', '/ollama/v1': 'openai', '/opencode': 'zen', '/opencode/v1': 'zen', '/opencode-go': 'go', '/opencode-go/v1': 'go' };
  return known[path] || 'unknown';
};

export const ConnectionInstructionsModal = ({ route, opened, onClose }: { route: RouteRecord | null; opened: boolean; onClose: () => void }) => {
  const { t } = useLocale();
  if (!route) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:8767';
  const incoming = route.incomingUrl || route.cliUrl || `${origin}/${route.prefix}${route.suffix || ''}`;
  const kind = getInstructionKind(route);
  const claudePatch = JSON.stringify({ env: { ANTHROPIC_BASE_URL: incoming } }, null, 2);
  const openCodePatch = JSON.stringify({ providers: { YOUR_EXISTING_PROVIDER_ID: { settings: { baseURL: incoming } } } }, null, 2);
  const copySnippet = (value: string) => (
    <Paper withBorder p="xs" bg="dark.8">
      <Stack gap="xs">
        <Code block>{value}</Code>
        <CopyButton value={value}>
          {({ copied, copy }) => <Button size="compact-xs" variant="light" leftSection={copied ? <Check size={14} /> : <Copy size={14} />} onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</Button>}
        </CopyButton>
      </Stack>
    </Paper>
  );
  const docs = (href: string, key = 'onboarding.docsLink') => <Anchor href={href} target="_blank" rel="noreferrer" size="xs"><Group gap={4} wrap="nowrap"><Text size="xs">{t(key)}</Text><ExternalLink size={12} aria-hidden="true" /></Group></Anchor>;

  return (
    <Modal opened={opened} onClose={onClose} title={t('connections.howToConnectHeading', { name: route.name })} size="lg">
      <Stack gap="md">
        <ConnectionGuidance route={route} incoming={incoming} />
        <Text fw={600}>{t('onboarding.clientSettings')}</Text>
        <Accordion variant="separated" defaultValue={kind === 'claude' ? 'claude' : kind === 'zen' || kind === 'go' ? 'opencode' : 'other'}>
          <Accordion.Item value="claude">
            <Accordion.Control>{t('onboarding.claudeTitle')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="sm">{t('onboarding.claudeSources')}</Text>
                {docs('https://code.claude.com/docs/en/settings')}
                <Text size="sm">{t('onboarding.claudePatch')}</Text>
                {copySnippet(claudePatch)}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="opencode">
            <Accordion.Control>{t('onboarding.openCodeTitle')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="xs">
                <Text size="sm">{t('onboarding.openCodeSources')}</Text>
                {docs('https://opencode.ai/docs/config')}
                <Text size="sm">{t('onboarding.openCodePatch')}</Text>
                {copySnippet(openCodePatch)}
                {docs('https://opencode.ai/docs/providers#endpoint', 'onboarding.endpointDocsLink')}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
          <Accordion.Item value="other">
            <Accordion.Control>{t('onboarding.otherTitle')}</Accordion.Control>
            <Accordion.Panel><Stack gap="xs"><Text size="sm">{t('onboarding.otherPatch')}</Text>{copySnippet(incoming)}</Stack></Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Modal>
  );
};
