import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().positive();
const registrySchema = z.object({ workers: z.array(z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  disabled: z.boolean().default(false),
  tokens: z.array(z.object({ sha256: digest, expiresAt: timestamp })).max(2),
})) }).superRefine(({ workers }, ctx) => {
  if (new Set(workers.map(w => w.id)).size !== workers.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate worker identity' });
  const hashes = workers.flatMap(w => w.tokens.map(t => t.sha256));
  if (new Set(hashes).size !== hashes.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate credential' });
});
export type WorkerRegistry = z.infer<typeof registrySchema>;
export interface WorkerIdentity { workerId: string; tokenSha256: string }
export interface RunLease {
  roomId: string; runId: string; attemptId: string; workerId: string;
  fence: number; expiresAt: number; status: 'active' | 'cancelled' | 'completed';
}
export class Unauthorized extends Error { constructor() { super('Worker authentication required'); } }
export class Forbidden extends Error { constructor() { super('Active assigned lease required'); } }
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function parseRegistry(value: unknown): WorkerRegistry { return registrySchema.parse(value); }
export const loadRegistry = async (path: string) => parseRegistry(JSON.parse(await readFile(path, 'utf8')));

export function authenticateWorker(header: string | undefined, registry: WorkerRegistry, now = Date.now()): WorkerIdentity {
  // 32 random bytes encoded as unpadded base64url. Never accept query-string credentials.
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header ?? '');
  if (!match) throw new Unauthorized();
  const candidate = hashToken(match[1]);
  for (const worker of registry.workers) {
    for (const token of worker.tokens) {
      const matches = timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(token.sha256, 'hex'));
      if (matches && !worker.disabled && token.expiresAt > now)
        return { workerId: worker.id, tokenSha256: candidate };
    }
  }
  throw new Unauthorized();
}

// lease MUST come from trusted scheduler storage, never the worker request body.
// The scheduler must check the same fence transactionally when accepting a write.
export function authorizeWorkerRun(identity: WorkerIdentity, request: {
  roomId: string; runId: string; attemptId: string; fence: number;
}, lease: RunLease | null, now = Date.now()): void {
  if (!lease || lease.status !== 'active' || lease.expiresAt <= now ||
      lease.workerId !== identity.workerId || lease.roomId !== request.roomId ||
      lease.runId !== request.runId || lease.attemptId !== request.attemptId ||
      lease.fence !== request.fence) throw new Forbidden();
}
