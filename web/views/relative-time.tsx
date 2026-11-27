import { Text, Tooltip } from '@mantine/core';
import { useLocale } from '../stores/locale-store.js';

interface RelativeTimeProps {
  timestamp?: string;
  size?: string;
  c?: string;
  fw?: number;
}

export const RelativeTime = ({ timestamp, size = 'xs', c = 'dimmed', fw }: RelativeTimeProps) => {
  const { locale, t } = useLocale();

  if (!timestamp) return <Text size={size} c={c} fw={fw}>{t('relativeTime.notSaved')}</Text>;

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return <Text size={size} c={c} fw={fw}>{t('relativeTime.notSaved')}</Text>;

  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSec = Math.abs(seconds);
  const [unit, scale]: [Intl.RelativeTimeFormatUnit, number] = absSec < 60
    ? ['second', 1]
    : absSec < 3600
      ? ['minute', 60]
      : absSec < 86400
        ? ['hour', 3600]
        : ['day', 86400];

  const lang = locale === 'en' ? 'en' : 'ru';
  const label = absSec < 10
    ? t('relativeTime.justNow')
    : new Intl.RelativeTimeFormat(lang, { numeric: 'always' }).format(Math.trunc(seconds / scale), unit);

  const fullDate = date.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', { dateStyle: 'full', timeStyle: 'long' });

  return (
    <Tooltip label={fullDate}>
      <Text size={size} c={c} fw={fw} data-relative-time={date.toISOString()}>{label}</Text>
    </Tooltip>
  );
};
