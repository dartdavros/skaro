// Demo feed for the browser preview (mock-bridge): the states of the "Лента агента" mockup, so the
// task screen can be compared with it. Never used in the app.

import { Timeline, type TimelineState } from '@skaro/timeline';
import { changes } from './demo-feed/changes';
import { resetClock } from './demo-feed/events';
import { exploration } from './demo-feed/exploration';
import { finished } from './demo-feed/finished';
import { working } from './demo-feed/working';

export function demoTimeline(scenario: 'working' | 'finished'): TimelineState {
  resetClock();
  const events = [
    ...exploration(),
    ...changes(),
    ...(scenario === 'working' ? working() : finished()),
  ];
  return Timeline.from(events).state;
}
