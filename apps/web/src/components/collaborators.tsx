import { activityLabel, type PresenceSession } from '../../../../shared/presence.ts';
import { useId, useState } from 'react';

export function Collaborators({people,connection,userId,tasks}:{people:PresenceSession[];connection:string;userId?:string;tasks:{id:string;title:string}[]}) {
  const [expanded,setExpanded]=useState(false);
  const detailsId=useId();
  const label=(person:PresenceSession)=>`${person.name}${person.uid===userId?' (you)':''} · ${activityLabel(person,tasks.find(task=>task.id===person.taskId)?.title)}`;
  return <section aria-label="Live collaborators" className="mb-4 rounded-xl border border-border bg-card px-4 py-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <div className="flex items-center gap-3">
        <div className="flex -space-x-2" aria-label="Online member bubbles">
          {people.slice(0,6).map(person=><button type="button" key={person.uid} title={label(person)} aria-label={label(person)} aria-expanded={expanded} aria-controls={detailsId} onClick={()=>setExpanded(!expanded)}
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-background text-[11px] font-semibold transition-transform hover:z-10 hover:-translate-y-0.5 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring"
            style={{backgroundColor:`hsl(${person.uid.split('').reduce((sum,char)=>sum+char.charCodeAt(0),0)%360} 35% 32%)`,color:'white'}}>
            {person.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()||'?'}
            <span aria-hidden="true" className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${person.active===false?'bg-muted-foreground':'bg-emerald-500'}`}/>
          </button>)}
          {people.length>6&&<button type="button" className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-muted text-xs" aria-label="Show all connected members" onClick={()=>setExpanded(true)} aria-expanded={expanded} aria-controls={detailsId}>+{people.length-6}</button>}
        </div>
        <button type="button" className="font-semibold underline-offset-4 hover:underline" aria-expanded={expanded} aria-controls={detailsId} onClick={()=>setExpanded(!expanded)}>{connection==='live'?`${people.length} member${people.length===1?'':'s'} connected`:'Collaborator connection'}</button>
      </div>
      <span role="status" className="text-muted-foreground">{connection==='live'?'Live · this room':connection==='error'?'Presence unavailable':connection==='offline'?'Offline · reconnecting':'Connecting…'}</span>
    </div>
    <ul id={detailsId} hidden={!expanded} className={expanded?'mt-3 flex flex-wrap gap-4':'hidden'}>
      {people.map(person=><li key={person.uid} className="flex min-w-0 items-center gap-2 text-xs">
        <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden="true">
          {person.name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}
          <span className={`absolute bottom-0 right-0 h-2 w-2 rounded-full ${person.active===false?'bg-muted-foreground':'bg-emerald-500'}`}/>
        </span>
        <div className="min-w-0"><div>{person.name}{person.uid===userId?' (you)':''}</div><div className="max-w-64 truncate text-muted-foreground" title={activityLabel(person,tasks.find(task=>task.id===person.taskId)?.title)}>{activityLabel(person,tasks.find(task=>task.id===person.taskId)?.title)}</div></div>
      </li>)}
    </ul>
    <p className="mt-2 text-[10px] text-muted-foreground">Signed-in members are shown here. Anonymous viewers are not counted. Plan edits, messages and task status update live.</p>
  </section>;
}
