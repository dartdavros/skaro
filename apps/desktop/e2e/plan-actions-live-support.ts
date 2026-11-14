import { expect, type Page } from '@playwright/test';
import type { Item } from '@skaro/timeline';
import type { SkaroApi } from '../src/shared/ipc';
declare const window: Window & { skaro: SkaroApi };
type Proposal = Extract<Item, { kind: 'proposal' }>;
export function livePlanChat(page: Page, project: string, chat: string) {
  const read = () =>
    page.evaluate(({ project, chat }) => window.skaro.invoke('chat.open', project, chat), {
      project,
      chat,
    });
  const proposals = async () =>
    (await read()).timeline.items.filter((item): item is Proposal => item.kind === 'proposal');
  const offer = async (kind: Proposal['proposal']['type'], after?: string) => {
    let found: Proposal | undefined;
    await expect
      .poll(
        async () => {
          found = (await proposals()).find(
            (item) => item.proposal.type === kind && item.state === 'pending' && item.id !== after,
          );
          return !!found && (await read()).timeline.status !== 'working';
        },
        { timeout: 180000 },
      )
      .toBe(true);
    return found!;
  };
  return { read, proposals, offer };
}
