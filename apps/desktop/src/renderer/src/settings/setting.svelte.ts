// An app setting kept in AppDb, read once and saved on every change ("Изменения сохраняются сразу").

export class Setting<T> {
  value = $state<T>() as T;
  private readonly key: string;

  constructor(key: string, fallback: T) {
    this.key = key;
    this.value = fallback;
    void window.skaro.invoke('app.getSetting', key).then((saved) => {
      if (saved !== null && saved !== undefined) this.value = saved as T;
    });
  }

  set(next: T): void {
    this.value = next;
    void window.skaro.invoke('app.setSetting', this.key, $state.snapshot(next));
  }
}

/** Font size of the agent feed ("Шрифт в ленте агента"). */
export const FEED_FONT: Record<string, string> = { small: '13px', normal: '14px', large: '15px' };

export function applyFeedFont(size: string | null | undefined): void {
  document.documentElement.style.setProperty('--fd-text', FEED_FONT[size ?? 'normal'] ?? '14px');
}
