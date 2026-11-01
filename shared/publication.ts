// This deployment executes against the CoCo repository pinned by the control plane.
export const repository = 'Jorya-Design/CoCo';
export const baseBranch = 'main';

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  branch: string;
  base: typeof baseBranch;
  commit: string;
}

export function publicationTarget(runId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(runId)) throw new Error('Invalid run ID');
  return { repository, base: baseBranch, branch: `codex/coco-${runId}` } as const;
}

export function publicationPrompt(plan: string, runId: string) {
  const target = publicationTarget(runId);
  return `Finish this approved CoCo journey by creating a pull request for human review.
All implementation task commits have been integrated into this worktree.
Review the integrated diff against the approved plan, run the appropriate checks, and fix material failures before publishing.
GitHub CLI (gh) authenticates as the regular automation user account using its personal access token in GH_TOKEN. Never print, persist, or include the credential in a commit or PR.
Work only in the current worktree. Create branch ${target.branch}, commit any final changes, and push it to https://github.com/${target.repository}.git without force.
Use gh pr create --repo ${target.repository} --base ${target.base} --head ${target.branch} with a concrete title and a body covering the changes, actual validation, and limitations. Use a file with --body-file for the body.
If a PR already exists for this branch, reuse it. The PR must be open and ready for review, not a draft. Do not merge, enable auto-merge, deploy, or push to ${target.base}.
Do not leave uncommitted changes or change the branch after publishing. Report the PR URL and actual checks.

Approved plan:
${plan}`;
}

// Accept GitHub's response, never a link supplied in the agent's prose.
export function verifiedPullRequest(value: unknown, runId: string, commit: string): PullRequest {
  const pr = value as Record<string, unknown> | null;
  const target = publicationTarget(runId);
  if (!pr || !Number.isSafeInteger(pr.number) || (pr.number as number) <= 0
    || pr.url !== `https://github.com/${repository}/pull/${pr.number}`
    || typeof pr.title !== 'string' || !pr.title.trim() || pr.title.length > 256
    || pr.headRefName !== target.branch || pr.baseRefName !== target.base
    || pr.headRefOid !== commit || !/^[a-f0-9]{40}$/.test(commit)
    || pr.state !== 'OPEN' || pr.isDraft !== false || pr.isCrossRepository !== false) {
    throw new Error('GitHub did not confirm the final pull request');
  }
  return {number: pr.number as number, url: pr.url as string, title: pr.title,
    branch: target.branch, base: target.base, commit};
}
