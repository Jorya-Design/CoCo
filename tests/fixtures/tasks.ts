import type { TaskSpec } from '../../shared/types.ts';

// Representative graph for scheduler and dependency tests; never seeded into rooms.
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

