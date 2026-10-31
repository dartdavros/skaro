import type { Methods, MethodName } from '../../shared/ipc';

/** Runtime operations require the real Electron application. */
export type PreviewMethods = Omit<
  Methods,
  | 'app.checkUpdate'
  | 'updates.state'
  | 'updates.download'
  | 'updates.apply'
  | 'task.revertMerge'
  | 'task.clear'
  | 'chat.clear'
  | 'task.openExternal'
  | 'task.stopEnvironmentReview'
  | 'diagnostics.export'
  | 'agents.limits'
  | 'agents.catalog'
  | 'files.pasteImage'
> & {
  'app.checkUpdate': () => { current: string };
};

export function invokePreview(handlers: object, method: MethodName, args: unknown[]): unknown {
  if (
    method.startsWith('updates.') ||
    method === 'app.checkUpdate' ||
    method === 'task.revertMerge' ||
    method === 'task.clear' ||
    method === 'chat.clear' ||
    method === 'task.openExternal' ||
    method === 'task.stopEnvironmentReview' ||
    method === 'diagnostics.export' ||
    method === 'files.pasteImage' ||
    method === 'agents.limits' ||
    method === 'agents.catalog'
  )
    throw new Error('This operation requires the real Electron application');
  return (handlers as Record<string, (...args: unknown[]) => unknown>)[method]!(...args);
}
