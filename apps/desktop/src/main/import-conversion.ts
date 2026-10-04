import { readFile } from 'node:fs/promises';

/** A document as Markdown text. */
export async function convert(file: string, ext: string): Promise<string> {
  const data = await readFile(file);
  switch (ext) {
    case '.docx': {
      const mammoth = (await import('mammoth')).default;
      const { value } = await mammoth.convertToHtml({ buffer: data });
      return htmlToMarkdown(value);
    }
    case '.html':
    case '.htm':
      return htmlToMarkdown(data.toString('utf8'));
    case '.pdf': {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    }
    case '.csv':
    case '.tsv':
      return markdownTable(parseDelimited(data.toString('utf8'), ext === '.tsv' ? '\t' : ','));
    case '.xlsx': {
      const ExcelJS = (await import('exceljs')).default;
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(data as unknown as ArrayBuffer);
      const parts: string[] = [];
      book.eachSheet((sheet) => {
        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const values = Array.isArray(row.values) ? row.values.slice(1) : [];
          rows.push(values.map((v) => cellText(v)));
        });
        if (rows.length) parts.push(`## ${sheet.name}\n\n${markdownTable(rows)}`);
      });
      return parts.join('\n\n');
    }
    default:
      return '';
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  const TurndownService = (await import('turndown')).default;
  const service = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  return service.turndown(html);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if (v.text !== undefined) return String(v.text);
    if (v.result !== undefined) return String(v.result);
    return '';
  }
  return String(value);
}

/** CSV with quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function markdownTable(rows: string[][]): string {
  if (!rows.length) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) =>
    `| ${Array.from({ length: width }, (_, i) =>
      (r[i] ?? '')
        .replace(/\|/g, '\\|')
        .replace(/\s*\n\s*/g, ' ')
        .trim(),
    ).join(' | ')} |`;
  return [line(rows[0]!), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line)].join('\n');
}
