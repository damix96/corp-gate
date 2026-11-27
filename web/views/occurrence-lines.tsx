import { Code, Stack } from '@mantine/core';
import type { OccurrenceField } from '../models/session-occurrences.js';
import type { SessionAlias } from '../models/session-aliases.js';
import { SessionFragments } from '../models/session-fragments.js';
import { SessionText } from './session-text.js';

const isStandardField = (path: string) => path === 'request' || path === 'response' || /(?:^|\.)(?:messages|contents)(?:\[\d+\])?\.(?:content|parts|text)(?:\[\d+\])?(?:\.text)?$/.test(path);
const isToolScalar = (path: string) => /(?:arguments|input|args|functionResponse)\./.test(path) && !/\.(?:content|text)$/.test(path);

export const visibleOccurrenceFields = (fields: OccurrenceField[], full = false) => fields.filter(field => field.matches.length || full && !/\.(?:role|type|id|call_id|tool_call_id)$/.test(field.path));

export const OccurrenceLines = ({ fields, secretsMap, full = false }: { fields: OccurrenceField[]; secretsMap: Map<string, SessionAlias>; full?: boolean }) => <Stack gap="sm" miw={0}>
  {visibleOccurrenceFields(fields, full).map(field => {
    const toolScalar = isToolScalar(field.path);
    const label = !toolScalar && !isStandardField(field.path) ? field.path.replace(/^(?:request|response)\./, '') : '';
    return <Stack key={field.path} gap={4} data-occurrence-field={field.path}>
      {label && <Code fz="xs" w="fit-content">{label}</Code>}
      {(full ? [{ start: 0, end: field.text.length }] : SessionFragments.windows(field.text, field.matches)).map((range, i) => <Stack key={i} gap={0} data-occurrence-line>
        <SessionText text={`${toolScalar ? field.path.split('.').at(-1) + ': ' : ''}${range.start > 0 ? '… ' : ''}${field.text.slice(range.start, range.end)}${range.end < field.text.length ? ' …' : ''}`} secretsMap={secretsMap} compact={false} />
      </Stack>)}
    </Stack>;
  })}
</Stack>;
