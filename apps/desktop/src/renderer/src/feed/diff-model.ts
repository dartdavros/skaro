import type { FileRow } from '@skaro/timeline';

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'sep';
  sign: string;
  text: string;
}

export function fileDiffLines(row: FileRow): DiffLine[] {
  const out: DiffLine[] = [];
  row.diffs.forEach((diff, index) => {
    if (index) out.push({ kind: 'sep', sign: '', text: '' });
    const raw = diff.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    const unified = raw.some((l) => /^(@@|[+-])/.test(l));
    for (const line of raw) {
      if (!unified) {
        out.push({
          kind: row.change === 'add' ? 'add' : 'ctx',
          sign: row.change === 'add' ? '+' : '',
          text: line,
        });
      } else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file)/.test(line)) {
        continue;
      } else if (line.startsWith('@@')) {
        out.push({ kind: 'hunk', sign: '', text: line });
      } else if (line.startsWith('+')) {
        out.push({ kind: 'add', sign: '+', text: line.slice(1) });
      } else if (line.startsWith('-')) {
        out.push({ kind: 'del', sign: '−', text: line.slice(1) });
      } else {
        out.push({ kind: 'ctx', sign: '', text: line.startsWith(' ') ? line.slice(1) : line });
      }
    }
  });
  return out;
}
