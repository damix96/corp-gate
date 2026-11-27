import { SecretTokenBadge } from './secret-token-badge.js';
import { SessionLiteral } from './session-literal.js';
import type { SessionAlias } from '../models/session-aliases.js';

interface CallTokenTextProps { text: string; secretsMap?: Map<string, Partial<SessionAlias> & { key: string }>; }

export const CallTokenText = ({ text, secretsMap }: CallTokenTextProps) => {
  if (typeof text !== 'string') return null;
  const aliases = secretsMap ? [...secretsMap.keys()].filter(k => k.startsWith('$$')).sort((a, b) => b.length - a.length) : [];
  const regex = new RegExp(aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).concat('\\$\\$\\{<[^<>]+>\\}').join('|'), 'g');
  const parts: React.ReactNode[] = [];
  let offset = 0;
  for (const match of text.matchAll(regex)) {
    parts.push(<SessionLiteral key={`text-${offset}`} text={text.slice(offset, match.index)} />);
    const entry = secretsMap?.get(match[0]);
    parts.push(<SecretTokenBadge key={match.index} token={match[0]} baseKey={entry?.key} realValue={entry?.realValue} format={entry?.format} entryExists={Boolean(entry)} valueHidden={entry?.valueHidden} />);
    offset = match.index! + match[0].length;
  }
  parts.push(<SessionLiteral key={`text-${offset}`} text={text.slice(offset)} />);
  return <>{parts}</>;
};
