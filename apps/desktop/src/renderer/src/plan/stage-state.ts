// The state of a stage as one line ("План - этапы" mockup, A1): the header of a milestone on
// the plan and the chip of the stage screen say it with the same words.

import { t } from '@skaro/ui';
import type { StageInfo } from '../../../shared/ipc';

export interface StageLine {
  mark: 'plain' | 'accent' | 'ring' | 'error' | 'clock' | 'stop';
  tone: 'plain' | 'bright' | 'error';
  /** The agent works now: the dot pulses. */
  live?: boolean;
  /** Words before the task id. */
  lead: string;
  /** The task the state is about, shown in mono. */
  task?: string;
  /** Words after the task id. */
  tail?: string;
}

/** Nothing for a stage that is not started and for a finished one: the progress says it. */
export function stageLine(info: StageInfo): StageLine | undefined {
  const count = t('plan.progress', { done: info.finished, total: info.total });
  const task = info.task ? { task: info.task } : {};
  switch (info.state) {
    case 'running':
      return {
        mark: 'plain',
        tone: 'plain',
        live: true,
        lead: t('plan.state.running'),
        ...task,
        tail: `· ${count}`,
      };
    case 'queued':
      return { mark: 'clock', tone: 'plain', lead: t('plan.state.queued') };
    case 'needs_answer':
      return { mark: 'accent', tone: 'bright', lead: `${t('plan.state.needs_answer')} ·`, ...task };
    case 'stopped':
      return { mark: 'stop', tone: 'plain', lead: `${t('plan.state.stopped')} · ${count}` };
    case 'error':
      return { mark: 'error', tone: 'error', lead: `${t('plan.state.error')} ·`, ...task };
    case 'acceptance':
      return { mark: 'plain', tone: 'plain', live: true, lead: t('plan.state.acceptance') };
    case 'acceptance_needs_answer':
      return { mark: 'accent', tone: 'bright', lead: t('plan.state.acceptanceAnswer') };
    case 'awaiting_merge':
      return { mark: 'ring', tone: 'bright', lead: t('plan.state.awaiting_merge') };
    default:
      return undefined;
  }
}

/** What the button of the stage does now; nothing while it waits for its merge or is done. */
export function stageAction(
  info: StageInfo,
  slotsFree: boolean,
): { action: 'run' | 'stop'; icon: 'play' | 'stopSquare' | 'clock'; label: string } | undefined {
  // A milestone without tasks has nothing to run.
  if (!info.total) return undefined;
  switch (info.state) {
    case 'idle':
      return slotsFree
        ? { action: 'run', icon: 'play', label: t('plan.run') }
        : { action: 'run', icon: 'clock', label: t('plan.run.queue') };
    case 'stopped':
    case 'error':
      return { action: 'run', icon: 'play', label: t('plan.resume') };
    case 'awaiting_merge':
    case 'done':
      return undefined;
    default:
      return { action: 'stop', icon: 'stopSquare', label: t('plan.stop') };
  }
}
