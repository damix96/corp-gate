import type { SessionStep } from '../stores/types.js';
import { SessionAliases } from './session-aliases.js';
import { SessionPayload, type TextField } from './session-payload.js';
import type { FragmentRange } from './session-fragments.js';

export interface OccurrenceField extends TextField { matches: FragmentRange[]; }
export interface OccurrenceTurn { id: string; index?: number; request: OccurrenceField[]; response: OccurrenceField[]; latest: boolean; }

export class SessionOccurrences {
  static ordered = (turns: OccurrenceTurn[], newest: boolean): Array<{ turn: OccurrenceTurn; sides: Array<'request' | 'response'> }> => (newest ? [...turns].reverse() : turns).map(turn => ({ turn, sides: newest ? ['response', 'request'] : ['request', 'response'] }));

  static fields = (body: unknown, aliases: SessionAliases, path = 'request'): OccurrenceField[] => SessionPayload.decodedFields(SessionPayload.safe(body), path).map(field => ({ ...field, matches: [...field.text.matchAll(aliases.matcher())].map(match => ({ start: match.index!, end: match.index! + match[0].length })) }));

  static turns = (step: SessionStep, aliases: SessionAliases): OccurrenceTurn[] => {
    const body = SessionPayload.parse(step.maskedPrompt);
    const messages = SessionPayload.messages(body);
    const { turns } = SessionPayload.turns(messages);
    const result: OccurrenceTurn[] = turns.length ? turns.map((turn, i) => ({ id: turn.id, index: turn.index, request: [], response: [], latest: i === turns.length - 1 })) : [{ id: 'unbound', request: [], response: [], latest: true }];
    for (const field of SessionOccurrences.fields(body, aliases)) {
      const message = messages.find(item => {
        const prefix = item.id.startsWith('items[') ? `request${item.id.slice(5)}` : `request.${item.id}`;
        return item.id === 'message' || field.path === prefix || field.path.startsWith(`${prefix}.`) || field.path.startsWith(`${prefix}[`);
      });
      const turnIndex = message ? turns.findIndex(turn => turn.messages.includes(message)) : -1;
      const target = result[Math.max(0, turnIndex)]!;
      if (turnIndex >= 0 && message?.role !== 'user') target.response.push(field); else target.request.push(field);
    }
    return result;
  };
}
