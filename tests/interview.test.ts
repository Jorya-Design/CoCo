import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInterviewPrompt, nextInterviewIndex, planWithInterview, type InterviewAnswer } from '../shared/interview.ts';

const answer = (index: number): InterviewAnswer => {
  const prompt = getInterviewPrompt(index);
  return { id: String(index), questionIndex: index, title: prompt.title, question: prompt.question, answer: `Concrete answer ${index}`, authorUid: 'member', authorName: 'Teammate' };
};

test('the interview continues past the four foundations and revisits saved answers', () => {
  const history: InterviewAnswer[] = [];
  for (let index = 0; index < 30; index++) {
    const prompt = getInterviewPrompt(nextInterviewIndex(history), history);
    assert.equal(prompt.index, index);
    assert.ok(prompt.question.length > 0);
    if (index === 4) assert.match(prompt.title, /journey/i);
    if (index === 12) assert.match(prompt.question, /Concrete answer 0/);
    if (index === 24) assert.match(prompt.question, /Concrete answer 12/);
    history.push({ ...answer(index), title: prompt.title, question: prompt.question });
  }
  assert.equal(nextInterviewIndex(history), 30);
});

test('concurrent answers are kept without skipping a question on resume', () => {
  const history = [answer(0), { ...answer(0), id: 'another-member', authorUid: 'other' }];
  assert.equal(nextInterviewIndex(history), 1);
  assert.equal(nextInterviewIndex([answer(4), ...history, answer(2)]), 5);
});

test('approved Markdown includes the complete transcript without rewriting the plan', () => {
  const plan = '# A plan\n\n- Keep the body\n';
  assert.equal(planWithInterview(plan, []), plan);
  const history = [answer(0), answer(1)];
  const snapshot = planWithInterview(plan, history);
  assert.ok(snapshot.startsWith(plan.trimEnd()));
  assert.match(snapshot, /## User interview history/);
  for (const entry of history) assert.ok(snapshot.includes(entry.answer));
  assert.equal((snapshot.match(/## User interview history/g) ?? []).length, 1);
  assert.equal(planWithInterview(plan, history), snapshot);
  assert.equal(history.length, 2);
});
