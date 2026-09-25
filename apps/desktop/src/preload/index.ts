import { contextBridge, ipcRenderer } from 'electron';
import {
  EVENT_CHANNEL,
  EVENTS,
  INVOKE_CHANNEL,
  METHODS,
  type EventName,
  type Events,
  type SkaroApi,
} from '../shared/ipc';

const methods = new Set<string>(METHODS);
const events = new Set<string>(EVENTS);

const api: SkaroApi = {
  platform: process.platform,
  invoke: (method, ...args) => {
    if (!methods.has(method)) return Promise.reject(new Error(`unknown method ${method}`));
    return ipcRenderer.invoke(INVOKE_CHANNEL, method, ...args);
  },
  on: <E extends EventName>(event: E, listener: (payload: Events[E]) => void) => {
    if (!events.has(event)) throw new Error(`unknown event ${event}`);
    const handler = (_: unknown, name: string, payload: Events[E]) => {
      if (name === event) listener(payload);
    };
    ipcRenderer.on(EVENT_CHANNEL, handler);
    return () => void ipcRenderer.off(EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld('skaro', api);
