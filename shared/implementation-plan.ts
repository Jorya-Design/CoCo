import { z } from 'zod';
import { taskSpecSchema } from './execution.ts';
import { validateDag } from './plan.ts';
import type { TaskSpec } from './types.ts';

export interface ImplementationPlan { id: string; plan: string; tasks: TaskSpec[] }

export const implementationReplySchema = z.object({
  reply: z.string().trim().min(1).max(8000),
  tasks: z.array(taskSpecSchema.strict()).min(1).max(100),
}).strict();

export function parseImplementationReply(value: unknown) {
  const result = implementationReplySchema.parse(value);
  validateDag(result.tasks);
  return result;
}

export function implementationMatchesPlan(implementation: ImplementationPlan | null, plan: string) {
  return !!implementation?.tasks.length && implementation.plan === plan;
}
