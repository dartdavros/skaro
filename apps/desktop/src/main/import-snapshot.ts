import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, sep } from 'node:path';
import type { SourceInfo, Manifest, ManifestFile } from './import-model';
import {
  TEXT,
  IMAGE,
  ARCHIVE,
  SKIP_DIRS,
  MAX_FILE_BYTES,
  readable,
  walk,
  safeName,
} from './import-sources';
import { convert } from './import-conversion';

// ── the copy of the sources ──────────────────────────────────────────────────

/** Copies and converts the sources into `<dir>/source`; writes `<dir>/manifest.json`. */
export async function snapshot(sources: SourceInfo[], dir: string): Promise<Manifest> {
  const manifest: Manifest = {
    sources: sources.map((s) => ({ path: s.path, display: s.display, kind: s.kind })),
    files: [],
  };
  await mkdir(join(dir, 'source'), { recursive: true });
  for (const [i, source] of sources.entries()) {
    const base = `${i + 1}-${safeName(basename(source.path))}`;
    if (source.kind === 'folder') {
      const files: string[] = [];
      await walk(source.path, files);
      for (const file of files) {
        const rel = relative(source.path, file).split(sep).join('/');
        await addFile(
          manifest,
          dir,
          file,
          `source/${base}/${rel}`,
          `${source.display}/${rel}`,
          file,
        );
      }
    } else if (source.kind === 'archive') {
      await addArchive(manifest, dir, source.path, `source/${base}`, source.display);
    } else {
      await addFile(manifest, dir, source.path, `source/${base}`, source.display, source.path);
    }
  }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function addArchive(
  manifest: Manifest,
  dir: string,
  path: string,
  target: string,
  display: string,
): Promise<void> {
  const { unzipSync } = await import('fflate');
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await readFile(path)));
  } catch {
    manifest.files.push(skipped(display, 'zip', 0, 'архив не открылся'));
    return;
  }
  const unpacked = join(dir, 'unpacked', safeName(basename(path)));
  for (const [name, data] of Object.entries(entries)) {
    if (name.endsWith('/') || name.split('/').some((p) => p === '..' || SKIP_DIRS.has(p))) continue;
    const file = join(unpacked, ...name.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
    await addFile(manifest, dir, file, `${target}/${name}`, `${display}/${name}`);
  }
}

async function addFile(
  manifest: Manifest,
  dir: string,
  file: string,
  target: string,
  display: string,
  origin?: string,
): Promise<void> {
  const ext = extname(file).toLowerCase();
  const format = ext.slice(1) || 'file';
  const size = (await stat(file).catch(() => undefined))?.size ?? 0;
  if (!readable(file) || ARCHIVE.has(ext)) {
    manifest.files.push(
      skipped(
        display,
        format,
        size,
        ARCHIVE.has(ext) ? 'архив внутри архива' : 'формат не поддерживается',
      ),
    );
    return;
  }
  if (size > MAX_FILE_BYTES) {
    manifest.files.push(skipped(display, format, size, 'файл слишком большой'));
    return;
  }
  const abs = join(dir, ...target.split('/'));
  await mkdir(dirname(abs), { recursive: true });
  try {
    if (TEXT.has(ext) || IMAGE.has(ext)) {
      await copyFile(file, abs);
      manifest.files.push({
        source: display,
        copy: target,
        format,
        size,
        ...(origin ? { origin } : {}),
        action: 'copied',
      });
      return;
    }
    const text = await convert(file, ext);
    if (!text.trim()) {
      manifest.files.push(skipped(display, format, size, 'пустой файл'));
      return;
    }
    await writeFile(`${abs}.md`, text);
    const entry: ManifestFile = {
      source: display,
      copy: `${target}.md`,
      format,
      size,
      ...(origin ? { origin } : {}),
      action: 'converted',
    };
    // The agent may look at the original of a PDF: pictures and tables do not survive as text.
    if (ext === '.pdf') {
      await copyFile(file, abs);
      entry.original = target;
    }
    manifest.files.push(entry);
  } catch {
    manifest.files.push(skipped(display, format, size, 'не удалось прочитать'));
  }
}

function skipped(source: string, format: string, size: number, reason: string): ManifestFile {
  return { source, format, size, action: 'skipped', reason };
}
