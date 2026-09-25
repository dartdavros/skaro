/// <reference types="vite/client" />
import type { SkaroApi } from '../../shared/ipc';

declare global {
  interface Window {
    readonly skaro: SkaroApi;
  }
}
