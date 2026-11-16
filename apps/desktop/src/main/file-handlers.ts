import { dialog, shell, type BrowserWindow } from 'electron';
import type { PickedFile } from '../shared/ipc';
import { isImagePath } from './files';
import type { Handlers } from './ipc';
import type { Services } from './app-services';
import { saveClipboardImage } from './clipboard-image';

export function fileHandlers(
  { runs, attachments }: Services,
  window: () => BrowserWindow | undefined,
  picked: Set<string>,
): Pick<
  Handlers,
  | 'files.suggest'
  | 'files.exist'
  | 'files.open'
  | 'files.diff'
  | 'files.pick'
  | 'files.pasteImage'
  | 'shell.openExternal'
  | 'task.openExternal'
  | 'task.stopEnvironmentReview'
> {
  return {
    'task.openExternal': (projectId, taskId, url) =>
      runs.openExternal(projectId, taskId, url, (address) => shell.openExternal(address)),
    'task.stopEnvironmentReview': (projectId, taskId) =>
      runs.stopEnvironmentReview(projectId, taskId),
    'files.suggest': async (projectId, taskId, query) =>
      runs.files.suggest(projectId, taskId, query),
    'files.exist': async (projectId, taskId, paths) => runs.files.exist(projectId, taskId, paths),
    'files.open': async (projectId, taskId, path) => {
      await runs.files.open(projectId, taskId, path, async (file) => {
        const error = await shell.openPath(file);
        if (error) throw new Error(error);
      });
    },
    'files.diff': async (projectId, taskId, path) => runs.files.diff(projectId, taskId, path),
    'files.pasteImage': (bytes) => saveClipboardImage(attachments, bytes),
    'files.pick': async (kind) => {
      const options: Electron.OpenDialogOptions = {
        properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
        ...(kind === 'images'
          ? {
              filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
            }
          : {}),
      };
      const win = window();
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled) return [];
      return result.filePaths.map((path): PickedFile => {
        if (kind === 'folder') return { path, kind: 'folder' };
        if (isImagePath(path)) {
          picked.add(path);
          return { path, kind: 'image' };
        }
        return { path, kind: 'file' };
      });
    },
    'shell.openExternal': async (url) => {
      if (!/^https?:\/\//.test(url)) throw new Error('only web links open externally');
      await shell.openExternal(url);
    },
  };
}
