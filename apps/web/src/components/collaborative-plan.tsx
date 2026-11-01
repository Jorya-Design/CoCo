import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import type { FirestoreDocument } from '@/lib/collaboration';
import type { PlanRequest } from '@/lib/plan-agent';
import { Sparkles } from 'lucide-react';

export function CollaborativePlan({ provider, requests }: { provider: FirestoreDocument;requests:PlanRequest[] }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView|null>(null);
  const latest=useRef(requests);latest.current=requests;
  const active=requests.filter(r=>['running','suggested','apply_requested'].includes(r.status));
  useEffect(() => {
    const text = provider.document.getText('plan');
    function marks(length:number):DecorationSet {
      const ranges:{from:number;to:number}[]=[];
      for(const request of latest.current.filter(r=>r.status==='suggested'))for(const edit of request.edits??[]) {
        try {
          const start=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(edit.start)),provider.document);
          const end=Y.createAbsolutePositionFromRelativePosition(Y.decodeRelativePosition(Uint8Array.from(edit.end)),provider.document);
          if(start?.type===text&&end?.type===text&&end.index>start.index&&end.index<=length&&text.toString().slice(start.index,end.index)===edit.before)ranges.push({from:start.index,to:end.index});
        } catch { /* Stale proposals remain reviewable in the activity card. */ }
      }
      return Decoration.set(ranges.sort((a,b)=>a.from-b.from).map(r=>Decoration.mark({class:'cm-agent-passage',attributes:{title:'Codex suggested a change to this passage'}}).range(r.from,r.to)),true);
    }
    const view = new EditorView({ parent: host.current!, state: EditorState.create({
      doc: text.toString(), extensions: [markdown(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({'aria-label':'Edit shared plan','spellcheck':'true'}),
        syntaxHighlighting(HighlightStyle.define([{tag:tags.heading1,fontSize:'1.8em',fontWeight:'600'},
          {tag:tags.heading2,fontSize:'1.4em',fontWeight:'600'},{tag:tags.heading3,fontSize:'1.15em',fontWeight:'600'},
          {tag:tags.strong,fontWeight:'bold'},{tag:tags.emphasis,fontStyle:'italic'},
          {tag:tags.monospace,fontFamily:'monospace'},{tag:tags.processingInstruction,color:'var(--muted-foreground)'}])),
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
        yCollab(text, provider.awareness),
        ViewPlugin.fromClass(class {decorations=marks(text.length);update(update:{state:EditorState}){this.decorations=marks(update.state.doc.length);}},{decorations:value=>value.decorations}),
        EditorView.theme({'&':{backgroundColor:'transparent',color:'var(--foreground)'}, '.cm-content':{padding:'26px',minHeight:'450px',fontFamily:'inherit',fontSize:'14px',lineHeight:'1.9'},'&.cm-focused':{outline:'none'},'.cm-cursor':{borderLeftColor:'var(--foreground)'},'.cm-ySelectionInfo':{fontFamily:'inherit',fontSize:'10px'}}),
      ],
    })});
    editor.current=view;
    return () => {editor.current=null;provider.awareness.setLocalStateField('cursor',null);view.destroy();};
  }, [provider]);
  useEffect(()=>{editor.current?.dispatch({});},[requests]);
  function format(prefix:string,suffix='',line=false) {
    const view=editor.current;if(!view)return;
    const selection=view.state.selection.main;
    const from=line?view.state.doc.lineAt(selection.from).from:selection.from;
    const value=view.state.sliceDoc(from,selection.to)||(!line?'text':'');
    view.dispatch({changes:{from,to:selection.to,insert:prefix+value+suffix},selection:{anchor:from+prefix.length,head:from+prefix.length+value.length}});
    view.focus();
  }
  return <div className="collaborative-plan">
    <div className="document-tools" role="toolbar" aria-label="Plan formatting">
      <button type="button" aria-label="Bold" onClick={()=>format('**','**')}><b>B</b></button>
      <button type="button" aria-label="Italic" onClick={()=>format('*','*')}><i>I</i></button>
      <button type="button" aria-label="Heading" onClick={()=>format('## ','',true)}>Heading</button>
      <button type="button" aria-label="Bullet list" onClick={()=>format('- ','',true)}>List</button>
      <button type="button" aria-label="Checklist" onClick={()=>format('- [ ] ','',true)}>Checklist</button>
      <span className="hint">Markdown · changes save live</span>
    </div>
    {!!active.length&&<div className="agent-document-status" role="status"><Sparkles size={12}/>{active.some(r=>r.status==='running')?'Codex is working from the shared plan':active.some(r=>r.status==='apply_requested')?'Codex changes are being applied':'Codex suggestions are underlined · review in the conversation'}</div>}
    <div ref={host}/>
  </div>;
}
