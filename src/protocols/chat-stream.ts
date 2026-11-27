import { EventSourceMessage } from 'eventsource-parser';
import { StreamAdapter, StreamContext } from './stream-context.js';
import { Payload } from './types.js';

const TEXT_FIELDS = ['content', 'reasoning_content', 'refusal'];

export class ChatStream implements StreamAdapter {
  public matches = (body: Payload): boolean => Array.isArray(body.choices);

  public handle = (body: Payload, event: EventSourceMessage, context: StreamContext): void => {
    let textOnly = body.choices.length > 0 && !body.usage;
    for (const choice of body.choices) {
      const prefix = 'chat:' + (choice.index ?? 0) + ':';
      const template = structuredClone(body);
      const emit = (delta: Payload): void => context.write(event, { ...template, choices: [{ index: choice.index ?? 0, delta, finish_reason: null }] });
      const delta = choice.delta;
      let choiceText = false;
      if (delta) {
        for (const field of TEXT_FIELDS) {
          if (typeof delta[field] !== 'string') continue;
          context.text(prefix + field, delta[field], value => emit({ [field]: value }));
          delta[field] = '';
          choiceText = true;
        }
        for (const tool of delta.tool_calls || []) {
          if (typeof tool.function?.arguments !== 'string') continue;
          const index = tool.index ?? 0;
          context.arguments(prefix + 'tool:' + index, tool.function.arguments, value => emit({ tool_calls: [{ index, function: { arguments: value } }] }));
          tool.function.arguments = '';
        }
        if (typeof delta.function_call?.arguments === 'string') {
          context.arguments(prefix + 'function', delta.function_call.arguments, value => emit({ function_call: { arguments: value } }));
          delta.function_call.arguments = '';
        }
      }
      if (!choiceText || !delta || Object.keys(delta).some(key => !TEXT_FIELDS.includes(key)) || choice.tool_calls || choice.function_call || choice.finish_reason) textOnly = false;
      if (choice.finish_reason) context.flush(prefix);
    }
    if (!textOnly) context.write(event, context.snapshot(body));
  };
}
