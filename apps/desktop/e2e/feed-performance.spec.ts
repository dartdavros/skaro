import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { longHistory } from './feed-performance-support';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

declare global {
  interface Window {
    feedCull: Map<Element, boolean>;
  }
}

test.skip(noAgents, noAgentsReason);

test('keeps long history, large output and diff usable without changing visible styles', async () => {
  test.setTimeout(120_000);
  const userData = tempUserData();
  const { output } = longHistory(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await page.evaluate(() => {
      const capture = new Map<Element, boolean>();
      window.feedCull = capture;
      document.addEventListener(
        'contentvisibilityautostatechange',
        (event) => {
          if (event.target instanceof Element)
            capture.set(event.target, (event as Event & { skipped: boolean }).skipped);
        },
        true,
      );
    });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setSize(1412, 982);
      win.webContents.setBackgroundThrottling(false);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    const started = Date.now();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').filter({ hasText: 'Long history' }).click();
    const feed = page.locator('.chat .fd-feed');
    const scroller = page.locator('.chat .feed-wrap > .scroller');
    const down = page.locator('.chat .feed-wrap > .down');
    await expect(feed.locator('.fd-text')).toHaveCount(600);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(3);
    const openedMs = Date.now() - started;
    await feed.locator('[data-action-group] > button').click();
    const command = feed.locator('.fd-row-wrap').filter({ hasText: 'large-output' });
    await command.click();
    const result = feed.locator('.fd-output');
    await expect(result).toHaveText(output.split('\n').slice(-40).join('\n'));
    await feed.getByRole('button', { name: 'Показать всё', exact: true }).click();
    await expect(result).toHaveText(output);
    await feed.getByRole('button', { name: 'Свернуть', exact: true }).click();
    const file = feed.locator('button.fd-row').filter({ hasText: 'large.txt' });
    const diffStarted = Date.now();
    await file.click();
    const diff = feed.locator('.fd-diff');
    await expect(diff.locator('.fd-diff-line')).toHaveCount(10_001);
    const diffOpenedMs = Date.now() - diffStarted;
    await expect(diff.locator('.fd-diff-line').last()).toHaveText('+diff-9999');
    await expect.poll(() => diff.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    const geometry = await diff.evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        height: el.clientHeight,
        scrollHeight: el.scrollHeight,
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        font: style.font,
        padding: style.padding,
        background: style.backgroundColor,
      };
    });
    const baselinePath = process.env['SKARO_FEED_PERF_BASELINE'];
    if (baselinePath)
      expect(geometry).toEqual(JSON.parse(readFileSync(baselinePath, 'utf8')).geometry);
    await diff.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(diff.locator('.fd-diff-line').last()).toBeInViewport();
    // Scroll the feed's padding, rather than the diff's independent inner scrollbar.
    await scroller.hover({ position: { x: 10, y: 20 } });
    await page.mouse.wheel(0, -100_000);
    await expect(down).toBeVisible();
    await expect(down).toHaveAccessibleName('К концу диалога');
    await feed.locator('.fd-text').first().scrollIntoViewIfNeeded();
    await expect(feed.locator('.fd-text').first()).toContainText('Reply 0');
    await down.click();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
      .toBeLessThan(3);
    await expect(result).toBeVisible(); // Open command/diff state survived scrolling.
    const culling = () =>
      page.evaluate(() => {
        const entries = [...window.feedCull];
        const count = (cls: string) =>
          entries.filter(
            ([node, skipped]) => node.isConnected && skipped && node.classList.contains(cls),
          ).length;
        return { replies: count('fd-text'), diffChunks: count('fd-diff-chunk') };
      });
    if (process.env['SKARO_FEED_PERF_CULLING'])
      await expect.poll(async () => (await culling()).replies).toBeGreaterThan(500);
    const skipped = await culling();
    const { metrics } = await cdp.send('Performance.getMetrics');
    const report = {
      openedMs,
      diffOpenedMs,
      skipped,
      geometry,
      metrics: Object.fromEntries(
        metrics
          .filter((m) =>
            [
              'Nodes',
              'LayoutCount',
              'LayoutDuration',
              'RecalcStyleDuration',
              'ScriptDuration',
              'JSHeapUsedSize',
            ].includes(m.name),
          )
          .map((m) => [m.name, m.value]),
      ),
    };
    await page.screenshot({ path: join(__dirname, '..', 'test-results', 'long-feed-diff.png') });
    await diff.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+c');
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied.match(/diff-\d+/g)).toHaveLength(10_000);
    expect(copied).toContain('diff-9999');
    await page.evaluate(() => getSelection()?.removeAllRanges());
    const reportPath = process.env['SKARO_FEED_PERF_REPORT'];
    if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
    if (process.env['SKARO_FEED_PERF_CULLING']) expect(skipped.diffChunks).toBeGreaterThan(250);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
