// Dragging on the plan, the way cards are dragged on the board (board-drag.svelte.ts): pointer
// events with a ghost, a slot where it lands, keyboard moves (Space — take, arrows — move,
// Space — put) and spoken positions. Milestones change their order; tasks change their place and
// milestone. What a drop does is decided by the caller.

import { t } from '@skaro/ui';
import type { Stage } from './model';
import { planHit } from './plan-drag-hit';

export interface PlanDrag {
  kind: 'stage' | 'task';
  id: string;
  /** The milestone of a dragged task ("" — "Без этапа"); a dragged milestone — its own id. */
  from: string;
  to: string;
  /** Position among the milestones, or among the tasks of `to`, without the dragged one. */
  index: number;
  /** Where it was taken from: putting it back there changes nothing. */
  origin: number;
  keyboard: boolean;
  /** The ghost: size, grab offset and pointer (pointer drags only). */
  w: number;
  h: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

const THRESHOLD = 5;
const EDGE = 40;

export function createPlanDrag(options: {
  root: () => HTMLElement | undefined;
  stages: () => Stage[];
  /** Opens a milestone the keyboard moves a task into. */
  reveal: (id: string) => void;
  ondrop: (drag: PlanDrag) => void;
}) {
  let drag = $state<PlanDrag | undefined>();
  let dropped = $state<string | undefined>();
  let live = $state('');
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let frame = 0;

  // A plan that goes away mid-drag leaves no listeners or cursor behind.
  $effect(() => () => {
    window.removeEventListener('keydown', keys, { capture: true });
    clearTimeout(dropTimer);
    end();
  });

  const movable = (): Stage[] => options.stages().filter((s) => !s.loose);
  const others = (d: PlanDrag): number =>
    d.kind === 'stage'
      ? movable().length - 1
      : (options
          .stages()
          .find((s) => s.milestone.id === d.to)
          ?.tasks.filter((x) => x.id !== d.id).length ?? 0);
  const stageName = (id: string): string => {
    const m = options.stages().find((s) => s.milestone.id === id)?.milestone;
    return m ? (m.id ? `${m.id} · ${m.title}` : m.title) : id;
  };

  function announce(d: PlanDrag): void {
    const total = others(d) + 1;
    live =
      d.kind === 'stage'
        ? t('plan.dnd.position.stage', { n: d.index + 1, total })
        : t('plan.dnd.position.task', { stage: stageName(d.to), n: d.index + 1, total });
  }

  /** Where the dragged item would land; outside the milestones the last target stays. */
  function hit(d: PlanDrag, x: number, y: number): { to: string; index: number } | undefined {
    const root = options.root();
    const h = root && planHit(root, d.kind, x, y, (to) => others({ ...d, to }));
    return h && { to: h.to ?? d.to, index: h.index };
  }

  function retarget(d: PlanDrag, to: string, index: number): void {
    const changed = d.to !== to || d.index !== index;
    drag = { ...d, to, index };
    if (changed && d.keyboard) announce(drag);
  }

  /** Near the top or bottom edge of the plan the list scrolls. */
  function autoscroll(): void {
    const d = drag;
    const root = options.root();
    if (!d || d.keyboard || !root) return;
    const r = root.getBoundingClientRect();
    const speed =
      d.y < r.top + EDGE
        ? -(r.top + EDGE - d.y) / 3
        : d.y > r.bottom - EDGE
          ? (d.y - r.bottom + EDGE) / 3
          : 0;
    if (speed) {
      root.scrollTop += speed;
      const h = hit(d, d.x, d.y);
      if (h) retarget(d, h.to, h.index);
    }
    frame = requestAnimationFrame(autoscroll);
  }

  function end(): void {
    cancelAnimationFrame(frame);
    document.body.style.cursor = '';
  }

  function finish(): void {
    const d = drag;
    end();
    drag = undefined;
    if (!d) return;
    dropped = d.id;
    clearTimeout(dropTimer);
    dropTimer = setTimeout(() => (dropped = undefined), 450);
    if (d.keyboard)
      live =
        d.kind === 'stage'
          ? t('plan.dnd.dropped.stage', { id: d.id, n: d.index + 1 })
          : t('plan.dnd.dropped.task', { id: d.id, stage: stageName(d.to), n: d.index + 1 });
    if (d.from !== d.to || d.index !== d.origin) options.ondrop(d);
  }

  function cancel(): void {
    const keyboard = drag?.keyboard;
    end();
    drag = undefined;
    if (keyboard) live = t('plan.dnd.cancelled');
  }

  function indexOf(kind: PlanDrag['kind'], id: string, from: string): number {
    const list =
      kind === 'stage'
        ? movable().map((s) => s.milestone.id)
        : (options
            .stages()
            .find((s) => s.milestone.id === from)
            ?.tasks.map((x) => x.id) ?? []);
    return Math.max(0, list.indexOf(id));
  }

  /** Pointer down on a milestone or a task: a drag starts after 5px, a shorter press stays a click. */
  function down(kind: PlanDrag['kind'], id: string, from: string, e: PointerEvent): void {
    if (e.button !== 0 || drag) return;
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const index = indexOf(kind, id, from);
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < THRESHOLD) return;
        started = true;
        drag = {
          kind,
          id,
          from,
          to: from,
          index,
          origin: index,
          keyboard: false,
          w: r.width,
          h: r.height,
          ox: sx - r.left,
          oy: sy - r.top,
          x: ev.clientX,
          y: ev.clientY,
        };
        document.body.style.cursor = 'grabbing';
        frame = requestAnimationFrame(autoscroll);
      }
      const d = drag!;
      drag = { ...d, x: ev.clientX, y: ev.clientY };
      const h = hit(drag, ev.clientX, ev.clientY);
      if (h) retarget(drag, h.to, h.index);
    };
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      stop();
      cancel();
    };
    const up = () => {
      stop();
      if (!started) return;
      // The click that ends a drag does not toggle the milestone or open the task under it.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      if (drag) finish();
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('keydown', key, { capture: true });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    window.addEventListener('keydown', key, { capture: true });
  }

  /** A task moved by the keyboard past the edge of its milestone goes to the neighbour. */
  function step(d: PlanDrag, delta: -1 | 1): void {
    if (d.kind === 'stage') {
      retarget(d, d.to, Math.max(0, Math.min(others(d), d.index + delta)));
      return;
    }
    const next = d.index + delta;
    if (next >= 0 && next <= others(d)) {
      retarget(d, d.to, next);
      return;
    }
    const list = options.stages();
    const neighbour = list[list.findIndex((s) => s.milestone.id === d.to) + delta];
    if (!neighbour) return;
    const to = neighbour.milestone.id;
    options.reveal(to);
    retarget(d, to, delta < 0 ? others({ ...d, to }) : 0);
  }

  /** Keys while an item is taken from the keyboard: arrows move, Space or Enter put, Esc cancels. */
  function keys(e: KeyboardEvent): void {
    const d = drag;
    if (!d?.keyboard) return;
    if (![' ', 'Enter', 'Escape', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === ' ' || e.key === 'Enter') release(d, finish);
    else if (e.key === 'Escape') release(d, cancel);
    else step(d, e.key === 'ArrowUp' ? -1 : 1);
  }

  /** Ends a keyboard move and puts the focus back on the item, wherever it landed. */
  function release(d: PlanDrag, done: () => void): void {
    window.removeEventListener('keydown', keys, { capture: true });
    done();
    const attr = d.kind === 'stage' ? 'data-stage-head' : 'data-row';
    requestAnimationFrame(() =>
      options
        .root()
        ?.querySelector<HTMLElement>(`[${attr}="${CSS.escape(d.id)}"]`)
        ?.focus(),
    );
  }

  /** Space on a focused milestone or task takes it; it leaves the list, its slot moves. */
  function keydown(kind: PlanDrag['kind'], id: string, from: string, e: KeyboardEvent): void {
    if (drag || e.key !== ' ') return;
    e.preventDefault();
    const index = indexOf(kind, id, from);
    drag = {
      kind,
      id,
      from,
      to: from,
      index,
      origin: index,
      keyboard: true,
      w: 0,
      h: (e.currentTarget as HTMLElement).offsetHeight,
      ox: 0,
      oy: 0,
      x: 0,
      y: 0,
    };
    live = t(kind === 'stage' ? 'plan.dnd.picked.stage' : 'plan.dnd.picked.task', { id });
    window.addEventListener('keydown', keys, { capture: true });
  }

  return {
    get drag() {
      return drag;
    },
    get dropped() {
      return dropped;
    },
    get live() {
      return live;
    },
    down,
    keydown,
  };
}

export type PlanDragController = ReturnType<typeof createPlanDrag>;
