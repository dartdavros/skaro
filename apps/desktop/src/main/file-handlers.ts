import { clipboard, dialog, nativeImage, shell, type BrowserWindow } from 'electron';
import type { PickedFile } from '../shared/ipc';
import { fileDiff } from './file-diff';
import { existingPaths, isImagePath, resolveInside, suggestPaths } from './files';
import type { Handlers } from './ipc';
import type { Services } from './app-services';

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
      suggestPaths(await runs.workdir(projectId, taskId), query),
    'files.exist': async (projectId, taskId, paths) =>
      existingPaths(await runs.workdir(projectId, taskId), paths),
    'files.open': async (projectId, taskId, path) => {
      const error = await shell.openPath(
        resolveInside(await runs.workdir(projectId, taskId), path),
      );
      if (error) throw new Error(error);
    },
    'files.diff': async (projectId, taskId, path) =>
      fileDiff(await runs.workdir(projectId, taskId), path),
    'files.pasteImage': async () => {
      const items = await clipboard.read();
      const item = items.find((entry) => entry.types.includes('image/png'));
      if (!item) return undefined;
      const blob = await item.getType('image/png');
      if (!('arrayBuffer' in blob)) return undefined;
      const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
      if (image.isEmpty()) return undefined;
      const { width, height } = image.getSize();
      const ref = attachments.save({
        base64: image.toPNG().toString('base64'),
        mime: 'image/png',
        width,
        height,
      });
      return { path: attachments.file(ref), kind: 'image' };
    },
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
