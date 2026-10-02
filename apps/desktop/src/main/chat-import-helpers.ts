import { type ProjectArtifacts } from '@skaro/core';
import { type Manifest, type StagedArtifact } from './imports';
import { milestoneSections } from './plan';
import { taskSections } from './task-body';
import { adrId } from './chat-proposal-helpers';

export function importKey(chatId: string): string {
  return `import.${chatId}`;
}

export interface ImportWords {
  title: string;
  brief: string;
  architecture: string;
  files: (n: number) => string;
  text: (format: string) => string;
  table: (format: string) => string;
  skipped: (reason: string) => string;
}

export const IMPORT_RU: ImportWords = {
  title: 'Импортировать документацию',
  brief: 'Бриф',
  architecture: 'Архитектура',
  files: (n) => {
    const d = n % 10;
    const h = n % 100;
    const word =
      d === 1 && h !== 11 ? 'файл' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'файла' : 'файлов';
    return `${n} ${word}`;
  },
  text: (f) => `${f} → текст`,
  table: (f) => `${f} → таблица`,
  skipped: (r) => `пропущен · ${r}`,
};

export const IMPORT_EN: ImportWords = {
  title: 'Import documentation',
  brief: 'Brief',
  architecture: 'Architecture',
  files: (n) => `${n} ${n === 1 ? 'file' : 'files'}`,
  text: (f) => `${f} → text`,
  table: (f) => `${f} → table`,
  skipped: (r) => `skipped · ${r}`,
};

export function prepFiles(
  manifest: Manifest,
  words: ImportWords,
): { path: string; note: string; skipped: boolean }[] {
  const inSource = (source: string) => {
    const root = manifest.sources.find(
      (s) => source === s.display || source.startsWith(`${s.display}/`),
    );
    if (!root || source === root.display) return source.split('/').pop() ?? source;
    return source.slice(root.display.length + 1);
  };
  return manifest.files.map((f) => ({
    path: inSource(f.source),
    skipped: f.action === 'skipped',
    note:
      f.action === 'skipped'
        ? words.skipped(f.reason ?? '')
        : f.action === 'converted'
          ? ['xlsx', 'csv', 'tsv'].includes(f.format)
            ? words.table(f.format)
            : words.text(f.format)
          : f.format,
  }));
}

export function fieldsOf(s: StagedArtifact): {
  goal?: string;
  doneWhen?: string;
  criteria?: string[];
} {
  if (s.type === 'milestone') {
    const m = milestoneSections(s.body);
    return {
      ...(m.goal ? { goal: m.goal } : {}),
      ...(m.criteria ? { doneWhen: m.criteria } : {}),
    };
  }
  const t = taskSections(s.body);
  return {
    ...(t.goal ? { goal: t.goal } : {}),
    criteria: t.criteria.map((c) => c.text),
  };
}

export function importLinks(staged: StagedArtifact[], artifacts: ProjectArtifacts): string[] {
  const keys = new Map(staged.map((s) => [s.key, s.type]));
  const problems: string[] = [];
  for (const s of staged.filter((x) => x.type === 'task')) {
    if (
      s.milestone &&
      keys.get(s.milestone) !== 'milestone' &&
      !artifacts.milestones.some((m) => m.id === s.milestone!.toUpperCase())
    ) {
      problems.push(
        `${s.key}: milestone ${s.milestone} is neither a staged milestone nor an existing one.`,
      );
    }
    if (
      s.spec &&
      keys.get(s.spec) !== 'spec' &&
      !artifacts.specs.some((x) => x.id === adrId(s.spec!))
    ) {
      problems.push(
        `${s.key}: spec ${s.spec} is neither a staged specification nor an existing one.`,
      );
    }
    for (const dep of s.dependsOn ?? []) {
      if (keys.get(dep) !== 'task' && !artifacts.tasks.some((t) => t.id === dep.toUpperCase())) {
        problems.push(`${s.key}: depends_on ${dep} is neither a staged task nor an existing one.`);
      }
    }
  }
  return problems;
}
