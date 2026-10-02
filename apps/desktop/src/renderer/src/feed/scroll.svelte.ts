import { tick } from 'svelte';

/** Follow layout changes until the user deliberately scrolls back through the feed. */
export class FeedScroll {
  scroller = $state<HTMLDivElement>();
  content = $state<HTMLDivElement>();
  atBottom = $state(true);
  private seenUser: string | undefined;
  private touchY: number | undefined;
  private lastTop = 0;

  constructor() {
    $effect(() => {
      const scroller = this.scroller;
      const content = this.content;
      if (!scroller || !content) return;
      const observer = new ResizeObserver(this.follow);
      observer.observe(content);
      observer.observe(scroller);
      scroller.addEventListener('scroll', this.onscroll);
      scroller.addEventListener('wheel', this.onwheel, { passive: true });
      scroller.addEventListener('keydown', this.onkeydown);
      scroller.addEventListener('pointerdown', this.onpointerdown);
      scroller.addEventListener('touchstart', this.ontouchstart, { passive: true });
      scroller.addEventListener('touchmove', this.ontouchmove, { passive: true });
      // The initial scroll runs after the mounted feed has its viewport dimensions.
      const frame = requestAnimationFrame(this.follow);
      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        scroller.removeEventListener('scroll', this.onscroll);
        scroller.removeEventListener('wheel', this.onwheel);
        scroller.removeEventListener('keydown', this.onkeydown);
        scroller.removeEventListener('pointerdown', this.onpointerdown);
        scroller.removeEventListener('touchstart', this.ontouchstart);
        scroller.removeEventListener('touchmove', this.ontouchmove);
      };
    });
  }

  follow = (): void => {
    if (this.scroller && this.atBottom) {
      this.scroller.scrollTop = this.scroller.scrollHeight;
      this.lastTop = this.scroller.scrollTop;
    }
  };

  updated(): void {
    void tick().then(this.follow);
  }

  userMessage(id: string | undefined): void {
    if (this.seenUser !== undefined && id !== this.seenUser) this.atBottom = true;
    this.seenUser = id;
  }

  onscroll = (): void => {
    const el = this.scroller;
    if (!el) return;
    const top = el.scrollTop;
    const distance = el.scrollHeight - top - el.clientHeight;
    if (top >= this.lastTop && distance < 40) this.atBottom = true;
    // Scroll events also come from layout/anchoring and our own scrollTop assignments.
    // Only input handlers below suspend following; loading history must not do that.
    if (this.atBottom && distance > 2) this.follow();
    this.lastTop = el.scrollTop;
  };

  onwheel = (event: WheelEvent): void => {
    if (event.deltaY < 0) this.atBottom = false;
  };

  onkeydown = (event: KeyboardEvent): void => {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest('input, textarea, select, [contenteditable="true"]')
    )
      return;
    if (
      ['ArrowUp', 'PageUp', 'Home'].includes(event.key) ||
      (event.key === ' ' && event.shiftKey && !(target instanceof HTMLButtonElement))
    )
      this.atBottom = false;
  };

  onpointerdown = (event: PointerEvent): void => {
    const el = this.scroller;
    if (!el) return;
    const scrollbar = el.offsetWidth - el.clientWidth;
    if (scrollbar > 0 && event.clientX >= el.getBoundingClientRect().right - scrollbar)
      this.atBottom = false;
  };

  ontouchstart = (event: TouchEvent): void => {
    this.touchY = event.touches[0]?.clientY;
  };

  ontouchmove = (event: TouchEvent): void => {
    const y = event.touches[0]?.clientY;
    if (y !== undefined && this.touchY !== undefined && y > this.touchY) this.atBottom = false;
    this.touchY = y;
  };

  toBottom = (): void => {
    this.scroller?.scrollTo({ top: this.scroller.scrollHeight, behavior: 'smooth' });
  };
}
