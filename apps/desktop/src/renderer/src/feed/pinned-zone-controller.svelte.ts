import { backgroundCommands } from '@skaro/timeline';
import { clock, useFeed } from './context.svelte';
import type { PinnedZoneProps } from './pinned-zone-props';
export function createPinnedZoneController(p: PinnedZoneProps) {
  const feed = useFeed();
  let planOpen = $state(false);
  let outputOf = $state<string | undefined>();

  /** Finished background commands leave after a few seconds. */
  const background = $derived(
    backgroundCommands(p.timeline).filter(
      (c) => c.background?.state === 'running' || clock.now - (c.endedAt ?? clock.now) < 8000,
    ),
  );
  const plan = $derived(p.timeline.plan ?? []);
  const done = $derived(plan.filter((s) => s.status === 'done').length);
  const active = $derived(plan.find((s) => s.status === 'active'));
  const showPlan = $derived(
    plan.length > 0 && (done < plan.length || p.timeline.status !== 'idle'),
  );
  const opened = $derived(background.find((c) => c.id === outputOf));

  return {
    p,
    feed,
    get planOpen() {
      return planOpen;
    },
    set planOpen(value: typeof planOpen) {
      planOpen = value;
    },
    get outputOf() {
      return outputOf;
    },
    set outputOf(value: typeof outputOf) {
      outputOf = value;
    },
    get background() {
      return background;
    },
    get plan() {
      return plan;
    },
    get done() {
      return done;
    },
    get active() {
      return active;
    },
    get showPlan() {
      return showPlan;
    },
    get opened() {
      return opened;
    },
  };
}
export type PinnedZoneController = ReturnType<typeof createPinnedZoneController>;
