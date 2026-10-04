// Side blocks shown by a button: open by default in a wide window, hidden in a narrow one.

/**
 * A side block with its show button. The window width decides by default; the user's click holds
 * (across restarts too, in `key`) until the window crosses that width again.
 */
class SidePanel {
  private readonly key: string;
  private wide = $state(false);
  private choice = $state<boolean | undefined>();

  constructor(key: string, minWidth: number) {
    this.key = key;
    const query = window.matchMedia(`(min-width: ${minWidth}px)`);
    this.wide = query.matches;
    query.addEventListener('change', (e) => {
      this.wide = e.matches;
      this.save(undefined);
    });
    void window.skaro.invoke('app.getSetting', key).then((saved) => {
      if (typeof saved === 'boolean' && this.choice === undefined) this.choice = saved;
    });
  }

  get open(): boolean {
    return this.choice ?? this.wide;
  }

  set open(value: boolean) {
    this.save(value);
  }

  private save(value: boolean | undefined): void {
    this.choice = value;
    void window.skaro.invoke('app.setSetting', this.key, value ?? null);
  }
}

/** "Изменено в чате": sessions 224 + the block 216 + sections 216 leave the feed ~750. */
export const changedPanel = new SidePanel('ui.changedPanel', 1400);

/** "На странице": tree 256 + the block 184 + sections 216 leave the article ~700. */
export const tocPanel = new SidePanel('ui.tocPanel', 1440);
