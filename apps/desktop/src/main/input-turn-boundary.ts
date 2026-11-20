import type { TimelineEvent } from '@skaro/timeline';

type Completion = Extract<TimelineEvent, { t: 'turn.completed' }>;

/** A replacement holds its existing scheduler slot until this exact native turn ends. */
export class InputTurnBoundary {
  readonly turnId: string;
  readonly completion: Promise<void>;
  private ended!: () => void;
  retiring = false;

  constructor(turnId: string) {
    this.turnId = turnId;
    this.completion = new Promise((resolve) => {
      this.ended = resolve;
    });
  }

  consumes(event: Completion): boolean {
    if (event.turnId !== this.turnId) return false;
    this.ended();
    return event.outcome !== 'failed';
  }

  expectedExit(event: TimelineEvent): boolean {
    return (
      this.retiring &&
      event.t === 'turn.completed' &&
      event.turnId === this.turnId &&
      event.error?.source === 'process_exit'
    );
  }
}
