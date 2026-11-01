import { z } from 'zod';

export const taskSpecSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), title: z.string().min(1).max(200),
  description: z.string().min(1).max(12000), kind: z.enum(['map','reduce']),
  dependencies: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)).max(100),
});
export const leaseKeySchema = z.object({
  roomId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), runId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),
  attemptId: z.string().uuid(), fence: z.number().int().positive(),
});
export const workerCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('worker/poll') }).strict(),
  leaseKeySchema.extend({ type: z.literal('worker/heartbeat') }).strict(),
  leaseKeySchema.extend({ type: z.literal('worker/result'), success: z.boolean(),
    output: z.string().max(16000), commit: z.string().regex(/^[a-f0-9]{40}$/).optional() }).strict(),
]);
export type WorkerCommand = z.infer<typeof workerCommandSchema>;
export type LeaseKey = z.infer<typeof leaseKeySchema>;
export interface ExecutionJob extends LeaseKey {
  task: z.infer<typeof taskSpecSchema>;
  plan: string;
  baseSha: string;
  dependencyCommits: string[];
  inferenceToken: string;
}
export interface ExecutionTask extends z.infer<typeof taskSpecSchema> {
  status: 'pending' | 'running' | 'completed' | 'failed';
  fence?: number; attemptId?: string; workerId?: string; commit?: string; output?: string;
}
export interface ExecutionRun {
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  tasks: ExecutionTask[]; plan: string; baseSha: string; workerId?: string;
}
