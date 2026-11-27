import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Grid, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useLocale } from '../../stores/locale-store.js';
import { rulesStore, useRules } from '../../stores/rules-store.js';
import { RulePreviewPanel } from './rule-preview-panel.js';

export const RuleModal = () => {
  const { t } = useLocale();
  const { modalOpened, editingPattern, editingBaseline, isDeletedOnServer, isChangedOnServer } = useRules();
  const isEdit = Boolean(editingPattern);

  const [name, setName] = useState('');
  const [pattern, setPattern] = useState('');
  const [template, setTemplate] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const scrollPos = useRef({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!modalOpened) return;
    scrollPos.current = { x: window.scrollX, y: window.scrollY };
    triggerRef.current = document.activeElement as HTMLElement | null;

    const ruleId = editingPattern?.id || '';
    const draft = rulesStore.getDraft(ruleId);
    let initName = '';
    let initPattern = '';
    let initTemplate = '';
    let initEnabled = true;
    let initDirty = false;

    if (draft) {
      initName = draft.draft.name ?? editingPattern?.name ?? '';
      initPattern = draft.draft.pattern ?? editingPattern?.pattern ?? '';
      initTemplate = draft.draft.label_template ?? editingPattern?.label_template ?? (editingPattern?.type ? editingPattern.type.toUpperCase() : '');
      initEnabled = Boolean(draft.draft.enabled ?? editingPattern?.enabled ?? true);
      initDirty = true;
    } else if (editingPattern) {
      initName = editingPattern.name;
      initPattern = editingPattern.pattern || editingPattern.regex || '';
      initTemplate = editingPattern.label_template || (editingPattern.type ? editingPattern.type.toUpperCase() : '');
      initEnabled = Boolean(editingPattern.enabled);
      initDirty = false;
    }

    setName(initName);
    setPattern(initPattern);
    setTemplate(initTemplate);
    setEnabled(initEnabled);
    setIsDirty(initDirty);
    setErrorBanner(null);

    if (initPattern.trim()) {
      triggerPreview(initPattern, initTemplate);
    } else {
      rulesStore.resetPreview();
    }
  }, [modalOpened, editingPattern]);

  const triggerPreview = (pat: string, tmpl: string) => {
    const rawType = tmpl.includes('$') ? (tmpl.split('$')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'custom') : tmpl.replace(/^AUTO_/i, '').trim().toLowerCase() || 'custom';
    const label_template = tmpl.includes('$') ? tmpl : null;
    rulesStore.schedulePreview({ pattern: pat, type: rawType, label_template, anyIp: editingPattern?.id === 'pat_any_ip' });
  };

  const handlePatternChange = (val: string) => {
    setPattern(val);
    setErrorBanner(null);
    setIsDirty(true);
    triggerPreview(val, template);
  };

  const handleTemplateChange = (val: string) => {
    setTemplate(val);
    setErrorBanner(null);
    setIsDirty(true);
    triggerPreview(pattern, val);
  };

  const restoreView = () => {
    requestAnimationFrame(() => window.scrollTo(scrollPos.current.x, scrollPos.current.y));
    setTimeout(() => triggerRef.current?.focus(), 50);
  };

  const handleClose = () => {
    if (isDirty) {
      rulesStore.setDraft(editingPattern?.id || '', editingPattern, { name, pattern, label_template: template, enabled });
    }
    rulesStore.closeModal();
    restoreView();
  };

  const handleResetAndClose = () => {
    rulesStore.clearDraft(editingPattern?.id || '');
    rulesStore.closeModal();
    restoreView();
  };

  const handleSave = async () => {
    setErrorBanner(null);
    if (!name.trim() || !pattern.trim()) {
      setErrorBanner(t('ruleEditor.emptyFieldsError'));
      return;
    }
    if (/^\/.*\/[a-z]*$/s.test(pattern.trim())) {
      setErrorBanner(t('ruleEditor.rawRegexError'));
      return;
    }
    try {
      new RegExp(pattern, 'gi');
    } catch (err: unknown) {
      setErrorBanner(t('ruleEditor.invalidRegexPrefix', { error: (err as Error)?.message || String(err) }));
      return;
    }
    const rawType = template.includes('$') ? (template.split('$')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'custom') : template.replace(/^AUTO_/i, '').trim().toLowerCase() || 'custom';
    const label_template = template.includes('$') ? template : null;
    setSaving(true);
    try {
      if (editingPattern) {
        const canonicalBaseline = editingBaseline || editingPattern;
        const res = await rulesStore.updatePattern(editingPattern.id, {
          name,
          pattern,
          type: rawType,
          label_template,
          enabled,
          baseline: canonicalBaseline,
        });
        if (res.success) {
          setIsDirty(false);
          restoreView();
        } else {
          setErrorBanner(res.error || t('ruleEditor.changedNotice'));
        }
      } else {
        const res = await rulesStore.createPattern({ name, pattern, type: rawType, label_template });
        if (res.success) {
          setIsDirty(false);
          restoreView();
        } else {
          setErrorBanner(res.error || t('common.saveFailed', { error: '' }));
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const isSystem = Boolean(editingPattern && (editingPattern.id.startsWith('pat_') || ['internal-urls', 'database-uri', 'private-ip', 'any-ip', 'api-keys'].includes(editingPattern.name)));
  const localizedName = editingPattern ? (t('rules.names.' + editingPattern.name) !== 'rules.names.' + editingPattern.name ? t('rules.names.' + editingPattern.name) : editingPattern.name) : '';
  const title = (isEdit ? `${t('ruleEditor.headings.edit')} · ${localizedName}` : t('ruleEditor.headings.create')) + (isDirty ? t('common.draftSuffix') : '');

  return (
    <Modal opened={modalOpened} onClose={handleClose} title={<Text fw={600}>{title}</Text>} size="xl" centered trapFocus>
      <Grid gutter="md">
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap="sm">
            {errorBanner && <Alert color="red">{errorBanner}</Alert>}
            {isDeletedOnServer && <Alert color="red">{t('ruleEditor.deletedNotice')}</Alert>}
            {isChangedOnServer && <Alert color="orange">{t('ruleEditor.changedNotice')}</Alert>}
            <TextInput
              label={isSystem ? t('ruleEditor.techNameLabel') : t('ruleEditor.nameLabel')}
              placeholder={t('ruleEditor.namePlaceholder')}
              value={name}
              onChange={e => { setName(e.currentTarget.value); setErrorBanner(null); setIsDirty(true); }}
              required
            />
            <Textarea
              label={t('ruleEditor.regexLabel')}
              description={t('ruleEditor.regexHint')}
              placeholder="https?://(?<host>[a-z0-9.-]+)/[^\s&quot;']+"
              value={pattern}
              minRows={4}
              ff="monospace"
              spellCheck={false}
              onChange={e => handlePatternChange(e.currentTarget.value)}
              required
            />
            <TextInput
              label={t('ruleEditor.tokenLabel')}
              description={t('ruleEditor.tokenHint')}
              placeholder="URL_${host}"
              value={template}
              onChange={e => handleTemplateChange(e.currentTarget.value)}
            />
            <Switch
              label={t('ruleEditor.enabledLabel')}
              checked={enabled}
              onChange={e => { setEnabled(e.currentTarget.checked); setIsDirty(true); }}
            />
            <Group justify="flex-end" gap="xs" mt="sm">
              <Button variant="subtle" onClick={handleResetAndClose}>{t('ruleEditor.resetAndClose')}</Button>
              <Button variant="filled" onClick={handleSave} loading={saving} disabled={isDeletedOnServer || isChangedOnServer}>
                {isEdit ? t('ruleEditor.saveBtn') : t('ruleEditor.createBtn')}
              </Button>
            </Group>
          </Stack>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 5 }}>
          <RulePreviewPanel />
        </Grid.Col>
      </Grid>
    </Modal>
  );
};
