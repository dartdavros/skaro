// Line diff for proposal cards (a document or a task before and after). Pure, no dependencies.

export interface DiffLine {
  op: '+' | '-' | ' ';
  text: string;
}

/** Above this many cells the middle part is shown as removed and added whole. */
const MAX_CELLS = 4_000_000;

/** Lines of `after` against `before`: kept, removed and added, in order. */
export function lineDiff(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head = a.slice(0, start).map((text): DiffLine => ({ op: ' ', text }));
  const tail = a.slice(endA).map((text): DiffLine => ({ op: ' ', text }));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  return [...head, ...middle(midA, midB), ...tail];
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

/** Longest common subsequence of the lines that differ. */
function middle(a: string[], b: string[]): DiffLine[] {
  if (!a.length) return b.map((text) => ({ op: '+', text }));
  if (!b.length) return a.map((text) => ({ op: '-', text }));
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text): DiffLine => ({ op: '-', text })),
      ...b.map((text): DiffLine => ({ op: '+', text })),
    ];
  }
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = LCS length of a[i..] and b[j..], stored row by row.
  const lcs = new Uint32Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * (m + 1) + j + 1]! + 1
          : Math.max(lcs[(i + 1) * (m + 1) + j]!, lcs[i * (m + 1) + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * (m + 1) + j]! >= lcs[i * (m + 1) + j + 1]!) {
      out.push({ op: '-', text: a[i]! });
      i++;
    } else {
      out.push({ op: '+', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ op: '-', text: a[i++]! });
  while (j < m) out.push({ op: '+', text: b[j++]! });
  return out;
}
