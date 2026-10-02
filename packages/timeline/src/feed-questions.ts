import { asyncQuestionInput, isAsyncQuestion } from './async-question.ts';
import type { Item } from './model.ts';

/** A card answer resumes Codex through a user message; the decision row already shows it. */
export function questionHistory(items: Item[]): {
  items: Item[];
  cardAnswers: Map<string, string>;
} {
  const decisions = items.filter(
    (item) => item.kind === 'decision' && isAsyncQuestion(item.interaction),
  );
  const cardAnswers = new Map<string, string>();
  for (const item of decisions) {
    if (item.kind !== 'decision' || !isAsyncQuestion(item.interaction)) continue;
    if (item.answer.kind !== 'question') continue;
    const input = asyncQuestionInput(item.interaction, item.answer).text;
    // Also recognize answers sent by the previous build, which prefixed the agent's question.
    const legacy = item.interaction.questions
      .map(
        (q) =>
          `${q.text}\n${(item.answer.kind === 'question' ? item.answer.answers[q.id] : [])?.join('\n')}`,
      )
      .join('\n\n');
    const replies = items.filter(
      (candidate) =>
        candidate.kind === 'message' &&
        candidate.role === 'user' &&
        !candidate.parentId &&
        !cardAnswers.has(candidate.id) &&
        Math.abs(candidate.startedAt - item.startedAt) < 10_000 &&
        (candidate.text === input || candidate.text === legacy),
    );
    const reply = replies.sort(
      (a, b) => Math.abs(a.startedAt - item.startedAt) - Math.abs(b.startedAt - item.startedAt),
    )[0];
    if (reply) cardAnswers.set(reply.id, input ?? '');
  }
  const history = items.map((item) => {
    // Old logs recorded the answer against a completed turn, moving its end banner forward.
    return item.kind === 'decision' && isAsyncQuestion(item.interaction)
      ? { ...item, turnId: '' }
      : item;
  });
  return { items: history, cardAnswers };
}
