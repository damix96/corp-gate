import { z } from 'zod';

export const inputNames = z.array(z.string().regex(/^[A-Z0-9_]+$/).max(128)).min(1).max(32)
  .refine(names => new Set(names).size === names.length && names.join(',').length <= 4096);
export const inputVariableSchema = z.object({
  name: z.string().regex(/^[A-Z0-9_]+$/).max(128),
  description: z.string().optional(),
  isSecret: z.boolean().optional(),
}).strict();
export const inputVariables = z.array(inputVariableSchema).min(1).max(32)
  .refine(vars => new Set(vars.map(v => v.name)).size === vars.length && vars.map(v => v.name).join(',').length <= 4096);
export const inputRequestSchema = z.object({
  operation: z.literal('set').default('set'),
  names: inputNames.optional(),
  variables: inputVariables.optional(),
  idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
}).strict().refine(data => Boolean(data.variables?.length || data.names?.length), {
  message: 'Either names or variables must be provided',
});
export const inputIdSchema = z.object({ requestId: z.string().regex(/^(?:[a-f0-9]{4,8}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i) }).strict();
export const inputSubmitEntrySchema = z.object({
  name: z.string(),
  value: z.string().min(1).refine(value => Buffer.byteLength(value) <= 65536),
  description: z.string().optional(),
  isSecret: z.boolean().optional(),
}).strict();
export const inputSubmitSchema = z.object({ submissionId: z.string().uuid(), values: z.array(inputSubmitEntrySchema).min(1).max(32) }).strict();
export const inputNotice = { code: 'SECRET_STORAGE_CLEANUP_PENDING' as const, message: 'Protected values were saved. Cleanup of earlier plaintext copies in the current database could not be confirmed when saved. Check Vault for current cleanup status. Do not resubmit values.' };
export const inputViewSchema = z.object({
  requestId: z.string().min(4).max(64),
  shortId: z.string().optional(),
  operation: z.literal('set'),
  names: inputNames,
  variables: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    isSecret: z.boolean().optional(),
  })).optional(),
  url: z.string().url(),
  state: z.enum(['awaiting_input', 'committing', 'completed', 'cancelled', 'expired', 'failed']),
  expiresAt: z.number(),
  launch: z.enum(['attempted', 'unavailable', 'not_requested']),
  result: z.array(z.object({ name: z.string(), token: z.string() })).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  notice: z.object({ code: z.literal('SECRET_STORAGE_CLEANUP_PENDING'), message: z.string() }).optional(),
});
export type SecretInputRequest = z.infer<typeof inputRequestSchema>;
export type SecretInputView = z.infer<typeof inputViewSchema>;
export type SecretInputSubmission = z.infer<typeof inputSubmitSchema>;
export interface InputVariableSpec { name: string; description?: string; isSecret?: boolean }
export interface InputRevision { name: string; expectedRevision: string | null; description?: string; isSecret?: boolean }
export interface SecretInputReceipt { variables: Array<{ name: string; token: string }>; notice?: { code: 'SECRET_STORAGE_CLEANUP_PENDING'; message: string } }
export interface SecretInputStorage {
  inspect: (operation: 'set', names: string[]) => InputRevision[];
  commit: (operation: 'set', values: Array<InputRevision & { value: string; description?: string; isSecret?: boolean }>, requestId: string) => Promise<SecretInputReceipt>;
  listNames?: () => string[];
}
