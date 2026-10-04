// Sections of a task file body (architecture.md 3.2): Цель, Критерии приёмки, Заметки, Итог.

export interface TaskSections {
  goal?: string;
  criteria: { text: string; done: boolean }[];
  notes?: string;
  summary?: string;
}

const HEADINGS: Record<string, keyof TaskSections> = {
  цель: 'goal',
  goal: 'goal',
  'критерии приёмки': 'criteria',
  'критерии приемки': 'criteria',
  'acceptance criteria': 'criteria',
  // The readiness criterion of a milestone: what the acceptance of a stage ticks.
  'критерий готовности': 'criteria',
  'done when': 'criteria',
  'definition of done': 'criteria',
  заметки: 'notes',
  notes: 'notes',
  итог: 'summary',
  summary: 'summary',
};

const CRITERION = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/;

export function taskSections(body: string): TaskSections {
  const sections: TaskSections = { criteria: [] };
  const text: Partial<Record<'goal' | 'notes' | 'summary', string[]>> = {};
  let current: keyof TaskSections | undefined;
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = HEADINGS[heading[1]!.toLowerCase()];
      continue;
    }
    if (!current) continue;
    if (current === 'criteria') {
      const item = CRITERION.exec(line);
      if (item && item[2]!.trim()) {
        sections.criteria.push({ text: item[2]!.trim(), done: item[1] === 'x' || item[1] === 'X' });
      }
    } else {
      (text[current] ??= []).push(line);
    }
  }
  for (const key of ['goal', 'notes', 'summary'] as const) {
    const value = text[key]?.join('\n').trim();
    if (value) sections[key] = value;
  }
  return sections;
}

/** Ticks or unticks the n-th acceptance criterion; the other text stays as it is. */
export function toggleCriterion(body: string, index: number): string {
  const lines = body.split('\n');
  let inCriteria = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^##\s+(.+?)\s*$/.exec(line.replace(/\r$/, ''));
    if (heading) {
      inCriteria = HEADINGS[heading[1]!.toLowerCase()] === 'criteria';
      continue;
    }
    if (!inCriteria) continue;
    const item = CRITERION.exec(line);
    if (!item || !item[2]!.trim()) continue;
    if (n++ !== index) continue;
    const done = item[1] === 'x' || item[1] === 'X';
    lines[i] = item[1]
      ? line.replace(/\[[ xX]\]/, done ? '[ ]' : '[x]')
      : line.replace(/^(\s*[-*]\s+)/, '$1[x] ');
    return lines.join('\n');
  }
  return body;
}

/**
 * Sets every acceptance criterion to the given state (`submit_result`); criteria without a state
 * keep theirs, the other text stays as it is.
 */
export function setCriteria(body: string, done: (boolean | undefined)[]): string {
  const lines = body.split('\n');
  let inCriteria = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^##\s+(.+?)\s*$/.exec(line.replace(/\r$/, ''));
    if (heading) {
      inCriteria = HEADINGS[heading[1]!.toLowerCase()] === 'criteria';
      continue;
    }
    if (!inCriteria) continue;
    const item = CRITERION.exec(line);
    if (!item || !item[2]!.trim()) continue;
    const want = done[n++];
    if (want === undefined) continue;
    const mark = want ? '[x]' : '[ ]';
    lines[i] = item[1]
      ? line.replace(/\[[ xX]\]/, mark)
      : line.replace(/^(\s*[-*]\s+)/, `$1${mark} `);
  }
  return lines.join('\n');
}

type HeadingKey =
  'goal' | 'criteria' | 'notes' | 'summary' | 'done' | 'context' | 'decision' | 'consequences';

/** Section headings Skaro writes, by the user's language (the parser reads both). */
const HEADINGS_BY_LOCALE: Record<string, Record<HeadingKey, string>> = {
  ru: {
    goal: 'Цель',
    criteria: 'Критерии приёмки',
    notes: 'Заметки',
    summary: 'Итог',
    done: 'Критерий готовности',
    context: 'Контекст',
    decision: 'Решение',
    consequences: 'Последствия',
  },
  en: {
    goal: 'Goal',
    criteria: 'Acceptance criteria',
    notes: 'Notes',
    summary: 'Summary',
    done: 'Done when',
    context: 'Context',
    decision: 'Decision',
    consequences: 'Consequences',
  },
};

export function headings(locale: string): Record<HeadingKey, string> {
  return HEADINGS_BY_LOCALE[locale] ?? HEADINGS_BY_LOCALE['en']!;
}

function criteriaText(criteria: string[]): string {
  return criteria.map((c) => `- [ ] ${c}`).join('\n');
}

/** Body of a new task: goal, acceptance criteria, notes. */
export function taskBody(
  task: { goal: string; criteria: string[]; notes?: string },
  locale: string,
): string {
  const h = headings(locale);
  const parts = [
    `## ${h.goal}\n\n${task.goal.trim()}`,
    `## ${h.criteria}\n\n${criteriaText(task.criteria)}`,
    task.notes?.trim() ? `## ${h.notes}\n\n${task.notes.trim()}` : '',
  ];
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

/** Replaces goal, criteria or notes of an existing body; other sections stay as they are. */
export function withSections(
  body: string,
  patch: { goal?: string; criteria?: string[]; notes?: string },
  locale: string,
): string {
  const h = headings(locale);
  let next = body;
  if (patch.goal !== undefined) next = withSection(next, 'goal', h.goal, patch.goal);
  if (patch.criteria !== undefined)
    next = withSection(next, 'criteria', h.criteria, criteriaText(patch.criteria));
  if (patch.notes !== undefined) next = withSection(next, 'notes', h.notes, patch.notes);
  return next;
}

/** Writes the "Итог" section (after the merge), replacing an existing one. */
export function withSummary(body: string, summary: string): string {
  return withSection(body, 'summary', 'Итог', summary);
}

/** Replaces the content of a section, or adds the section at the end. */
function withSection(
  body: string,
  key: keyof TaskSections,
  heading: string,
  content: string,
): string {
  const lines = body.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex((l) => {
    const h = /^##\s+(.+?)\s*$/.exec(l.replace(/\r$/, ''));
    return h !== null && HEADINGS[h[1]!.toLowerCase()] === key;
  });
  if (start === -1) {
    const head = lines.join('\n').trim();
    return `${head ? `${head}\n\n` : ''}## ${heading}\n\n${content.trim()}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end]!)) end++;
  return [...lines.slice(0, start + 1), '', content.trim(), '', ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n');
}
