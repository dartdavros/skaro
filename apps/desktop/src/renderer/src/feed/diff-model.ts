import type { FileChange, FileRow } from '@skaro/timeline';

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'sep';
  sign: string;
  text: string;
}

/** A diff line with its numbers in the old and the new file (the diff window). */
export interface NumberedLine extends DiffLine {
  old?: number;
  new?: number;
}

const HEADER =
  /^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode|\\ No newline)/;
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Lines of the diffs of one file, in order, separated by `sep`. Without numbers for the feed;
 * `numbered` counts old and new line numbers from the `@@ -a,b +c,d @@` headers. A diff that is
 * not unified is the file's content: all added for a new file, context otherwise.
 */
function parseDiffs(
  diffs: string[],
  change: FileChange['change'],
  numbered: boolean,
): NumberedLine[] {
  const out: NumberedLine[] = [];
  diffs.forEach((diff, index) => {
    if (index) out.push({ kind: 'sep', sign: '', text: '' });
    const raw = diff.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const unified = raw.some((l) => /^(@@|[+-])/.test(l));
    let o = 1;
    let n = 1;
    const at = (line: DiffLine, old: boolean, now: boolean): NumberedLine =>
      numbered ? { ...line, ...(old ? { old: o++ } : {}), ...(now ? { new: n++ } : {}) } : line;
    for (const line of raw) {
      if (!unified) {
        const added = change === 'add';
        out.push(
          at({ kind: added ? 'add' : 'ctx', sign: added ? '+' : '', text: line }, !added, true),
        );
      } else if (HEADER.test(line)) {
        continue;
      } else if (line.startsWith('@@')) {
        const m = HUNK.exec(line);
        if (m) {
          o = Number(m[1]);
          n = Number(m[2]);
        }
        out.push({ kind: 'hunk', sign: '', text: line });
      } else if (line.startsWith('+')) {
        out.push(at({ kind: 'add', sign: '+', text: line.slice(1) }, false, true));
      } else if (line.startsWith('-')) {
        out.push(at({ kind: 'del', sign: '−', text: line.slice(1) }, true, false));
      } else {
        const text = line.startsWith(' ') ? line.slice(1) : line;
        out.push(at({ kind: 'ctx', sign: '', text }, true, true));
      }
    }
  });
  return out;
}

export function fileDiffLines(row: FileRow): DiffLine[] {
  return parseDiffs(row.diffs, row.change, false);
}

/** Numbered lines of a file's diffs for the diff window; each edit starts with its own hunk. */
export function numberedDiffLines(diffs: string[], change: FileChange['change']): NumberedLine[] {
  return parseDiffs(diffs, change, true).filter((line) => line.kind !== 'sep');
}

/** Added and removed lines of numbered diff lines. */
export function diffCounts(lines: NumberedLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === 'add') added++;
    else if (line.kind === 'del') removed++;
  }
  return { added, removed };
}
