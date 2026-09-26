// "О программе": the running version and what "Проверить обновления" found.

import type { UpdateInfo } from '../../../shared/ipc';

class Updates {
  info = $state<UpdateInfo | undefined>();
  checked = $state(false);
  failed = $state(false);

  async load(): Promise<void> {
    if (this.info) return;
    this.info = { current: await window.skaro.invoke('app.version') };
  }

  async check(): Promise<void> {
    try {
      this.info = await window.skaro.invoke('app.checkUpdate');
      this.failed = false;
    } catch {
      this.failed = true;
    }
    this.checked = true;
  }
}

export const updates = new Updates();

export const LINKS = {
  github: 'https://github.com/skarodev/skaro',
  site: 'https://skaro.dev',
  community: 'https://github.com/skarodev/skaro/discussions',
};
