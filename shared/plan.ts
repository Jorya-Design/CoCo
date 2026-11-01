import type { TaskSpec, Task } from './types.ts';

export const interviewQuestions = [
  { title: 'Who are we building for?', question: 'Who is the primary user, and what problem should this solve for them? Be specific — what do they do today that feels painful?', placeholder: 'e.g. Small engineering teams planning and shipping features together…' },
  { title: 'What is the first useful version?', question: 'What must someone be able to do in the first version? Pick the three or four capabilities that would make this immediately useful.', placeholder: 'e.g. Create a room, refine a shared plan, and launch coding tasks…' },
  { title: 'What are the constraints?', question: 'Any technical constraints? Tell me about your stack, existing repository, authentication, deployment target, and anything we should leave out.', placeholder: 'e.g. React and TypeScript, Linux workers, email sign-in…' },
  { title: 'How will we know it works?', question: 'What would a successful end-to-end demo look like? Include one failure case we should handle well.', placeholder: 'e.g. Two people edit together, then run parallel tasks and inspect the result…' },
];

export function makePlan(goal: string, answers: string[] = []) {
  const headings = ['Outcome', 'First version', 'Technical approach', 'Definition of done'];
  return `# ${goal}\n\n` + headings.flatMap((heading, index) =>
    answers[index]?.trim() ? [`## ${heading}\n${answers[index].trim()}\n\n`] : [],
  ).join('');
}

export function validateDag(tasks: TaskSpec[]) {
  if (!tasks.length || tasks.length > 100) throw new Error('A plan needs between 1 and 100 tasks.');
  const ids = new Set(tasks.map(t => t.id));
  if (ids.size !== tasks.length) throw new Error('Task IDs must be unique.');
  const visited = new Set<string>(), active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) throw new Error('The task graph contains a cycle.');
    if (visited.has(id)) return;
    const task = tasks.find(t => t.id === id);
    if (!task) throw new Error(`Missing dependency: ${id}`);
    active.add(id); task.dependencies.forEach(visit); active.delete(id); visited.add(id);
  };
  tasks.forEach(t => visit(t.id));
}

export const readyTasks = (tasks: Task[]) => tasks.filter(task => task.status === 'pending' && task.dependencies.every(id => tasks.find(t => t.id === id)?.status === 'completed'));
