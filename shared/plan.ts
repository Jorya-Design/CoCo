import type { TaskSpec, Task } from './types.ts';

export const interviewQuestions = [
  { title: 'Who are we building for?', question: 'Who is the primary user, and what problem should this solve for them? Be specific — what do they do today that feels painful?', placeholder: 'e.g. Small engineering teams planning and shipping features together…' },
  { title: 'What is the first useful version?', question: 'What must someone be able to do in the first version? Pick the three or four capabilities that would make this immediately useful.', placeholder: 'e.g. Create a room, refine a shared plan, and launch coding tasks…' },
  { title: 'What are the constraints?', question: 'Any technical constraints? Tell me about your stack, existing repository, authentication, deployment target, and anything we should leave out.', placeholder: 'e.g. React and TypeScript, Linux workers, email sign-in…' },
  { title: 'How will we know it works?', question: 'What would a successful end-to-end demo look like? Include one failure case we should handle well.', placeholder: 'e.g. Two people edit together, then run parallel tasks and inspect the result…' },
];

export function makePlan(goal: string, answers: string[] = []) {
  return `# ${goal}\n\n## Outcome\n${answers[0] || 'Help a team turn a rough idea into an actionable plan and build it together.'}\n\n## First version\n${answers[1] || '- A shared planning room with chat and collaborative editing\n- A clear breakdown of independent and dependent coding tasks\n- A control plane to monitor Codex sessions on Linux'}\n\n## Technical approach\n${answers[2] || 'React + TypeScript interface. A persistent CRDT document. A control plane that dispatches dependency-ready tasks to isolated Codex sessions.'}\n\n## Definition of done\n${answers[3] || '- The complete user journey works end to end\n- Independent tasks execute in parallel; reduce tasks wait for their inputs\n- Failures are visible and can be retried'}\n\n## Execution strategy\nEstablish the contract first, map independent work into isolated branches, then reduce the results into an integrated, verified deliverable.\n`;
}

export function makeTasks(goal: string): TaskSpec[] {
  return [
    { id: 'scope', title: 'Define contracts & scaffold', description: `Read the plan for “${goal}”. Inspect the repository, establish interfaces and data contracts, and scaffold the minimal shared foundation. Implement only shared foundation files. Commit your changes and report the commit SHA and contracts for dependent tasks.`, kind: 'map', dependencies: [] },
    { id: 'interface', title: 'Build the user interface', description: 'Implement the frontend user journey in the plan using the shared contracts. Focus on accessible, responsive components and user interactions. Keep changes in frontend files. Commit changes and report the SHA, files changed, and validation.', kind: 'map', dependencies: ['scope'] },
    { id: 'services', title: 'Implement services & data', description: 'Implement server APIs, persistence, authentication and collaboration required by the plan using the shared contracts. Keep changes in server/data files. Commit changes and report the SHA, files changed, and validation.', kind: 'map', dependencies: ['scope'] },
    { id: 'verification', title: 'Write acceptance checks', description: 'Create meaningful acceptance checks for the plan and shared interfaces. Keep changes in test files. Do not invent successful outcomes; report any checks that need integration. Commit changes and report the SHA and how to run checks.', kind: 'map', dependencies: ['scope'] },
    { id: 'integration', title: 'Integrate & resolve', description: 'Integrate dependency commits already present in this worktree, resolve interface mismatches, and finish the complete user journey. Run relevant checks and fix failures. Commit changes and report the SHA and results.', kind: 'reduce', dependencies: ['interface', 'services', 'verification'] },
    { id: 'review', title: 'Review & package results', description: 'Review the integrated result against the definition of done. Run the appropriate build and checks, fix material defects, and document how to run it. Commit changes. Report final branch, commit SHA, actual check results, and remaining limitations. Do not deploy or push to an external remote.', kind: 'reduce', dependencies: ['integration'] },
  ];
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
