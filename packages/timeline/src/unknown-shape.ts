/** Structural counts only: never include field names, strings, paths or payload values. */
export function unknownShape(raw: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++visited > 1000 || depth > 8) {
      counts.truncated = (counts.truncated ?? 0) + 1;
      return;
    }
    const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    counts[type] = (counts[type] ?? 0) + 1;
    if (typeof value === 'object' && value !== null) {
      for (const child of Object.values(value)) {
        if (visited >= 1000) {
          counts.truncated = (counts.truncated ?? 0) + 1;
          break;
        }
        visit(child, depth + 1);
      }
    }
  };
  visit(raw, 0);
  return counts;
}
