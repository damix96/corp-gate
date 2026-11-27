import { useState } from 'react';
import { Box, Paper, Spoiler, Stack, Text, Textarea } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { CallTokenText } from './call-token-text.js';

export const SessionText = ({ text, secretsMap, compact = true }: { text: string; secretsMap?: Map<string, SessionAlias>; compact?: boolean }) => {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const lines = text.split(/\r\n|\r|\n/);
  if (!compact) return <Paper withBorder radius="sm" p="sm" bg="dark.8" miw={0} data-formatted-fragment>
    <Stack gap={0} miw={0}>
    {lines.map((line, i) => <Box key={i} fz="sm" ff="monospace" lh={1.7}><CallTokenText text={line || '\u00a0'} secretsMap={secretsMap} /></Box>)}
    {text === '' && <Text size="xs" c="dimmed">{t('common.emptyString')}</Text>}
    </Stack>
  </Paper>;
  return <Stack gap={4} miw={0}>
    <Spoiler maxHeight={200} expanded={!compact || expanded} onExpandedChange={setExpanded} showLabel={compact ? t('sessionView.expand') : null} hideLabel={compact ? t('sessionView.collapse') : null} transitionDuration={0}>
      <Stack gap={0} miw={0}>{lines.map((line, i) => <Text component="div" key={i} size="sm" lh={1.65}><CallTokenText text={line || '\u00a0'} secretsMap={secretsMap} /></Text>)}</Stack>
    </Spoiler>
    {text === '' && <Text size="xs" c="dimmed">{t('common.emptyString')}</Text>}
    {/\S{120}/.test(text) && <Textarea label={t('sessionView.unbrokenText')} readOnly value={text} autosize minRows={2} maxRows={8} />}
  </Stack>;
};
