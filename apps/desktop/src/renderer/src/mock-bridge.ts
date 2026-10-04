// Existing renderer-only preview; production always uses the native preload.
import type { Events, SkaroApi } from '../../shared/ipc';
import { invokePreview } from './preview-contract';
import { listeners } from './mock/bridge-state';
import { systemHandlers } from './mock/bridge-system';
import { projectsHandlers } from './mock/bridge-projects';
import { tasksHandlers } from './mock/bridge-tasks';
import { chatsHandlers } from './mock/bridge-chats';
const handlers = { ...systemHandlers, ...projectsHandlers, ...tasksHandlers, ...chatsHandlers };

const bridge: SkaroApi = {
  platform: 'win32',
  pathOf: (file: File) => `C:/Users/dev/Docs/${file.name}`,
  invoke: (method, ...args) => Promise.resolve(invokePreview(handlers, method, args) as never),
  on: <E extends keyof Events>(event: E, listener: (payload: Events[E]) => void) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => void set.delete(wrapped);
  },
};

Object.defineProperty(window, 'skaro', { value: bridge });
