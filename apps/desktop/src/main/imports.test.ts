import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markdownTable, parseDelimited, scanSource, snapshot } from './imports';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'skaro-import-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('import sources', () => {
  it('reads CSV with quotes into a Markdown table', () => {
    const rows = parseDelimited('a,"b, c","d ""e"""\n1,2,3\n', ',');
    expect(rows).toEqual([
      ['a', 'b, c', 'd "e"'],
      ['1', '2', '3'],
    ]);
    expect(markdownTable(rows)).toBe('| a | b, c | d "e" |\n| --- | --- | --- |\n| 1 | 2 | 3 |');
  });

  it('copies text, converts HTML and unpacks archives; the rest is skipped', async () => {
    const src = join(dir, 'src');
    await mkdir(join(src, 'node_modules'), { recursive: true });
    await writeFile(join(src, 'page.html'), '<h1>Заказы</h1><p>Статусы <b>заказа</b>.</p>');
    await writeFile(join(src, 'notes.md'), '# Notes\n');
    await writeFile(join(src, 'node_modules', 'x.md'), 'ignored');
    await writeFile(
      join(src, 'export.zip'),
      zipSync({ 'space/a.md': strToU8('# A\n'), 'space/b.fig': strToU8('x') }),
    );

    const folder = await scanSource(src);
    expect(folder).toMatchObject({ kind: 'folder', files: 3, readable: 3, unsupported: 0 });
    const archive = await scanSource(join(src, 'export.zip'));
    expect(archive).toMatchObject({ kind: 'archive', files: 2, readable: 1, formats: ['.fig'] });

    const out = join(dir, 'import');
    const manifest = await snapshot([folder, archive], out);
    const page = manifest.files.find((f) => f.source.endsWith('page.html'))!;
    expect(page.action).toBe('converted');
    expect(await readFile(join(out, page.copy!), 'utf8')).toBe('# Заказы\n\nСтатусы **заказа**.');
    const inZip = manifest.files.filter((f) => f.source.includes('export.zip/'));
    expect(inZip.map((f) => [f.source.split('/').pop(), f.action])).toEqual([
      ['a.md', 'copied'],
      ['b.fig', 'skipped'],
    ]);
    // An archive inside the folder is not unpacked a second time.
    expect(manifest.files.find((f) => f.source.endsWith('src/export.zip'))?.reason).toBe(
      'архив внутри архива',
    );
  });

  it('converts a Word document to Markdown', async () => {
    const xml = (s: string) => strToU8(`<?xml version="1.0" encoding="UTF-8"?>${s}`);
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const file = join(dir, 'spec.docx');
    await writeFile(
      file,
      zipSync({
        '[Content_Types].xml': xml(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>',
        ),
        '_rels/.rels': xml(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>',
        ),
        'word/document.xml': xml(
          `<w:document xmlns:w="${W}"><w:body>` +
            '<w:p><w:r><w:t>Возвраты по картам</w:t></w:r></w:p>' +
            '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Полный</w:t></w:r><w:r><w:t> возврат.</w:t></w:r></w:p>' +
            '</w:body></w:document>',
        ),
      }),
    );
    const manifest = await snapshot([await scanSource(file)], join(dir, 'import'));
    const [entry] = manifest.files;
    expect(entry).toMatchObject({ action: 'converted', format: 'docx' });
    expect(await readFile(join(dir, 'import', entry!.copy!), 'utf8')).toBe(
      'Возвраты по картам\n\n**Полный** возврат.',
    );
  });

  it('takes the text out of a PDF and keeps the original next to it', async () => {
    const stream = 'BT /F1 18 Tf 72 720 Td (Refunds by card) Tj ET';
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const file = join(dir, 'architecture.pdf');
    await writeFile(file, pdf, 'latin1');

    const manifest = await snapshot([await scanSource(file)], join(dir, 'import'));
    const [entry] = manifest.files;
    expect(entry).toMatchObject({ action: 'converted', format: 'pdf' });
    expect(entry?.original).toBeDefined();
    expect(await readFile(join(dir, 'import', entry!.copy!), 'utf8')).toContain('Refunds by card');
  });

  it('marks a source that is gone', async () => {
    expect(await scanSource(join(dir, 'gone'))).toMatchObject({ missing: true, files: 0 });
  });
});
