import { t } from '@skaro/ui';
export const GROUPS = [
  ['adr', 'import.review.adr'],
  ['spec', 'import.review.specs'],
  ['doc', 'import.review.docs'],
] as const;
export function sourceLabel(source: string): string {
  return source === 'code' ? t('import.review.code') : source;
}

export function blocks(body: string): { kind: 'h' | 'p' | 'li'; text: string }[] {
  const out: { kind: 'h' | 'p' | 'li'; text: string }[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push({ kind: 'p', text: para.join(' ') });
    para = [];
  };
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    const li = /^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
    if (h) {
      flush();
      out.push({ kind: 'h', text: h[1]! });
    } else if (li) {
      flush();
      out.push({ kind: 'li', text: li[1]! });
    } else if (!line) flush();
    else para.push(line.replace(/\*\*|__|`/g, ''));
  }
  flush();
  return out;
}
