import { ArrowUpRight, CheckCheck, GitPullRequest, LoaderCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Run } from '../../../../shared/types.ts';
import { Markdown } from './markdown';

export function PrReview({run}:{run:Run|null}) {
  const pr=run?.pullRequest;
  const publishing=run?.status==='running'&&run.publication?.status==='running';
  const failed=run?.publication?.status==='failed';
  const stopped=run?.status==='failed'||run?.status==='cancelled';
  const title=pr?'Ready for your review':publishing?'Codex is creating the pull request':failed?'PR creation needs attention'
    :stopped?'The run stopped before review':run?.status==='completed'?'No PR recorded for this run':run?'Implementation is in progress':'Your finished work lands here';
  return <section className="control pr-review" aria-labelledby="pr-review-title">
    <div className="control-heading"><div><div className="eyebrow mb-2">Plan & conversation → Implementation → PR to Review</div><h1 id="pr-review-title">PR to Review</h1><p>Codex brings the completed implementation into one pull request for your team to review.</p></div><Badge variant="outline">Final stage</Badge></div>
    <article className="review-card" aria-live="polite">
      <div className="review-icon">{publishing?<LoaderCircle size={24} className="animate-spin"/>:<GitPullRequest size={24}/>}</div>
      <div><h2>{title}</h2>{pr ? <>
        <p className="review-pr-title">#{pr.number} · {pr.title}</p>
        <div className="review-metadata"><span>{pr.branch} → {pr.base}</span><span>Commit {pr.commit.slice(0,8)}</span></div>
        <Button asChild className="mt-5"><a href={pr.url} target="_blank" rel="noreferrer">Review pull request <ArrowUpRight size={14}/></a></Button>
      </> : <p>{publishing?'The full task graph is complete. Codex is checking the integrated result and publishing a bot-authored PR.'
        :failed?'The implementation is saved, but the worker could not finish or verify the PR. Check the details below and GitHub before starting a new run.'
        :stopped?'Resolve the execution issue and start a new approved run to reach the PR stage.'
        :run?.status==='completed'?'This earlier run finished without a published PR. New runs complete with a Codex-created pull request.'
        :'Approve the shared plan and run it in Implementation. After every task finishes, Codex creates a single PR with the changes and actual check results.'}</p>}
      </div>
    </article>
    {run?.publication?.output&&<div className="review-output markdown-content"><h2>{failed?'Publication details':'Codex handoff'}</h2><Markdown>{run.publication.output}</Markdown></div>}
    <p className="hint flex items-center gap-2"><CheckCheck size={12}/> Review and merge happen on GitHub. CoCo never merges the PR automatically.</p>
  </section>;
}
