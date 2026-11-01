import { ArrowRight, MessageSquare } from 'lucide-react';
import { Markdown } from '@/components/markdown';
import { Button } from '@/components/ui/button';
import type { SavedInterviewAnswer } from '@/lib/interview';

export function InterviewHistory({ history, loading, canContinue, onContinue }: {
  history: SavedInterviewAnswer[]; loading: boolean; canContinue: boolean; onContinue: () => void;
}) {
  return <section id="interview-history" className="interview-history" aria-labelledby="interview-history-title">
    <header className="interview-history-heading"><div><h2 id="interview-history-title"><MessageSquare size={15}/> User interview history</h2><p>{history.length ? `${history.length} answer${history.length === 1 ? '' : 's'} · kept with this plan as the interview continues` : loading ? 'Loading interview history…' : 'Questions and answers from Grill me will collect here.'}</p></div>
      {canContinue && <Button variant="ghost" size="sm" onClick={onContinue}>{history.length ? 'Continue interview' : 'Grill me'}<ArrowRight size={12}/></Button>}
    </header>
    {history.length > 0 && <ol className="interview-transcript">{history.map((entry, index) => <li key={entry.id}>
      <div className="interview-turn-meta"><span>{String(index + 1).padStart(2, '0')}</span><span>{entry.authorName}</span><time dateTime={entry.createdAt?.toDate().toISOString()}>{entry.createdAt?.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? 'Saving…'}</time></div>
      <h3>{entry.title}</h3><p className="interview-saved-question">{entry.question}</p><div className="markdown-content interview-answer"><Markdown compact>{entry.answer}</Markdown></div>
    </li>)}</ol>}
  </section>;
}
