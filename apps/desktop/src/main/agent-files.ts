// The Skaro block in AGENTS.md and CLAUDE.md (architecture.md 3): links to the brief, the
// architecture and the ADRs between markers; the rest of the files is never touched.

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const BEGIN = '<!-- skaro:begin -->';
const END = '<!-- skaro:end -->';
const FILES = ['AGENTS.md', 'CLAUDE.md'];

const TEXT: Record<string, string> = {
  ru: [
    '## Skaro',
    '',
    'Контекст проекта ведёт Skaro:',
    '- бриф — `.skaro/brief.md`;',
    '- архитектура и правила для агентов — `.skaro/architecture.md`;',
    '- принятые решения — `.skaro/adr/`.',
  ].join('\n'),
  en: [
    '## Skaro',
    '',
    'Skaro keeps the project context:',
    '- the brief — `.skaro/brief.md`;',
    '- the architecture and rules for agents — `.skaro/architecture.md`;',
    '- decisions — `.skaro/adr/`.',
  ].join('\n'),
};

/** Text of a file with the block put in (or replaced), or taken out. */
export function withBlock(content: string, block: string | undefined): string {
  const start = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  const rest =
    start >= 0 && end > start
      ? (content.slice(0, start) + content.slice(end + END.length)).replace(/\n{3,}/g, '\n\n')
      : content;
  if (!block) return rest.trim() ? `${rest.trim()}\n` : '';
  const head = rest.trim();
  return `${head ? `${head}\n\n` : ''}${BEGIN}\n${block}\n${END}\n`;
}

/** Puts the block into AGENTS.md and CLAUDE.md, or takes it out (files left empty go away). */
export async function syncAgentFiles(root: string, on: boolean, locale: string): Promise<void> {
  const block = on ? (TEXT[locale] ?? TEXT['en']!) : undefined;
  for (const name of FILES) {
    const path = join(root, name);
    const content = await readFile(path, 'utf8').catch(() => undefined);
    if (content === undefined && !on) continue;
    const next = withBlock(content ?? '', block);
    if (next === content) continue;
    if (!next) await rm(path, { force: true });
    else await writeFile(path, next);
  }
}
