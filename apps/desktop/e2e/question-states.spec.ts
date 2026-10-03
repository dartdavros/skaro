import { expect, test } from '@playwright/test';
import { launchApp, tempUserData } from './launch';
import { questionProject } from './question-state-support';
import { compareBaseline } from './layout-baseline';

test('moves to the next question after a choice and keeps choices, custom answers, previews and secret input', async () => {
  const userData = tempUserData();
  questionProject(userData);
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').filter({ hasText: 'Question states' }).click();
    const card = page.locator('.fd-card.question');
    const answer = card.getByRole('button', { name: 'Ответить', exact: true });
    const tab = (name: string) => card.getByRole('tab').filter({ hasText: name });
    const option = (name: string) => card.locator('.option').filter({ hasText: name });
    const picked = card.locator('.option.on:not(.custom)');
    const custom = card.getByPlaceholder('Свой вариант…');
    const baseline = (name: string) =>
      compareBaseline(card, process.env['SKARO_E2E_QUESTION_LAYOUT'], name);
    await expect(card).toBeVisible();
    await expect(tab('Single')).toHaveAttribute('aria-selected', 'true');
    await expect(answer).toBeDisabled();
    await expect(card.locator('.preview')).toHaveText('first preview');
    await baseline('initial');

    // A single choice moves on to the next unanswered question, the answered tab is checked.
    await option('Second').click();
    await expect(card.locator('.preview')).toHaveText('second preview');
    await expect(tab('Multiple')).toHaveAttribute('aria-selected', 'true');
    await expect(tab('Single')).toHaveClass(/done/);
    await tab('Single').click();
    await expect(card.locator('.option.on .title')).toHaveText('Second');
    await baseline('single');
    await custom.fill('Own single');
    await expect(picked).toHaveCount(0);
    await expect(card.locator('.custom.on')).toHaveCount(1);
    await baseline('custom');

    // Several choices do not move the card.
    await tab('Multiple').click();
    await option('Alpha').click();
    await option('Beta').click();
    await custom.fill('Own multiple');
    await expect(tab('Multiple')).toHaveAttribute('aria-selected', 'true');
    await expect(picked).toHaveCount(2);
    await baseline('multiple');
    await custom.fill('');
    await expect(card.locator('.custom.on')).toHaveCount(0);

    // A digit picks the option with that number.
    await tab('Single').click();
    await option('Second').focus();
    await page.keyboard.press('1');
    await expect(tab('Text')).toHaveAttribute('aria-selected', 'true');
    await tab('Single').click();
    await expect(card.locator('.option.on .title')).toHaveText('First');

    await tab('Text').click();
    await custom.fill('Free text');
    await baseline('text');
    await tab('Secret').click();
    const secret = card.locator('.secret input');
    await expect(secret).toHaveAttribute('type', 'password');
    await secret.fill('test-only-secret');
    await expect(answer).toBeEnabled();
    await baseline('secret');
    await card.locator('.eye').click();
    await expect(secret).toHaveAttribute('type', 'text');
    await baseline('revealed');
    await tab('Text').click();
    await expect(custom).toHaveValue('Free text');
    await tab('Multiple').click();
    await expect(picked).toHaveCount(2);
    await expect(custom).toHaveValue('');
    await tab('Secret').click();
    await expect(secret).toHaveAttribute('type', 'text');
    await expect(secret).toHaveValue('test-only-secret');
    await expect(answer).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
