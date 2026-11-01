import { z } from 'zod';
import * as Y from 'yjs';
import { anchorPlanEdit, type PlanEdit } from './plan-edits.ts';

export const planModeSchema = z.enum(['answer', 'suggest', 'edit']);
export type PlanMode = z.infer<typeof planModeSchema>;
export const planReplySchema = z.object({
  reply: z.string().min(1).max(8000),
  edits: z.array(z.object({before:z.string().max(12000),after:z.string().max(12000)}).strict()).max(20),
}).strict();
export interface PlanAgentContext { mode: PlanMode; prompt: string; conversation: string; interview: string }
/** Match against the captured CRDT, never against a newer version the model has not seen. */
export function anchorReply(document:Y.Doc, value:unknown, mode:PlanMode): {reply:string;edits:PlanEdit[]} {
  const result=planReplySchema.parse(value);
  if(mode==='answer' && result.edits.length)throw new Error('Answer mode cannot edit the plan.');
  const markdown=document.getText('plan').toString();
  const edits=result.edits.map(edit=>{
    if(edit.before===edit.after)throw new Error('Empty change');
    if(!edit.before && markdown)throw new Error('Insertion needs an existing anchor passage');
    const from=edit.before ? markdown.indexOf(edit.before) : 0;
    if(from<0 || (edit.before && markdown.indexOf(edit.before,from+1)>=0))throw new Error('Ambiguous or missing edit passage');
    return anchorPlanEdit(document,from,from+edit.before.length,edit.after);
  });
  return {reply:result.reply,edits};
}
