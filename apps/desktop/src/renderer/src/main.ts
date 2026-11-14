import '@skaro/ui/tokens.css';
import { setLocale } from '@skaro/ui';
import { mount } from 'svelte';
import './i18n';
// Shell, board and plan share these strings with lazily loaded conversation screens.
import './feed/i18n';
import { bootstrap } from './bootstrap';
import { prepareRenderer } from './renderer-startup';

async function start(): Promise<void> {
  // Running in a plain browser (UI review): an in-memory bridge stands in for the preload.
  if (import.meta.env.DEV && !('skaro' in window)) await import('./mock-bridge');
  await prepareRenderer();
  setLocale(bootstrap?.locale ?? (await window.skaro.invoke('app.getLocale')));
  const target = document.getElementById('app');
  if (!target) throw new Error('#app element is missing');
  const { default: Shell } = await import('./Shell.svelte');
  mount(Shell, { target });
}

void start();
