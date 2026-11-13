import type { FeedActions } from '../feed/context.svelte';
export function chatFileActions(
  projectId: string,
  guard: (action: () => Promise<unknown>) => Promise<void>,
): Pick<
  FeedActions,
  'openPath' | 'existing' | 'fileDiff' | 'openExternal' | 'stopBackground' | 'merge'
> {
  return {
    openPath: (path) => {
      void guard(() => window.skaro.invoke('files.open', projectId, '', path)).catch(
        () => undefined,
      );
    },
    existing: (paths) => window.skaro.invoke('files.exist', projectId, '', paths).catch(() => []),
    fileDiff: (path) => window.skaro.invoke('files.diff', projectId, '', path),
    openExternal: (url) => {
      void window.skaro.invoke('shell.openExternal', url);
    },
    stopBackground: () => undefined,
    merge: () => Promise.resolve(),
  };
}
