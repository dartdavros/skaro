import { describe, expect, it } from 'vitest';
import { diffExcerpt, diffStats, lineDiff } from './diff.ts';
import { feedRows, withoutSkaroNote, withSkaroNote } from './feed.ts';
import { emptyTimeline } from './state.ts';
import { compareText } from './diff.ts';
import { readFile } from 'node:fs/promises';

describe('lineDiff', () => {
  it('compares distant edits in the real C4 documentation without replacing the middle', async () => {
    const text = await readFile(new URL('../../../docs/c4.md', import.meta.url), 'utf8');
    const before = Array.from({ length: 20 }, () => text).join('\n');
    const lines = before.split('\n');
    lines[1] += ' ';
    lines[lines.length - 2] += ' ';
    const after = lines.join('\n');
    expect(diffStats(lineDiff(before, after))).toEqual({ added: 2, removed: 2 });
    expect(compareText(before, after)).toMatchObject({ status: 'exact', added: 2, removed: 2 });
  });
  it('keeps common lines and marks added and removed ones', () => {
    const lines = lineDiff('# A\n## Каталог\nold\n', '# A\n## Платежи\nnew\n## Каталог\n');
    expect(lines).toEqual([
      { op: ' ', text: '# A' },
      { op: '+', text: '## Платежи' },
      { op: '+', text: 'new' },
      { op: ' ', text: '## Каталог' },
      { op: '-', text: 'old' },
    ]);
    expect(diffStats(lines)).toEqual({ added: 2, removed: 1 });
  });

  it('treats a new document as all added', () => {
    expect(diffStats(lineDiff('', 'a\nb'))).toEqual({ added: 2, removed: 0 });
  });

  it('shows changes with context and gaps between them', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
    const after = ['a', 'B', 'c', 'd', 'e', 'f', 'G'].join('\n');
    const excerpt = diffExcerpt(lineDiff(before, after), 1);
    expect(excerpt.map((l) => ('gap' in l && l.gap ? '…' : `${l.op}${l.text}`))).toEqual([
      ' a',
      '-b',
      '+B',
      ' c',
      '…',
      ' f',
      '-g',
      '+G',
    ]);
  });
});

describe('Skaro note', () => {
  it('is hidden from the user message in the feed', () => {
    const state = emptyTimeline();
    state.items.push({
      id: 'u1',
      turnId: 't1',
      kind: 'message',
      role: 'user',
      text: withSkaroNote('ADR-0007 accepted.', 'Дальше делаем платежи'),
      status: 'done',
      startedAt: 0,
      native: { agent: 'claude-code', type: 'user', ref: 'u1' },
    });
    const [row] = feedRows(state);
    expect(row?.type === 'user' && row.item.text).toBe('Дальше делаем платежи');
    expect(withoutSkaroNote('plain')).toBe('plain');
    expect(withSkaroNote('  ', 'plain')).toBe('plain');
  });
});
