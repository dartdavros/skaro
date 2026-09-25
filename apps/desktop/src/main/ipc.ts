import { ipcMain, type WebContents } from 'electron';
import {
  EVENT_CHANNEL,
  INVOKE_CHANNEL,
  METHODS,
  type EventName,
  type Events,
  type MethodName,
  type Methods,
} from '../shared/ipc';

export type Handlers = {
  [M in MethodName]: (
    ...args: Parameters<Methods[M]>
  ) => ReturnType<Methods[M]> | Promise<ReturnType<Methods[M]>>;
};

/**
 * Serves the renderer's calls. Only whitelisted methods, only from our own window's main frame.
 */
export function registerHandlers(
  handlers: Handlers,
  isTrusted: (sender: WebContents) => boolean,
): void {
  const allowed = new Set<string>(METHODS);
  ipcMain.handle(INVOKE_CHANNEL, (event, method: string, ...args: unknown[]) => {
    if (!isTrusted(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('untrusted sender');
    }
    if (!allowed.has(method)) throw new Error(`unknown method ${method}`);
    const handler = handlers[method as MethodName] as (...a: unknown[]) => unknown;
    return handler(...args);
  });
}

export function sendEvent<E extends EventName>(
  target: WebContents,
  event: E,
  payload: Events[E],
): void {
  if (!target.isDestroyed()) target.send(EVENT_CHANNEL, event, payload);
}
