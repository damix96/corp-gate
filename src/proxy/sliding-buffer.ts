import { RestorationMatch } from '../telemetry/response-change-evidence.js';

export class SlidingStreamTransformer {
  private input = '';
  private values: Map<string, string>;
  private prefixes = new Set<string>();
  private pattern?: RegExp;
  private maxTokenLength: number;
  private inputOffset = 0;
  private outputOffset = 0;

  constructor(replacements: Array<{ from: string; to: string }>, _windowSize = 64, private onReplace?: (match: RestorationMatch) => void) {
    const sorted = [...replacements].filter(value => value.from).sort((a, b) => b.from.length - a.from.length);
    this.values = new Map(sorted.map(({ from, to }) => [from, to]));
    this.maxTokenLength = sorted.length ? Math.max(...sorted.map(value => value.from.length)) : 1;
    if (sorted.length) this.pattern = new RegExp(sorted.map(({ from }) => from.replace(/\W/g, '\\$&')).join('|'), 'g');
    for (const { from } of sorted) for (let length = 1; length < from.length; length++) this.prefixes.add(from.slice(0, length));
  }

  public push = (chunk: string): string => {
    this.input += chunk;
    let pending = Math.min(this.input.length, this.maxTokenLength - 1);
    while (pending && !this.prefixes.has(this.input.slice(-pending))) pending--;
    let ready = this.input.length - pending;
    if (ready > 0) {
      const last = this.input.charCodeAt(ready - 1);
      if (last >= 0xd800 && last <= 0xdbff && (ready === this.input.length || (this.input.charCodeAt(ready) >= 0xdc00 && this.input.charCodeAt(ready) <= 0xdfff))) ready--;
    }
    if (!ready) return '';
    const emit = this.replace(this.input.slice(0, ready));
    this.input = this.input.slice(ready);
    return emit;
  };

  public flush = (): string => {
    const remaining = this.replace(this.input);
    this.input = '';
    return remaining;
  };

  private replace = (text: string): string => {
    let difference = 0;
    const result = this.pattern ? text.replace(this.pattern, (alias, start: number) => {
      const value = this.values.get(alias)!;
      this.onReplace?.({ alias, value, start: this.inputOffset + start, end: this.inputOffset + start + alias.length, outputStart: this.outputOffset + start + difference });
      difference += value.length - alias.length;
      return value;
    }) : text;
    this.inputOffset += text.length;
    this.outputOffset += result.length;
    return result;
  };
}
