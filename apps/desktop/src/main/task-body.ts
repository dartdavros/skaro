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

/** Writes the "Итог" section (after the merge), replacing an existing one. */
export function withSummary(body: string, summary: string): string {
  const lines = body.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex((l) => {
    const h = /^##\s+(.+?)\s*$/.exec(l.replace(/\r$/, ''));
    return h !== null && HEADINGS[h[1]!.toLowerCase()] === 'summary';
  });
  if (start === -1) return `${lines.join('\n')}\n\n## Итог\n\n${summary.trim()}\n`;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end]!)) end++;
  return [...lines.slice(0, start + 1), '', summary.trim(), '', ...lines.slice(end)]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*$/, '\n');
}
