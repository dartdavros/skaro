// What feed rows and cards can do: provided by the screen that shows the feed (task, chat).

import type { InteractionAnswer } from '@skaro/timeline';
import { getContext, setContext } from 'svelte';
import type { MergeAction, ProposalAction } from '../../../shared/ipc';

export interface FeedActions {
  /** Working folder of the agent: paths are shown relative to it. */
  readonly cwd: string | undefined;
  /** The agent session can take commands now (not after the task is done). */
  readonly interactive: boolean;
  openPath(path: string): void;
  existing(paths: string[]): Promise<string[]>;
  openExternal(url: string): void;
  viewImage(src: string): void;
  stopBackground(id: string): void;
  respond(interactionId: string, answer: InteractionAnswer): Promise<void>;
  merge(interactionId: string, action: MergeAction): Promise<void>;
  revertMerge?(commit: string): Promise<void>;
  /** Starts the run again from where it stopped. */
  restart(): void;
  /** Decides on a chat proposal card (project chat only). */
  proposal?(itemId: string, action: ProposalAction): Promise<void>;
  /** Opens a section of the project: the created milestone, the ADR. */
  openSection?(section: 'plan' | 'docs' | 'tasks'): void;
  /** "Проверить и импортировать": the review screen of an import (ImportReview mockup). */
  reviewImport?(itemId: string): void;
}

const KEY = Symbol('feed');

export function provideFeed(actions: FeedActions): void {
  setContext(KEY, actions);
}

export function useFeed(): FeedActions {
  return getContext<FeedActions>(KEY);
}

/** A clock for live timers: ticks once a second. */
class Clock {
  now = $state(Date.now());
}

export const clock = new Clock();
setInterval(() => {
  clock.now = Date.now();
}, 1000);
