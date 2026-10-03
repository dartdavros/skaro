import type { Interaction } from '@skaro/timeline';
import { useFeed } from './context.svelte';

export function createQuestionController(
  getInteraction: () => Extract<Interaction, { kind: 'question' }>,
) {
  const feed = useFeed();
  let step = $state(0);
  const picked = $state<Record<string, string[]>>({});
  const custom = $state<Record<string, string>>({});
  const customOn = $state<Record<string, boolean>>({});
  let reveal = $state(false);
  let sending = $state(false);
  let advance: ReturnType<typeof setTimeout> | undefined;

  $effect(() => () => clearTimeout(advance));

  const questions = $derived(getInteraction().questions);
  const q = $derived(questions[Math.min(step, questions.length - 1)]!);

  function answerOf(id: string): string[] {
    const question = questions.find((x) => x.id === id);
    const values = [...(picked[id] ?? [])];
    const own = custom[id]?.trim();
    if (own && (customOn[id] || !question?.options.length)) values.push(own);
    return values;
  }

  const answered = (id: string): boolean => answerOf(id).length > 0;
  const ready = $derived(questions.every((x) => answered(x.id)));

  /** Shows another question; a pending move to the next one is dropped. */
  function goTo(index: number): void {
    clearTimeout(advance);
    step = Math.max(0, Math.min(index, questions.length - 1));
  }

  /**
   * After a choice the card moves on to the next unanswered question (as in Claude Code), after
   * a short pause that shows the choice. Nothing moves when all questions are answered.
   */
  function moveOn(): void {
    const from = step;
    const next = [...questions.keys()]
      .map((i) => (from + 1 + i) % questions.length)
      .find((i) => i !== from && !answered(questions[i]!.id));
    if (next === undefined) return;
    clearTimeout(advance);
    advance = setTimeout(() => {
      if (step === from) step = next;
    }, 260);
  }

  function choose(label: string): void {
    const current = picked[q.id] ?? [];
    if (q.multi) {
      picked[q.id] = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
    } else {
      picked[q.id] = [label];
      customOn[q.id] = false;
      moveOn();
    }
  }

  function toggleCustom(): void {
    if (q.multi) customOn[q.id] = !customOn[q.id];
    else {
      customOn[q.id] = true;
      picked[q.id] = [];
    }
  }

  function customInput(): void {
    const has = (custom[q.id] ?? '').trim().length > 0;
    if (has && !customOn[q.id]) {
      customOn[q.id] = true;
      if (!q.multi) picked[q.id] = [];
    }
  }

  async function send(): Promise<void> {
    if (!ready || sending) return;
    sending = true;
    try {
      await feed.respond(getInteraction().id, {
        kind: 'question',
        answers: Object.fromEntries(questions.map((x) => [x.id, answerOf(x.id)])),
      });
    } finally {
      sending = false;
    }
  }

  const preview = $derived(
    q.options.find((o) => (picked[q.id] ?? []).includes(o.label))?.preview ??
      q.options.find((o) => o.preview)?.preview,
  );

  return {
    get step() {
      return step;
    },
    set step(value: typeof step) {
      goTo(value);
    },
    get picked() {
      return picked;
    },
    get custom() {
      return custom;
    },
    get customOn() {
      return customOn;
    },
    get reveal() {
      return reveal;
    },
    set reveal(value: typeof reveal) {
      reveal = value;
    },
    get sending() {
      return sending;
    },
    get questions() {
      return questions;
    },
    get q() {
      return q;
    },
    get ready() {
      return ready;
    },
    get preview() {
      return preview;
    },
    answered,
    choose,
    toggleCustom,
    customInput,
    send,
  };
}

export type QuestionController = ReturnType<typeof createQuestionController>;
