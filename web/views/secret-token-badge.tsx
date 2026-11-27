import { useEffect, useId, useRef, useState } from 'react';
import { ActionIcon, Box, Button, Collapse, CopyButton, Group, Paper, Popover, Stack, Text, Textarea } from '@mantine/core';
import { useClickOutside, useHotkeys, useIntersection, useMergedRef, useResizeObserver } from '@mantine/hooks';
import { ArrowDown, Check, Copy } from 'lucide-react';
import { useLocale } from '../stores/locale-store.js';
import { vaultStore } from '../stores/vault-store.js';

interface SecretTokenBadgeProps { token: string; baseKey?: string; realValue?: string; format?: string; entryExists?: boolean; valueHidden?: boolean; inbound?: boolean; summaryCount?: number | null; }

export const SecretTokenBadge = ({ token, baseKey, realValue, entryExists, valueHidden, inbound, summaryCount }: SecretTokenBadgeProps) => {
  const { t } = useLocale();
  const [opened, setOpened] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const [tokenText, tokenBounds] = useResizeObserver<HTMLParagraphElement>();
  const [valueText, valueBounds] = useResizeObserver<HTMLParagraphElement>();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const visibility = useIntersection({ threshold: 1, rootMargin: '10000px 0px' });
  const targetRef = useMergedRef(trigger, visibility.ref);
  const summary = summaryCount !== undefined;
  const dismiss = () => { setOpened(false); setExpanded(false); };
  const escape = (target: EventTarget | null) => { const returnToTrigger = target instanceof Node && hint.current?.contains(target); dismiss(); if (returnToTrigger) trigger.current?.focus({ preventScroll: true }); };
  useClickOutside(() => { if (opened && !summary) dismiss(); }, ['mousedown', 'touchstart'], [trigger.current, hint.current]);
  useHotkeys(opened ? [['esc', (event: KeyboardEvent) => escape(event.target), { preventDefault: false }]] : [], []);
  const value = valueHidden ? t('exchange.valueHidden') : realValue === '' ? t('common.emptyString') : realValue;
  useEffect(() => setClipped(opened && [tokenText.current, valueText.current].some(node => node && (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1))), [opened, token, value, tokenBounds.width, tokenBounds.height, valueBounds.width, valueBounds.height]);
  const label = inbound ? value ?? t('callSecrets.noKnownMapping') : summary && token.startsWith('$${<') && token.endsWith('>}') ? token.slice(4, -2) : token;
  const action = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (window.getSelection()?.toString().trim()) return;
    if ((event.ctrlKey || event.metaKey) && baseKey && entryExists) { event.preventDefault(); dismiss(); vaultStore.navigateToSecret(baseKey); }
    else if (opened) dismiss();
    else setOpened(true);
  };
  const control = <Button ref={summary ? targetRef : trigger} id={`${id}-trigger`} tabIndex={summary && visibility.entry?.intersectionRatio !== 1 ? -1 : undefined} display="inline" h={summary ? 24 : undefined} px={summary ? 7 : undefined} radius={summary ? 'sm' : undefined} fz={summary ? 11 : undefined} fw={summary ? 500 : undefined} size="compact-xs" variant="light" color={inbound ? 'teal' : entryExists ? 'indigo' : 'gray'} maw="100%" onClick={action} onKeyDown={event => { if (event.key === 'Escape' && opened) { event.preventDefault(); event.stopPropagation(); escape(event.target); } }} data-secret-key={entryExists ? baseKey : undefined} data-substitution-alias={summary ? token : undefined} aria-keyshortcuts={entryExists && baseKey ? 'Control+Enter' : undefined} aria-expanded={opened} aria-controls={`${id}-details`} aria-label={summary ? `${token}: ${summaryCount ?? '—'}` : t(inbound ? 'sessionView.restorationHint' : 'sessionView.tokenHint', { token })}>
    {summary ? <Group gap={4} wrap="nowrap"><Text component="span" inherit truncate maw={220}>{label}</Text><Text component="span" inherit fw={700} data-substitution-count>{summaryCount ?? '—'}</Text></Group> : label.length > 40 ? label.slice(0, 37) + '…' : label}
  </Button>;
  const content = <Stack gap={4} miw={0}>
    <Group gap={6} wrap="nowrap"><Text ref={tokenText} size="xs" ff="monospace" lineClamp={2} flex={1} miw={0}>{token}</Text><CopyButton value={token}>{({ copied, copy }) => <ActionIcon size="xs" variant="subtle" onClick={copy} aria-label={t(copied ? 'common.copied' : 'callSecrets.copyToken')}>{copied ? <Check size={13} /> : <Copy size={13} />}</ActionIcon>}</CopyButton></Group>
    <ArrowDown size={12} />
    <Group gap={6} wrap="nowrap"><Text ref={valueText} size="xs" ff="monospace" lineClamp={2} flex={1} miw={0}>{entryExists ? value ?? t('callSecrets.noKnownMapping') : t('callSecrets.noKnownMapping')}</Text>{entryExists && !valueHidden && realValue !== undefined && <CopyButton value={realValue}>{({ copied, copy }) => <ActionIcon size="xs" variant="subtle" onClick={copy} aria-label={t(copied ? 'common.copied' : 'callSecrets.copyOriginal', { key: baseKey || token })}>{copied ? <Check size={13} /> : <Copy size={13} />}</ActionIcon>}</CopyButton>}</Group>
    {(clipped || expanded) && <Button variant="subtle" size="compact-xs" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{t(expanded ? 'sessionView.collapse' : 'sessionView.expand')}</Button>}
    {expanded && <Stack gap={4}><Textarea size="xs" label={t('secretDisplay.sent')} value={token} readOnly autosize maxRows={8} />{entryExists && !valueHidden && realValue !== undefined && <Textarea size="xs" label={t('secretDisplay.was')} value={realValue} readOnly autosize maxRows={8} />}</Stack>}
  </Stack>;
  const detailsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); escape(event.target); } };
  return summary ? <Popover id={id} opened={opened} onChange={next => next ? setOpened(true) : dismiss()} withinPortal position="top-start" offset={8} middlewares={{ flip: { fallbackPlacements: ['top-end', 'right', 'left', 'bottom-start'], padding: 8 }, shift: { padding: 8 } }} width="auto" withArrow trapFocus returnFocus={false} closeOnEscape={false} transitionProps={{ duration: 0 }}>
    <Popover.Target>{control}</Popover.Target><Popover.Dropdown ref={hint} p={6} maw={360} onKeyDownCapture={detailsKeyDown}>{content}</Popover.Dropdown>
  </Popover> : <Box component="span" display="inline-grid" maw="100%">{control}<Collapse in={opened} transitionDuration={0}><Paper ref={hint} id={`${id}-details`} role="region" aria-labelledby={`${id}-trigger`} data-token-details p={6} mt={4} w="max-content" maw={360} withBorder onKeyDownCapture={detailsKeyDown}>{opened && content}</Paper></Collapse></Box>;
};
