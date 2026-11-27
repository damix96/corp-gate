import { useState } from 'react';
import { Button, Center, Code, Paper, Stack, Text, TextInput, Title } from '@mantine/core';
import { KeyRound } from 'lucide-react';
import { authStore, useAuth } from '../stores/auth-store.js';
import { useLocale } from '../stores/locale-store.js';

export const AuthView = () => {
  const { t } = useLocale();
  const { submitting, error } = useAuth();
  const [token, setToken] = useState('');

  const handleSubmit = async () => {
    if (!token.trim() || submitting) return;
    await authStore.submitToken(token);
  };

  return (
    <Center mih="70vh">
      <Paper withBorder p="xl" radius="md" w="100%" maw={520}>
        <Stack gap="md">
          <Title order={3}>{t('auth.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('auth.descriptionBefore')} <Code>npx corp-gate open</Code> {t('auth.descriptionMiddle')} <Code>~/.corpgate/admin.token</Code>
          </Text>
          <TextInput
            label={t('auth.tokenLabel')}
            placeholder={t('auth.tokenPlaceholder')}
            value={token}
            error={error}
            disabled={submitting}
            onChange={e => { setToken(e.currentTarget.value); authStore.clearError(); }}
            onKeyDown={e => { if (e.key === 'Enter') void handleSubmit(); }}
            autoFocus
          />
          <Button leftSection={<KeyRound size={16} />} loading={submitting} disabled={!token.trim()} onClick={() => void handleSubmit()}>
            {t('auth.submit')}
          </Button>
        </Stack>
      </Paper>
    </Center>
  );
};
