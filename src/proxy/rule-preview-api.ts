import { FastifyInstance } from 'fastify';
import { Worker } from 'node:worker_threads';
import { z } from 'zod';
import { VaultStore } from '../vault/store.js';
import { RuntimeSessions } from './runtime-sessions.js';

const input = z.object({ revision: z.number().int().nonnegative().optional(), type: z.string().default('custom'), label_template: z.string().min(1).max(512).nullable().default(null), pattern: z.string().min(1).max(16384), anyIp: z.boolean().default(false), matchOffset: z.number().int().min(0).default(0), offset: z.number().int().min(0).default(0), snapshot: z.string().datetime() });

export class RulePreviewApi {
  constructor(private app: FastifyInstance, private runtime: RuntimeSessions, private vault: VaultStore) {}

  register = () => this.app.post('/api/pattern-preview', async (req, reply) => {
    const parsed = input.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Specify an expression up to 16384 characters and preview parameters.' });
    const { revision, pattern, type, label_template, anyIp, offset, matchOffset, snapshot } = parsed.data;
    if (/^\/.*\/[a-z]*$/s.test(pattern)) return reply.status(400).send({ error: 'Enter an expression without /…/ delimiters or flags.' });
    if ((offset > 0 || matchOffset > 0) && revision === undefined) return reply.status(409).send({ error: 'Preview source changed. Run the preview again.' });
    const page = this.runtime.preview(offset, snapshot, revision);
    const worker = new Worker(new URL('./rule-preview-worker.js', import.meta.url), { workerData: { pattern, type, label_template, anyIp, matchOffset, rows: page.rows }, resourceLimits: { maxOldGenerationSizeMb: 48 } });
    let cancel = () => {};
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
        cancel = () => reject(new Error('Preview cancelled.'));
        reply.raw.once('close', cancel);
        timer = setTimeout(() => reject(new Error('Preview aborted: expression execution exceeded 1 second. Simplify the pattern.')), 1000);
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => { if (code !== 0) reject(new Error('Preview aborted due to resource limits.')); });
      });
      if (page.revision !== this.runtime.previewRevision()) return reply.status(409).send({ error: 'Recent calls changed. Run the preview again.' });
      if (result.error) return reply.status(400).send({ error: result.error });
      const results = (result.results as Array<{ value: string; labelPrefix: string }>).map(item => ({ ...item, ...this.vault.previewLabel(item.value, item.labelPrefix) }));
      return { ...result, results, revision: page.revision, next: result.more ? offset : page.next, matchOffset: result.more ? matchOffset + 20 : 0, total: page.total, scanned: page.rows.length };
    } catch (error) {
      return reply.status(408).send({ error: error instanceof Error ? error.message : 'Preview did not complete.' });
    } finally {
      clearTimeout(timer);
      reply.raw.removeListener('close', cancel);
      void worker.terminate();
    }
  });
}
