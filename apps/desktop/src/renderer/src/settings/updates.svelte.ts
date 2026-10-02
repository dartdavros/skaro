// "О программе": the running version and what "Проверить обновления" found.

import type { UpdateState } from '../../../shared/updates';

class Updates {
  state = $state<UpdateState | undefined>();
  open = $state(false);
  private fallbackCurrent = $state('');
  private unavailable = $state(false);
  available = $derived((this.state?.components.length ?? 0) > 0);
  checked = $derived(this.state?.checked ?? false);
  failed = $derived(this.unavailable || this.state?.phase === 'error');
  info = $derived({
    current: this.state?.current ?? this.fallbackCurrent,
    latest: this.state?.components.find((c) => c.id === 'skaro')?.latest,
  });
  private watching = false;

  async load(): Promise<void> {
    try {
      if (!this.watching) {
        window.skaro.on('updates.changed', (state) => {
          this.state = state;
        });
        this.watching = true;
      }
      this.state = await window.skaro.invoke('updates.state');
      this.unavailable = false;
    } catch {
      /* The running dev main may predate this renderer; never invent an update. */
      this.fallbackCurrent = await window.skaro.invoke('app.version').catch(() => '');
    }
  }

  async check(): Promise<void> {
    if (!this.state) await this.load();
    if (!this.state) {
      this.unavailable = true;
      return;
    }
    try {
      this.state = await window.skaro.invoke('app.checkUpdate');
      if (this.available || this.failed) this.open = true;
    } catch {
      if (this.state)
        this.state = {
          ...this.state,
          phase: 'error',
          error: 'UPDATES_UNAVAILABLE',
          retry: 'check',
        };
    }
  }

  async act(): Promise<void> {
    const method =
      this.state?.phase === 'ready' || this.state?.retry === 'apply'
        ? 'updates.apply'
        : this.state?.retry === 'check'
          ? 'app.checkUpdate'
          : 'updates.download';
    try {
      this.state = await window.skaro.invoke(method);
    } catch (error) {
      if (this.state)
        this.state = {
          ...this.state,
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
    }
  }
}

export const updates = new Updates();

export const LINKS = {
  github: 'https://github.com/skarodev/skaro',
  site: 'https://skaro.dev',
  community: 'https://github.com/skarodev/skaro/discussions',
};
