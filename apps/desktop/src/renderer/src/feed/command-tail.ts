/** Scan only the visible tail; avoid allocating an array of every output line on each chunk. */
export function commandTail(output: string, limit = 40): { text: string; truncated: boolean } {
  let at = output.length;
  for (let n = 0; n < limit; n++) {
    at = output.lastIndexOf('\n', at - 1);
    if (at < 0) return { text: output, truncated: false };
  }
  return { text: output.slice(at + 1), truncated: true };
}
