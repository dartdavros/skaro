import { extname } from 'node:path';

export function imageType(path: string): 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' {
  const ext = extname(path).toLowerCase();
  return ext === '.png'
    ? 'image/png'
    : ext === '.gif'
      ? 'image/gif'
      : ext === '.webp'
        ? 'image/webp'
        : 'image/jpeg';
}

export function lines(onLine: (line: string) => void): (chunk: Buffer | string) => void {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString();
    let index: number;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
}

export function parse(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    return line;
  }
}
