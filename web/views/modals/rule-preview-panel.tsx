import { useMemo } from 'react';
import { Accordion, Alert, Badge, Button, Card, Code, CopyButton, Group, Loader, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { useLocale } from '../../stores/locale-store.js';
import { rulePreviewService, useRulePreview } from '../../stores/rule-preview-service.js';
import type { PreviewMatch } from '../../stores/types.js';

interface MatchGroup {
  key: string;
  client: string;
  session: string;
  path: string;
  endpoint?: string;
  role?: string;
  matches: PreviewMatch[];
}

export const RulePreviewPanel = () => {
  const { t } = useLocale();
  const { status, results, contexts, notices, offset, total, scanned, error, hasMore } = useRulePreview();

  const groupedMatches = useMemo(() => {
    const map = new Map<string, MatchGroup>();
    results.forEach(m => {
      const gKey = `${m.transaction || ''}_${m.session}_${m.path}`;
      if (!map.has(gKey)) {
        map.set(gKey, {
          key: gKey,
          client: m.client || t('rulePreview.sessionDefault'),
          session: m.session,
          path: m.path,
          endpoint: m.endpoint,
          role: m.role,
          matches: [],
        });
      }
      map.get(gKey)!.matches.push(m);
    });
    return Array.from(map.values());
  }, [results, t]);

  return (
    <Stack gap="xs">
      <Text fw={600} size="sm" aria-label={t('rulePreview.ariaLabel')}>{t('rulePreview.matchesHeading')}</Text>
      {notices.length > 0 && <Text size="xs" c="yellow">{notices.join(' ')}</Text>}
      {status === 'empty' && <Text size="xs" c="dimmed">{t('rulePreview.enterRegex')}</Text>}
      {status === 'waiting' && <Text size="xs" c="dimmed">{t('rulePreview.waitingInput')}</Text>}
      {status === 'searching' && (
        <Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">{t('rulePreview.searching')}</Text></Group>
      )}
      {status === 'conflict' && (
        <Alert color="orange" title={t('rulePreview.sessionDataChanged')}>
          <Button size="xs" variant="light" onClick={rulePreviewService.retry}>{t('rulePreview.startOver')}</Button>
        </Alert>
      )}
      {status === 'error' && (
        <Alert color="red" title={t('rulePreview.checkFailed', { error: error || '' })}>
          <Button size="xs" variant="light" onClick={rulePreviewService.retry}>{t('rulePreview.retryBatch')}</Button>
        </Alert>
      )}
      {status === 'done' && (
        <Text size="xs" c="dimmed">
          {total === 0
            ? t('rulePreview.noHistory')
            : results.length === 0
            ? t('rulePreview.statusDone', { offset, total, shown: 0 }) + t('rulePreview.noMatchesInHistory')
            : t(scanned ? 'rulePreview.statusDone' : 'rulePreview.statusProgress', { offset, total, shown: results.length })}
        </Text>
      )}

      <ScrollArea h={380} offsetScrollbars>
        <Stack gap="xs">
          {groupedMatches.map(group => (
            <Card key={group.key} withBorder padding="xs">
              <Group justify="space-between" mb={4}>
                <Text fw={600} size="xs">{group.client}</Text>
                <Badge size="xs" variant="outline" ff="monospace">{group.session.slice(0, 8)}</Badge>
              </Group>
              <Text size="xs" c="dimmed" mb={6}>
                {[group.endpoint, group.path, group.role || 'message'].filter(Boolean).join(' · ')}
              </Text>

              <Stack gap="xs">
                {group.matches.map((match, mIdx) => {
                  const isLong = match.value.length > 1024;
                  const displayValue = isLong ? match.value.slice(0, 1024) + '…' : match.value;
                  const fullContextText = match.contextId ? (contexts[match.contextId] || contexts[match.path]) : undefined;

                  return (
                    <Card key={mIdx} withBorder padding="xs" bg="dark.7">
                      <Code block mb={4}>{displayValue}</Code>

                      {isLong && (
                        <Group justify="space-between" mb={4}>
                          <Text size="xs" c="dimmed">{t('rulePreview.longMatchNote')}</Text>
                          <CopyButton value={match.value} timeout={1500}>
                            {({ copied, copy }) => (
                              <Button size="compact-xs" variant="subtle" onClick={copy}>
                                {copied ? t('common.copied') : t('rulePreview.fullMatch')}
                              </Button>
                            )}
                          </CopyButton>
                        </Group>
                      )}

                      <Group gap="xs" mb={4}>
                        <Text size="xs" c="dimmed">{match.existing ? t('rulePreview.currentAlias') : t('rulePreview.token')}:</Text>
                        <Badge size="xs" variant="light" ff="monospace">{match.alias}</Badge>
                      </Group>

                      {(match.before !== undefined || match.after !== undefined || fullContextText) && (
                        <Accordion variant="separated">
                          {(match.before !== undefined || match.after !== undefined) && (
                            <Accordion.Item value="matchContext">
                              <Accordion.Control p="xs">{t('rulePreview.matchContext')}</Accordion.Control>
                              <Accordion.Panel p="xs">
                                <Text size="xs" ff="monospace">
                                  {match.before || ''}
                                  <Badge size="xs" color="yellow" variant="light" mx={4}>
                                    {match.value.slice(0, 40)}
                                  </Badge>
                                  {match.after || ''}
                                </Text>
                              </Accordion.Panel>
                            </Accordion.Item>
                          )}
                          {fullContextText && (
                            <Accordion.Item value="fullContext">
                              <Accordion.Control p="xs">{t('rulePreview.fullContext')}</Accordion.Control>
                              <Accordion.Panel p="xs">
                                <Code block>{fullContextText}</Code>
                              </Accordion.Panel>
                            </Accordion.Item>
                          )}
                        </Accordion>
                      )}
                    </Card>
                  );
                })}
              </Stack>
            </Card>
          ))}

          {hasMore && (
            <Button size="xs" variant="light" fullWidth onClick={rulePreviewService.loadMore}>{t('rulePreview.showMore')}</Button>
          )}
        </Stack>
      </ScrollArea>
    </Stack>
  );
};
