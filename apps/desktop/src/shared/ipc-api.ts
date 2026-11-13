import type { Methods, MethodName, Events, EventName } from './ipc';
/** What the renderer sees as `window.skaro`. */
export interface SkaroApi {
  readonly bootstrap?: import('./ipc-sessions').BootstrapState;
  readonly bootstrapReady?: Promise<import('./ipc-sessions').BootstrapState | undefined>;
  readonly platform: string;
  /** Path on disk of a file or a folder dropped into the window. */
  pathOf(file: File): string;
  invoke<M extends MethodName>(
    method: M,
    ...args: Parameters<Methods[M]>
  ): Promise<ReturnType<Methods[M]>>;
  on<E extends EventName>(event: E, listener: (payload: Events[E]) => void): () => void;
}
