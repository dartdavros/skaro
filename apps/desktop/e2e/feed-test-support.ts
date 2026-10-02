import { expect, type Page } from '@playwright/test';

/** Waits until the agent is idle after a turn: the summary line of the latest turn. */
export async function waitTurnEnd(page: Page, count: number): Promise<void> {
  await expect(page.locator('.fd-bar')).toHaveCount(count, { timeout: 10 * 60_000 });
  await expect(page.locator('.fd-bar').last()).not.toHaveClass(/error/);
}

/** Real actions are now hidden behind consecutive-action folds until expanded. */
export async function waitForCommand(page: Page, command: RegExp): Promise<void> {
  await expect
    .poll(
      async () => {
        const headers = page.locator('[data-action-group] > button[aria-expanded="false"]');
        for (const header of await headers.all()) await header.click();
        return page.locator('.fd-row').filter({ hasText: command }).first().isVisible();
      },
      { timeout: 5 * 60_000 },
    )
    .toBe(true);
}
