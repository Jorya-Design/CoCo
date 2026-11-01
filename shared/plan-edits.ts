import * as Y from 'yjs';

/** Domain contract only: runtime adapters translate this into their current wire protocol. */
export interface PlanEdit {
  start: number[];
  end: number[];
  before: string;
  after: string;
}
export interface PlanContext { markdown: string; stateVector: number[] }
export function capturePlanContext(document: Y.Doc): PlanContext {
  return {markdown:document.getText('plan').toString(),stateVector:Array.from(Y.encodeStateVector(document))};
}
export function anchorPlanEdit(document: Y.Doc, from: number, to: number, after: string): PlanEdit {
  const text=document.getText('plan');
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<from||to>text.length)throw new Error('Invalid edit range');
  return {start:Array.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text,from))),
    end:Array.from(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(text,to))),before:text.toString().slice(from,to),after};
}
/** Resolve against the latest CRDT state. An overlapping human edit blocks the entire proposal. */
export function applyPlanEdits(document: Y.Doc, edits: PlanEdit[]): boolean {
  const text=document.getText('plan'), current=text.toString();
  if(!edits.length||edits.length>100)return false;
  const ranges: {from:number;to:number;after:string}[]=[];
  try {
    for(const edit of edits) {
      if(typeof edit.before!=='string'||typeof edit.after!=='string'||edit.after.length>120000)return false;
      const start=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(edit.start)),document);
      const end=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(edit.end)),document);
      if(!start||!end||start.type!==text||end.type!==text||end.index<start.index||current.slice(start.index,end.index)!==edit.before)return false;
      ranges.push({from:start.index,to:end.index,after:edit.after});
    }
  } catch {return false;}
  ranges.sort((a,b)=>b.from-a.from);
  for(let index=1;index<ranges.length;index++)if(ranges[index].to>=ranges[index-1].from)return false;
  if(current.length+ranges.reduce((sum,range)=>sum+range.after.length-(range.to-range.from),0)>120000)return false;
  document.transact(()=>{for(const range of ranges){text.delete(range.from,range.to-range.from);text.insert(range.from,range.after);}},'agent-edit');
  return true;
}
