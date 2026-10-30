import type { BackgroundJob, BackgroundState } from '../../../shared/background';

/** Skaro's own work for the title bar: pushed by the main process, never polled. */
class Background {
  jobs = $state<BackgroundJob[]>([]);
  open = $state(false);
  running = $derived(this.jobs.filter((job) => job.state === 'running'));
  recent = $derived(this.jobs.filter((job) => job.state !== 'running'));
  failed = $derived(this.recent.some((job) => job.state === 'failed'));
  private watching = false;

  async load(): Promise<void> {
    if (!this.watching) {
      window.skaro.on('background.changed', (state: BackgroundState) => {
        this.jobs = state.jobs;
      });
      this.watching = true;
    }
    try {
      this.jobs = (await window.skaro.invoke('background.state')).jobs;
    } catch {
      /* A running dev main may predate this renderer; the button stays hidden. */
    }
  }
}

export const background = new Background();
