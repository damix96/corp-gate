import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Switch, Text, TextInput, Textarea } from '@mantine/core';
import { useLocale } from '../../stores/locale-store.js';
import { useVault, vaultStore } from '../../stores/vault-store.js';

export const SecretModal = () => {
  const { t } = useLocale();
  const { modalOpened, modalSecretKey, manualSecrets, autoSecrets } = useVault();
  const isEdit = Boolean(modalSecretKey);

  const [key, setKey] = useState('');
  const [realValue, setRealValue] = useState<string | undefined>('');
  const [description, setDescription] = useState('');
  const [isSecret, setIsSecret] = useState(true);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [valError, setValError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const isComposingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!modalOpened) return;
    const draftKey = modalSecretKey || '';
    const draft = vaultStore.getDraft(draftKey);
    const existing = modalSecretKey ? vaultStore.getSnapshot().manualSecrets.find(s => s.key === modalSecretKey) : undefined;
    if (draft) {
      setKey(draft.key);
      setRealValue(draft.realValue);
      setDescription(draft.description || '');
      setIsSecret(Boolean(draft.isSecret));
      setIsDirty(true);
    } else if (existing) {
      setKey(existing.key);
      setRealValue(existing.realValue ?? '');
      setDescription(existing.description || '');
      setIsSecret(Boolean(existing.isSecret));
      setIsDirty(false);
    } else {
      setKey('');
      setRealValue('');
      setDescription('');
      setIsSecret(true);
      setIsDirty(false);
    }
    setKeyError(null);
    setValError(null);
    setSaveError(null);
  }, [modalOpened, modalSecretKey]);

  const applyKeyChange = (raw: string, cursorStart?: number, cursorEnd?: number) => {
    const normalized = raw.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '');
    setKey(normalized);
    setKeyError(null);
    setSaveError(null);
    setIsDirty(true);
    if (cursorStart !== undefined && cursorEnd !== undefined && inputRef.current) {
      requestAnimationFrame(() => {
        inputRef.current?.setSelectionRange(cursorStart, cursorEnd);
      });
    }
  };

  const handleClose = () => {
    if (isDirty) {
      vaultStore.setDraft(modalSecretKey || '', { key, realValue, description, isSecret });
    }
    vaultStore.closeModal();
  };

  const handleSave = async () => {
    setSaveError(null);
    let valid = true;
    if (!key.trim()) {
      setKeyError(t('validation.keyRequired'));
      valid = false;
    } else if (!/^[A-Z0-9_]+$/.test(key)) {
      setKeyError(t('validation.keyFormat'));
      valid = false;
    } else if (!isEdit && (manualSecrets.some(s => s.key === key) || autoSecrets.some(s => s.key === key))) {
      setKeyError(t('validation.keyExists'));
      valid = false;
    }
    const existingSecret = modalSecretKey ? manualSecrets.find(s => s.key === modalSecretKey) : undefined;
    const isUnchangedEncrypted = isEdit && existingSecret?.isSecret && (realValue === undefined || realValue === '');
    if (!isUnchangedEncrypted && (realValue === undefined || realValue === '')) {
      setValError(t('validation.valRequired'));
      valid = false;
    }
    if (!valid) return;
    setSaving(true);
    try {
      const res = isEdit
        ? await vaultStore.patchSecret(key, { isSecret, description: description || undefined, expectedRevision: existingSecret?.writeRevision, ...(realValue ? { realValue } : {}) })
        : await vaultStore.saveSecret({ key, realValue: realValue ?? '', description: description || undefined, isSecret });
      if (res.success) {
        setIsDirty(false);
      } else {
        setSaveError(res.error || t('common.saveFailed', { error: '' }));
      }
    } finally {
      setSaving(false);
    }
  };

  const existingSecret = modalSecretKey ? manualSecrets.find(s => s.key === modalSecretKey) : undefined;
  const title = (isEdit ? t('secretEditor.editHeading') : t('secretEditor.addHeading')) + (isDirty ? t('common.draftSuffix') : '');
  const isKeyValid = Boolean(key && /^[A-Z0-9_]+$/.test(key));
  const placeholderToken = isKeyValid ? '$${<' + key + '>}' : t('validation.keyPreviewPlaceholder');

  return (
    <Modal opened={modalOpened} onClose={handleClose} title={<Text fw={600}>{title}</Text>} size="md" centered trapFocus>
      <Stack gap="sm">
        {saveError && <Alert color="red">{saveError}</Alert>}
        <TextInput
          ref={inputRef}
          label={isEdit ? t('secretEditor.recordName') : t('secretEditor.tokenName')}
          description={isEdit ? t('secretEditor.recordNameDesc') : t('secretEditor.tokenNameDesc')}
          placeholder="INTERNAL_HOST"
          value={key}
          readOnly={isEdit}
          error={keyError}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={e => {
            isComposingRef.current = false;
            applyKeyChange(e.currentTarget.value, e.currentTarget.selectionStart ?? undefined, e.currentTarget.selectionEnd ?? undefined);
          }}
          onChange={e => {
            if (isComposingRef.current) {
              setKey(e.currentTarget.value);
              return;
            }
            applyKeyChange(e.currentTarget.value, e.currentTarget.selectionStart ?? undefined, e.currentTarget.selectionEnd ?? undefined);
          }}
          required
        />
        <Textarea
          label={t('secretEditor.valLabel')}
          description={t('secretEditor.valDesc')}
          placeholder={isEdit && existingSecret?.isSecret ? t('secretEditor.valUnchangedPlaceholder') : t('secretEditor.valPlaceholder')}
          value={realValue}
          minRows={3}
          error={valError}
          onChange={e => {
            setRealValue(e.currentTarget.value);
            setValError(null);
            setSaveError(null);
            setIsDirty(true);
          }}
          required={!isEdit || !existingSecret?.isSecret}
        />
        <TextInput
          label={t('secretEditor.descLabel')}
          placeholder={t('secretEditor.descPlaceholder')}
          value={description}
          onChange={e => {
            setDescription(e.currentTarget.value);
            setSaveError(null);
            setIsDirty(true);
          }}
        />
        <Switch
          label={t('secretEditor.dpapiSwitch')}
          description={t('secretEditor.dpapiDesc')}
          checked={isSecret}
          onChange={e => {
            setIsSecret(e.currentTarget.checked);
            setIsDirty(true);
          }}
        />
        <Stack gap={4}>
          <Group gap="xs">
            <Text size="xs" c="dimmed">{t('secretEditor.inRequest')}:</Text>
            <Badge variant="light" size="sm" ff="monospace">{placeholderToken}</Badge>
          </Group>
          {isEdit && existingSecret?.alias && (
            <Group gap="xs">
              <Text size="xs" c="dimmed">{t('secretEditor.currentAlias')}:</Text>
              <Badge variant="outline" size="sm" ff="monospace">{existingSecret.alias}</Badge>
            </Group>
          )}
        </Stack>
        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={handleClose}>{t('common.close')}</Button>
          <Button variant="filled" onClick={handleSave} loading={saving}>{t('secretEditor.saveBtn')}</Button>
        </Group>
      </Stack>
    </Modal>
  );
};
