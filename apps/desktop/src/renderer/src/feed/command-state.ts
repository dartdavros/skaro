import type { FeedRow } from '@skaro/timeline';
import { t } from '@skaro/ui';

type Command = Extract<FeedRow, { type: 'command' }>['item'];

/** A command's historical failure belongs to that command, never to its action group. */
export function commandState(item: Command, waiting: boolean) {
  if (waiting || item.status === 'queued') return 'waiting';
  if (item.awaitingInput) return 'input';
  if (item.status === 'interrupted') return 'interrupted';
  if (item.status === 'declined') return 'declined';
  if (item.status === 'running') return item.background !== undefined ? 'background' : 'running';
  if (item.status === 'failed' || (item.exitCode !== undefined && item.exitCode !== 0))
    return 'failed';
  if (item.background !== undefined) return 'background';
  return 'ok';
}

export function commandTip(item: Command, kind: ReturnType<typeof commandState>): string {
  if (kind === 'waiting') return t('feed.waiting');
  if (kind === 'input') return t('feed.cmd.inputTip');
  if (kind === 'background') return t('feed.cmd.backgroundTip');
  if (kind === 'running') return t(item.outputLive ? 'feed.cmd.live' : 'feed.cmd.pending');
  if (kind === 'interrupted') return t('feed.cmd.interruptedTip');
  if (kind === 'failed')
    return item.exitCode === undefined
      ? t('feed.file.failed')
      : t('feed.cmd.codeTip', { n: item.exitCode });
  return t('feed.cmd.tip');
}
