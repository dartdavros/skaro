import { C4ValidationError, c4Issue } from './diagnostics.ts';
import { c4Hash } from './documents.ts';
import { authoredBody } from './render.ts';

export type C4DocumentChange =
  | { path: string; content: string; baseHash?: never; edits?: never }
  | {
      path: string;
      baseHash: string;
      edits: readonly { oldText: string; newText: string }[];
      content?: never;
    };

export function resolveC4DocumentChange(
  document: C4DocumentChange,
  current: string | undefined,
  preserveExisting: boolean,
): string {
  const invalid = (message: string) => {
    throw new C4ValidationError([
      {
        ...c4Issue(
          message,
          'invalid_data',
          [],
          'Read get_c4_context for the current document and documentHashes. Use base_hash and non-overlapping edits with exact, unique old_text anchors.',
        ),
        path: document.path,
      },
    ]);
  };
  if (document.content !== undefined) {
    if (preserveExisting && current !== undefined)
      invalid('C4: existing documents require base_hash and edits');
    return authoredBody(document.content) + '\n';
  }
  if (current === undefined || c4Hash(current) !== document.baseHash)
    return invalid('C4: document does not match base_hash');
  if (!document.edits.length) return invalid('C4: at least one document edit is required');

  const source = current;
  const crlf = source.includes('\r\n');
  const lf = source.replaceAll('\r\n', '').includes('\n');
  const normalize = (value: string) =>
    crlf && lf ? value : value.replace(/\r?\n/g, crlf ? '\r\n' : '\n');
  const edits = document.edits
    .map(({ oldText, newText }) => {
      const anchor = normalize(oldText);
      const start = source.indexOf(anchor);
      if (!anchor.trim() || start === -1 || source.indexOf(anchor, start + 1) !== -1)
        return invalid('C4: old_text must identify exactly one non-blank fragment');
      return { start, end: start + anchor.length, text: normalize(newText) };
    })
    .sort((left, right) => left.start - right.start);

  let offset = 0;
  const parts: string[] = [];
  for (const edit of edits) {
    if (edit.start < offset) return invalid('C4: document edits overlap');
    parts.push(source.slice(offset, edit.start), edit.text);
    offset = edit.end;
  }
  const result = parts.join('') + source.slice(offset);
  if (!authoredBody(result).trim()) return invalid('C4: document edits would empty the document');
  return result;
}
