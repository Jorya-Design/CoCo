import type { Run, Task, TaskSpec } from '../../../../shared/types.ts';
import { validateDag } from '../../../../shared/plan.ts';

export function taskStages(tasks: TaskSpec[]): TaskSpec[][] {
  validateDag(tasks);
  const byId = new Map(tasks.map(task => [task.id, task]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    const dependencies = byId.get(id)!.dependencies;
    const value = dependencies.length ? Math.max(...dependencies.map(depth)) + 1 : 0;
    depths.set(id, value);
    return value;
  };
  const stages: TaskSpec[][] = [];
  for (const task of tasks) (stages[depth(task.id)] ??= []).push(task);
  return stages;
}

export function taskStatus(task?: Task) {
  return { pending: 'Pending', running: 'Running', completed: 'Completed', failed: 'Failed' }[task?.status ?? 'pending'];
}

export function canInterrupt(run: Run | null, taskId: string) {
  return run?.status === 'running' && run.tasks.some(task => task.id === taskId && task.status === 'running');
}

export function formatTime(value?: number) {
  return value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not started';
}
