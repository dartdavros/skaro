export type ExportFileState = 'missing' | 'exact' | 'changed';

/** Recovery never rewrites an unknown target or partial temporary file. */
export function publicationAction(target: ExportFileState, temporary: ExportFileState) {
  if (target === 'changed') return 'retain';
  if (target === 'exact') return 'ready';
  if (temporary === 'changed') return 'retain';
  return temporary === 'exact' ? 'publish' : 'write';
}
