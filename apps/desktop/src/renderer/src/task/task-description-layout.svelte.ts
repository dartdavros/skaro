// The task's right sidebar; the existing setting follows the panel when it moves.
const clamp = (width: number) => Math.max(240, Math.min(520, width));
export class TaskDescriptionLayout {
  open = $state(true);
  width = $state(318);
  private touched = false;
  private disposed = false;
  constructor() {
    void window.skaro.invoke('app.getSetting', 'ui.taskDesc').then((saved) => {
      if (this.disposed || this.touched) return;
      const value = saved as { open?: boolean; width?: number } | null;
      if (value?.open === false) this.open = false;
      if (typeof value?.width === 'number' && Number.isFinite(value.width))
        this.width = clamp(value.width);
    });
  }
  setOpen(open: boolean): void {
    this.open = open;
    this.save();
  }
  setWidth(width: number): void {
    this.touched = true;
    this.width = clamp(width);
  }
  dispose(): void {
    if (this.touched) this.save();
    this.disposed = true;
  }
  save(): void {
    if (this.disposed) return;
    this.touched = true;
    void window.skaro.invoke('app.setSetting', 'ui.taskDesc', {
      open: this.open,
      width: this.width,
    });
  }
}
