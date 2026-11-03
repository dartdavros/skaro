import { dialog, type BrowserWindow } from 'electron';
import { writeFile, realpath } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Handlers } from './ipc';
import { exportBytes, safeExportName } from './diagram-export-file';

type SaveMethods =
  'diagram.save' | 'diagram.pickFolder' | 'diagram.saveInFolder' | 'diagram.closeFolder';
export function diagramExportHandlers(
  window: () => BrowserWindow | undefined,
): Pick<Handlers, SaveMethods> {
  let saving = false;
  const folders = new Map<string, { path: string; expires: number; busy: boolean }>();
  return {
    'diagram.save': async (file) => {
      if (saving) throw new Error('diagram-export-busy');
      if (!file) throw new Error('Invalid diagram export');
      const bytes = exportBytes(file.format, file.bytes),
        name = safeExportName(file.name);
      saving = true;
      try {
        const options: Electron.SaveDialogOptions = {
          defaultPath: name,
          filters: [{ name: file.format.toUpperCase(), extensions: [file.format] }],
        };
        const win = window();
        const result = win
          ? await dialog.showSaveDialog(win, options)
          : await dialog.showSaveDialog(options);
        if (result.canceled || !result.filePath) return false;
        await writeFile(result.filePath, bytes);
        return true;
      } finally {
        saving = false;
      }
    },
    'diagram.pickFolder': async () => {
      if (saving) throw new Error('diagram-export-busy');
      saving = true;
      try {
        const options: Electron.OpenDialogOptions = {
          properties: ['openDirectory', 'createDirectory'],
        };
        const win = window();
        const result = win
          ? await dialog.showOpenDialog(win, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || !result.filePaths[0]) return null;
        for (const [key, entry] of folders) if (entry.expires < Date.now()) folders.delete(key);
        if (folders.size >= 4) throw new Error('diagram-export-busy');
        const token = randomUUID();
        folders.set(token, {
          path: await realpath(result.filePaths[0]),
          expires: Date.now() + 3600000,
          busy: false,
        });
        return token;
      } finally {
        saving = false;
      }
    },
    'diagram.saveInFolder': async (token, name, value) => {
      const folder = folders.get(token);
      if (!folder || folder.expires < Date.now() || folder.busy)
        throw new Error('Export folder expired or busy');
      const bytes = exportBytes('png', value),
        filename = safeExportName(name);
      if (extname(filename).toLowerCase() !== '.png') throw new Error('Expected PNG filename');
      folder.busy = true;
      try {
        if ((await realpath(folder.path)) !== folder.path) throw new Error('Export folder changed');
        for (let index = 0; index < 10000; index++) {
          const candidate = index ? `${filename.slice(0, -4)} (${index}).png` : filename;
          try {
            await writeFile(join(folder.path, candidate), bytes, { flag: 'wx' });
            return;
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
          }
        }
        throw new Error('Export filename collision limit');
      } finally {
        folder.busy = false;
      }
    },
    'diagram.closeFolder': (token) => {
      folders.delete(token);
    },
  };
}
