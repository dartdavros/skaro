import { diffArrays, structuredPatch, formatPatch } from 'diff';

export interface DiffLine {
  op: '+' | '-' | ' ';
  text: string;
}

export type TextComparison =
  { status: 'exact'; added: number; removed: number; patch: string } | { status: 'unavailable' };

/** A resource limit is an unavailable comparison, never a fabricated replacement. */
export function compareText(before: string, after: string): TextComparison {
  const patch = structuredPatch('before', 'after', before, after, undefined, undefined, {
    context: 3,
    timeout: 2000,
  });
  if (!patch) return { status: 'unavailable' };
  let added = 0,
    removed = 0;
  for (const hunk of patch.hunks)
    for (const line of hunk.lines) {
      if (line.startsWith('+')) added++;
      if (line.startsWith('-')) removed++;
    }
  return { status: 'exact', added, removed, patch: formatPatch(patch) };
}

/** Lines of `after` against `before`: kept, removed and added, in order. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const changes = diffArrays(splitLines(before), splitLines(after), { timeout: 2000 });
  if (!changes) throw new Error('Text comparison exceeded its resource budget');
  return changes.flatMap((change) =>
    change.value.map((text): DiffLine => ({
      op: change.added ? '+' : change.removed ? '-' : ' ',
      text,
    })),
  );
}

export function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.op === '+') added++;
    else if (line.op === '-') removed++;
  }
  return { added, removed };
}

/** A presentation budget bounds both lines and characters; full source stays in the viewer. */
export function diffPreview(before: string, after: string) {
  try {
    const lines = lineDiff(before, after);
    const excerpt = diffExcerpt(lines, 1).filter((l) => !('text' in l) || l.text.trim() !== '');
    let remaining = 1800;
    let truncated = false;
    const shown = excerpt.slice(0, 12).map((l) => {
      if (!('text' in l)) return { gap: true, op: ' ' as const, text: '' };
      const text = l.text.slice(0, Math.min(240, remaining));
      remaining -= text.length;
      truncated ||= text.length !== l.text.length;
      return { gap: false, op: l.op, text: text + (text.length < l.text.length ? '…' : '') };
    });
    return {
      stats: diffStats(lines),
      lines: shown,
      more: truncated || excerpt.length > 12,
      unavailable: false,
    };
  } catch {
    return { stats: undefined, lines: [], more: false, unavailable: true };
  }
}

/**
 * Changed lines with `context` unchanged lines around them; `gap` marks skipped unchanged lines
 * between the shown parts.
 */
export function diffExcerpt(
  lines: DiffLine[],
  context = 1,
): ({ gap: true } | (DiffLine & { gap?: false }))[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((line, i) => {
    if (line.op === ' ') return;
    for (let j = Math.max(0, i - context); j <= Math.min(lines.length - 1, i + context); j++) {
      keep[j] = true;
    }
  });
  const out: ({ gap: true } | (DiffLine & { gap?: false }))[] = [];
  let skipped = false;
  lines.forEach((line, i) => {
    if (keep[i]) {
      if (skipped && out.length) out.push({ gap: true });
      skipped = false;
      out.push(line);
    } else {
      skipped = true;
    }
  });
  return out;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}
