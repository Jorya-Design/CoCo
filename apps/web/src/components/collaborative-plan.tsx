import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import type { FirestoreDocument } from '@/lib/collaboration';

export function CollaborativePlan({ provider }: { provider: FirestoreDocument }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const text = provider.document.getText('plan');
    const view = new EditorView({ parent: host.current!, state: EditorState.create({
      doc: text.toString(), extensions: [markdown(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({'aria-label':'Edit shared plan'}),
        keymap.of([...yUndoManagerKeymap, ...defaultKeymap]),
        yCollab(text, provider.awareness),
        EditorView.theme({'&':{backgroundColor:'transparent',color:'var(--foreground)'}, '.cm-content':{padding:'26px',minHeight:'450px',fontFamily:'inherit',fontSize:'14px',lineHeight:'1.9'},'&.cm-focused':{outline:'none'},'.cm-cursor':{borderLeftColor:'var(--foreground)'},'.cm-ySelectionInfo':{fontFamily:'inherit',fontSize:'10px'}}),
      ],
    })});
    return () => { provider.awareness.setLocalStateField('cursor',null); view.destroy(); };
  }, [provider]);
  return <div ref={host} className="collaborative-plan"/>;
}
