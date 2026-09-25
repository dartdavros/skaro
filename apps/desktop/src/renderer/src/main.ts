import '@skaro/ui/tokens.css';
import { setLocale } from '@skaro/ui';
import { mount } from 'svelte';
import './i18n';

async function start(): Promise<void> {
  // Running in a plain browser (UI review): an in-memory bridge stands in for the preload.
  if (import.meta.env.DEV && !('skaro' in window)) await import('./mock-bridge');
  setLocale(await window.skaro.invoke('app.getLocale'));
  const target = document.getElementById('app');
  if (!target) throw new Error('#app element is missing');
  const { default: App } = await import('./App.svelte');
  mount(App, { target });
}

void start();
