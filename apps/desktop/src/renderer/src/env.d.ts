import type { SkaroApi } from '../../preload/api';

declare global {
  interface Window {
    readonly skaro: SkaroApi;
  }
}
