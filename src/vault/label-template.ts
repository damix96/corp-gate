import { RegExpParser, visitRegExpAST } from '@eslint-community/regexpp';
import { RE2JS } from 're2js';

export class LabelTemplate {
  private static tokens = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*|[1-9][0-9]*)\}|\$([A-Za-z][A-Za-z0-9]*|[1-9][0-9]*)|\$/g;

  public static validate = (pattern: string, template?: string | null): void => {
    try { RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE); }
    catch (error) { throw new Error('Invalid or unsupported RE2 expression (lookahead, lookbehind, and backreferences are not supported): ' + (error instanceof Error ? error.message : String(error))); }
    if (template == null) return;
    if (!template.trim() || template.length > 512) throw new Error('Label template must be between 1 and 512 characters.');
    const ast = new RegExpParser().parsePattern(pattern);
    let count = 0;
    const names = new Set<string>();
    visitRegExpAST(ast, { onCapturingGroupEnter: group => { count++; if (group.name) names.add(group.name); } });
    for (const token of template.matchAll(this.tokens)) {
      if (token[0] === '$$') continue;
      const reference = token[1] || token[2];
      if (!reference || (/^[0-9]+$/.test(reference) ? Number(reference) > count : !names.has(reference))) throw new Error('Unknown capture group or invalid reference in template: ' + token[0]);
    }
  };

  public static normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 96);

  public static prefix = (type: string, template?: string | null, match?: RegExpMatchArray): string => {
    const fallback = this.normalize('AUTO_' + type);
    if (template == null) return fallback;
    const rendered = template.replace(this.tokens, (token, braced: string, short: string) => {
      if (token === '$$') return '$';
      const reference = braced || short;
      if (!reference) throw new Error('Invalid reference in template.');
      return (/^[0-9]+$/.test(reference) ? match?.[Number(reference)] : match?.groups?.[reference]) ?? 'NA';
    });
    return this.normalize(rendered) || fallback;
  };
}
