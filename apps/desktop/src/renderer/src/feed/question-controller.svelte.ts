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

  const questions = $derived(getInteraction().questions);
  const q = $derived(questions[Math.min(step, questions.length - 1)]!);

  function answerOf(id: string): string[] {
    const question = questions.find((x) => x.id === id);
    const values = [...(picked[id] ?? [])];
    const own = custom[id]?.trim();
    if (own && (customOn[id] || !question?.options.length)) values.push(own);
    return values;
  }

  const ready = $derived(questions.every((x) => answerOf(x.id).length > 0));

  function choose(label: string): void {
    const current = picked[q.id] ?? [];
    if (q.multi) {
      picked[q.id] = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
    } else {
      picked[q.id] = [label];
      customOn[q.id] = false;
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
      step = value;
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
    choose,
    toggleCustom,
    customInput,
    send,
  };
}

export type QuestionController = ReturnType<typeof createQuestionController>;
