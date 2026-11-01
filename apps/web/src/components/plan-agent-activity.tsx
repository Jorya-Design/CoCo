import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Markdown } from '@/components/markdown';
import type { PlanRequest } from '@/lib/plan-agent';
import { LoaderCircle, Sparkles } from 'lucide-react';
const labels:Record<string,string>={queued:'Waiting for worker',running:'Reading the plan',suggested:'Suggested changes',apply_requested:'Applying changes',applied:'Plan updated',completed:'Answered',conflict:'Plan changed · review needed',rejected:'Suggestion dismissed',cancelled:'Cancelled',failed:'Request failed'};
export function PlanAgentActivity({requests,online,onDecision}:{requests:PlanRequest[];online:boolean;onDecision:(id:string,status:'apply_requested'|'rejected'|'cancelled')=>Promise<void>}) {
  const [busy,setBusy]=useState<string|null>(null);
  async function decide(id:string,status:'apply_requested'|'rejected'|'cancelled') {setBusy(id);try{await onDecision(id,status);}finally{setBusy(null);}}
  return <div className="agent-activity" aria-label="Codex plan activity">{requests.map(request=><article className="agent-request" key={request.id}>
    <div className="flex gap-2 items-center"><Sparkles size={12}/><strong>Codex</strong><Badge variant="outline" className="text-[9px]">{labels[request.status]??request.status}</Badge>{['queued','running','apply_requested'].includes(request.status)&&<LoaderCircle size={12} className="animate-spin"/>}</div>
    <p className="hint">{request.prompt}</p>
    {request.status==='queued'&&!online&&<p className="hint">The worker is offline. This request will start when it reconnects.</p>}
    {request.status==='running'&&<p className="hint">Using the plan, recent conversation and interview history. You can keep editing.</p>}
    {request.error&&<p role="alert" className="text-xs">{request.error}</p>}
    {!!request.edits?.length&&<details open={request.status==='suggested'||request.status==='conflict'}><summary>{request.edits.length} plan change{request.edits.length===1?'':'s'}</summary>{request.edits.map((edit,index)=><div key={index} className="plan-change"><div className="change-before"><span>Before</span><pre>{edit.before||'(empty plan)'}</pre></div><div className="change-after"><span>After</span><div className="markdown-content"><Markdown>{edit.after}</Markdown></div></div></div>)}</details>}
    {request.status==='suggested'&&<div className="flex gap-2 mt-3"><Button size="sm" disabled={busy===request.id} onClick={()=>void decide(request.id,'apply_requested')}>Accept changes</Button><Button size="sm" variant="ghost" disabled={busy===request.id} onClick={()=>void decide(request.id,'rejected')}>Dismiss</Button></div>}
    {['queued','running'].includes(request.status)&&<Button size="sm" variant="ghost" disabled={busy===request.id} onClick={()=>void decide(request.id,'cancelled')}>Cancel</Button>}
    {request.threadId&&<details className="hint"><summary>Codex thread</summary><code>{request.threadId}</code></details>}
  </article>)}</div>;
}
