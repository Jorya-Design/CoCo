import { z } from 'zod';
import { baseBranch, repository } from './publication.ts';

export const pullRequestSchema = z.object({
  number: z.number().int().positive(),
  url: z.string().regex(new RegExp(`^https://github\\.com/${repository}/pull/[1-9][0-9]*$`)),
  title: z.string().min(1).max(256), branch: z.string().regex(/^codex\/coco-[a-zA-Z0-9_-]{1,128}$/),
  base: z.literal(baseBranch), commit: z.string().regex(/^[a-f0-9]{40}$/),
}).strict().refine(pr => pr.url === `https://github.com/${repository}/pull/${pr.number}`);
export const executionResultSchema = z.object({
  success: z.boolean(), output: z.string().max(16000),
  commit: z.string().regex(/^[a-f0-9]{40}$/).optional(), pullRequest: pullRequestSchema.optional(),
}).strict();
export type ExecutionResult = z.infer<typeof executionResultSchema>;

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
  leaseKeySchema.extend({ type: z.literal('worker/thread'), threadId: z.string().min(1).max(128) }).strict(),
  leaseKeySchema.extend({ type: z.literal('worker/result'), ...executionResultSchema.shape }).strict(),
]);
export type WorkerCommand = z.infer<typeof workerCommandSchema>;
export type LeaseKey = z.infer<typeof leaseKeySchema>;
export interface ExecutionJob extends LeaseKey {
  task: z.infer<typeof taskSpecSchema>;
  plan: string;
  baseSha: string;
  dependencyCommits: string[];
  inferenceToken: string;
  planning?: import('./plan-agent.ts').PlanAgentContext;
  publication?: ReturnType<typeof import('./publication.ts').publicationTarget>;
}
export interface ExecutionTask extends z.infer<typeof taskSpecSchema> {
  status: 'pending' | 'running' | 'completed' | 'failed';
  fence?: number; attemptId?: string; workerId?: string; commit?: string; output?: string; threadId?: string;
}
export interface ExecutionRun {
  implementationPlanId?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  tasks: ExecutionTask[]; plan: string; baseSha: string; workerId?: string;
  publication?: ExecutionTask;
  pullRequest?: import('./publication.ts').PullRequest;
}
