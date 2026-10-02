const clamp = (width: number) => Math.max(180, Math.min(520, width));

/** Width of the project navigation, shared across sections and restored from app settings. */
export class NavigationWidth {
  private value = $state(216);
  private touched = false;
  private disposed = false;
  constructor() {
    void window.skaro.invoke('app.getSetting', 'ui.navWidth').then((saved) => {
      if (!this.disposed && !this.touched && typeof saved === 'number' && Number.isFinite(saved))
        this.value = clamp(saved);
    });
  }
  get width(): number {
    return this.value;
  }
  set width(value: number) {
    this.touched = true;
    this.value = clamp(value);
  }
  save(): void {
    if (!this.disposed) void window.skaro.invoke('app.setSetting', 'ui.navWidth', this.value);
  }
  dispose(): void {
    if (this.touched) this.save();
    this.disposed = true;
  }
}
