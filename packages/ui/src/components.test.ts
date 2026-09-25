import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ActionMenu from './components/ActionMenu.svelte';
import EffortSlider from './components/EffortSlider.svelte';
import Segmented from './components/Segmented.svelte';
import Toggle from './components/Toggle.svelte';
import { addMessages, setLocale, t, tn } from './i18n.svelte.ts';

afterEach(() => setLocale('ru'));

describe('Segmented', () => {
  it('marks the chosen option', async () => {
    render(Segmented, {
      props: {
        value: 'board',
        options: [
          { value: 'board', label: 'Доска' },
          { value: 'list', label: 'Список' },
        ],
      },
    });
    const list = screen.getByRole('radio', { name: 'Список' });
    expect(list.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(list);
    expect(list.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Доска' }).getAttribute('aria-checked')).toBe('false');
  });
});

describe('Toggle', () => {
  it('switches on and off', async () => {
    render(Toggle, { props: { label: 'Сначала план' } });
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });
});

describe('EffortSlider', () => {
  const levels = [
    { id: 'low', label: 'Низкое' },
    { id: 'medium', label: 'Среднее' },
    { id: 'high', label: 'Высокое' },
  ];

  it('moves with the arrow keys and resets to the default', async () => {
    render(EffortSlider, { props: { levels, value: 'medium', defaultValue: 'medium' } });
    const slider = screen.getByRole('slider');
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Высокое');
    await fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Высокое');
    await fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    await fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Низкое');
    await fireEvent.click(screen.getByRole('button', { name: /Вернуть по умолчанию/ }));
    expect(slider.getAttribute('aria-valuetext')).toBe('Среднее');
  });
});

describe('ActionMenu', () => {
  it('opens, runs an item and closes; closes on outside click and Esc', async () => {
    let deleted = 0;
    render(ActionMenu, {
      props: {
        items: [
          { label: 'Открыть в терминале', onselect: () => undefined },
          'separator',
          { label: 'Удалить…', danger: true, onselect: () => deleted++ },
        ],
      },
    });
    const trigger = screen.getByRole('button', { name: 'Ещё' });
    await fireEvent.click(trigger);
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить…' }));
    expect(deleted).toBe(1);
    expect(screen.queryByRole('menu')).toBeNull();

    await fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    flushSync();
    expect(screen.queryByRole('menu')).toBeNull();

    await fireEvent.click(trigger);
    await fireEvent.keyDown(document, { key: 'Escape' });
    flushSync();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('i18n', () => {
  it('translates with parameters and falls back to Russian, then to the key', () => {
    addMessages('ru', { 'test.only.ru': 'Только {what}' });
    expect(t('ui.effort.reset', { level: 'Среднее' })).toBe('Вернуть по умолчанию · Среднее');
    setLocale('en');
    expect(t('ui.effort.reset', { level: 'Medium' })).toBe('Reset to default · Medium');
    expect(t('test.only.ru', { what: 'ru' })).toBe('Только ru');
    expect(t('no.such.key')).toBe('no.such.key');
  });

  it('picks plural forms by the locale rules', () => {
    addMessages('ru', {
      'test.files.one': '{n} файл',
      'test.files.few': '{n} файла',
      'test.files.many': '{n} файлов',
    });
    addMessages('en', { 'test.files.one': '{n} file', 'test.files.other': '{n} files' });
    expect([1, 3, 5, 21, 11].map((n) => tn('test.files', n))).toEqual([
      '1 файл',
      '3 файла',
      '5 файлов',
      '21 файл',
      '11 файлов',
    ]);
    setLocale('en');
    expect([1, 2].map((n) => tn('test.files', n))).toEqual(['1 file', '2 files']);
  });
});
