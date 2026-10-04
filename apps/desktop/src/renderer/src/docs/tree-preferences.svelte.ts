export function createTreePreferences() {
  let treeOpen = $state(true);
  let treeWidth = $state(256);
  /** The tree survives restarts ("ui.docTree"): shown or hidden, and its width. */
  let treeLoaded = $state(false);
  void window.skaro.invoke('app.getSetting', 'ui.docTree').then((saved) => {
    const s = saved as { open?: boolean; width?: number } | null;
    if (s?.open === false) treeOpen = false;
    if (typeof s?.width === 'number') treeWidth = Math.max(200, Math.min(400, s.width));
    treeLoaded = true;
  });
  let treeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const value = { open: treeOpen, width: treeWidth };
    if (!treeLoaded) return;
    clearTimeout(treeTimer);
    treeTimer = setTimeout(
      () => void window.skaro.invoke('app.setSetting', 'ui.docTree', value),
      300,
    );
  });

  return {
    get open() {
      return treeOpen;
    },
    set open(value: boolean) {
      treeOpen = value;
    },
    get width() {
      return treeWidth;
    },
    set width(value: number) {
      treeWidth = value;
    },
  };
}
