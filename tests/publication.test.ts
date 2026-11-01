import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicationPrompt, publicationTarget, verifiedPullRequest } from '../shared/publication.ts';
import { workerCommandSchema } from '../shared/execution.ts';

const commit='a'.repeat(40);
const githubPr={number:42,url:'https://github.com/Jorya-Design/CoCo/pull/42',title:'Build the approved journey',
  headRefName:'codex/coco-run-1',baseRefName:'main',headRefOid:commit,state:'OPEN',isDraft:false,isCrossRepository:false};

test('publication confirms GitHub repository, branches, open state and the exact final commit',()=>{
  const pr=verifiedPullRequest(githubPr,'run-1',commit);
  assert.equal(pr.commit,commit);
  assert.equal(pr.branch,publicationTarget('run-1').branch);
  for(const change of [{url:'https://example.com/pull/42'},{number:43},{headRefName:'main'},
    {baseRefName:'other'},{headRefOid:'b'.repeat(40)},{state:'CLOSED'},{state:'MERGED'},
    {isDraft:true},{isCrossRepository:true},{title:''}]) {
    assert.throws(()=>verifiedPullRequest({...githubPr,...change},'run-1',commit));
  }
  assert.throws(()=>verifiedPullRequest(null,'run-1',commit));
  assert.throws(()=>publicationTarget('../bad'));
});

test('worker result protocol transports a bounded PR record and rejects forged review links',()=>{
  const result={type:'worker/result',roomId:'room-1',runId:'run-1',attemptId:'123e4567-e89b-42d3-a456-426614174000',
    fence:1,success:true,output:'Actual checks',commit,pullRequest:verifiedPullRequest(githubPr,'run-1',commit)};
  assert.equal(workerCommandSchema.parse(result).type,'worker/result');
  for(const change of [{url:'javascript:alert(1)'},{url:githubPr.url+'/extra'},{number:9},{branch:'main'},
    {base:'other'},{commit:'not-a-sha'},{title:'x'.repeat(257)}]) {
    assert.equal(workerCommandSchema.safeParse({...result,pullRequest:{...result.pullRequest,...change}}).success,false);
  }
  assert.equal(workerCommandSchema.safeParse({...result,githubToken:'must-not-cross-protocol'}).success,false);
});

test('final Codex task is authorized to create the review PR without merging or deploying',()=>{
  const prompt=publicationPrompt('Approved requirements','run-1');
  assert.match(prompt,/gh pr create --repo Jorya-Design\/CoCo --base main --head codex\/coco-run-1/);
  assert.match(prompt,/Do not merge, enable auto-merge, deploy/);
  assert.match(prompt,/actual validation/);
  assert.match(prompt,/Approved requirements/);
});
