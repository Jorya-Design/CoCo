import { interviewQuestions } from './plan.ts';

export interface InterviewPrompt { index: number; title: string; question: string; placeholder: string }
export interface InterviewAnswer {
  id: string; questionIndex: number; title: string; question: string; answer: string;
  authorUid: string; authorName: string;
}

const followUps = [
  { title: 'Walk through the main journey', question: 'Walk through one real user session, from arriving to getting a useful result. What should happen at each step?', placeholder: 'The user arrives, then…' },
  { title: 'What could go wrong?', question: 'Pick the most likely failure in that journey. What should the user see, and how should they recover without losing their work?', placeholder: 'If something fails, the user should…' },
  { title: 'What data needs to survive?', question: 'What information must be saved, who can access or change it, and what needs a history or an undo path?', placeholder: 'We need to save…' },
  { title: 'Where are the boundaries?', question: 'Which systems does this need to connect to? Define what each connection receives, returns, and does when it is unavailable.', placeholder: 'The first integration needs…' },
  { title: 'Which trade-off matters most?', question: 'If scope, reliability, speed, and polish compete, which should win for this version? Give a concrete example of something we should defer.', placeholder: 'We should prioritize…' },
  { title: 'How will we test the edge cases?', question: 'Give three specific acceptance examples: a normal case, a boundary case, and a failure. What observable result should each produce?', placeholder: 'Given… when… then…' },
  { title: 'How should this feel to use?', question: 'Describe the loading, empty, error, and success states. What must work on mobile and with a keyboard?', placeholder: 'When the screen is empty…' },
  { title: 'What happens after the first release?', question: 'How will we introduce this to the first users, collect feedback, and decide what to change next?', placeholder: 'The first users will…' },
];
const prompts = [...interviewQuestions, ...followUps];

export function nextInterviewIndex(history: Pick<InterviewAnswer, 'questionIndex'>[]) {
  // Concurrent replies to one question are both kept, without skipping the next.
  return history.reduce((next, entry) => Math.max(next, entry.questionIndex + 1), 0);
}

export function getInterviewPrompt(index: number, history: InterviewAnswer[] = []): InterviewPrompt {
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Invalid interview question index.');
  if (index < prompts.length) return { ...prompts[index], index };
  const topic = (index - prompts.length) % prompts.length;
  const earlier = [...history].reverse().find(entry => entry.questionIndex === topic
    || (entry.questionIndex >= prompts.length && (entry.questionIndex - prompts.length) % prompts.length === topic));
  const previous = earlier?.answer.replace(/\s+/g, ' ');
  const excerpt = previous?.slice(0, 180);
  const round = Math.floor((index - prompts.length) / prompts.length) + 1;
  return {
    index,
    title: `Refine: ${prompts[topic].title}`,
    question: excerpt
      ? `Earlier in this interview, the answer was: “${excerpt}${previous!.length > 180 ? '…' : ''}” What should we add, correct, or make more concrete? Include a scenario that would challenge this answer.`
      : `${prompts[topic].question} Revisit this with the latest plan in mind and add a detail or example we have not covered.`,
    placeholder: `Refinement ${round}: add an example, correction, or decision…`,
  };
}

const escapeInline = (value: string) => value.replace(/[\\`*_\[\]<>#]/g, '\\$&').replace(/\s+/g, ' ');

/** Deterministic snapshot text: the growing transcript participates in approvals. */
export function planWithInterview(plan: string, history: InterviewAnswer[]) {
  if (!history.length) return plan;
  return plan.trimEnd() + '\n\n---\n\n## User interview history\n\n' + history.map((entry, index) =>
    `### ${index + 1}. ${escapeInline(entry.title)}\n\n${escapeInline(entry.question)}\n\nAnswered by **${escapeInline(entry.authorName)}**\n\n${entry.answer.trim()}\n`,
  ).join('\n');
}
