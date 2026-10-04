import { dialog, shell, type BrowserWindow } from 'electron';
import type { PickedFile } from '../shared/ipc';
import { fileDiff } from './file-diff';
import { existingPaths, isImagePath, resolveInside, suggestPaths } from './files';
import type { Handlers } from './ipc';
import type { Services } from './app-services';

export function fileHandlers(
  { runs }: Services,
  window: () => BrowserWindow | undefined,
  picked: Set<string>,
): Pick<
  Handlers,
  | 'files.suggest'
  | 'files.exist'
  | 'files.open'
  | 'files.diff'
  | 'files.pick'
  | 'shell.openExternal'
> {
  return {
    'files.suggest': (projectId, taskId, query) =>
      suggestPaths(runs.workdir(projectId, taskId), query),
    'files.exist': (projectId, taskId, paths) =>
      existingPaths(runs.workdir(projectId, taskId), paths),
    'files.open': async (projectId, taskId, path) => {
      const error = await shell.openPath(resolveInside(runs.workdir(projectId, taskId), path));
      if (error) throw new Error(error);
    },
    'files.diff': (projectId, taskId, path) => fileDiff(runs.workdir(projectId, taskId), path),
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
