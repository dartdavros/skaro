// System notifications ("Настройки" → "Уведомления"): a task needs an answer, is in review,
// failed, or was merged. Shown only while the Skaro window is not in focus.

import { BrowserWindow, Notification } from 'electron';

export type NotifyKind = 'need' | 'review' | 'error' | 'merged';

/** Settings keys and their defaults (Settings mockup: all on but "merged"). */
export const NOTIFY_DEFAULTS: Record<NotifyKind, boolean> = {
  need: true,
  review: true,
  error: true,
  merged: false,
};

const TEXT: Record<string, Record<NotifyKind, string>> = {
  ru: {
    need: 'Нужен ответ',
    review: 'Задача на ревью',
    error: 'Ошибка запуска',
    merged: 'Изменения влиты',
  },
  en: {
    need: 'Needs an answer',
    review: 'Task in review',
    error: 'Run failed',
    merged: 'Changes merged',
  },
};

interface Deps {
  setting: (key: string) => unknown;
  locale: () => string;
}

export class Notifier {
  private readonly deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  notify(kind: NotifyKind, task: string): void {
    const saved = this.deps.setting(`notify.${kind}`);
    const on = typeof saved === 'boolean' ? saved : NOTIFY_DEFAULTS[kind];
    if (!on || !Notification.isSupported()) return;
    if (BrowserWindow.getAllWindows().some((w) => w.isFocused())) return;
    const sound = this.deps.setting('notify.sound') !== false;
    const title = (TEXT[this.deps.locale()] ?? TEXT['en']!)[kind];
    const notification = new Notification({ title, body: task, silent: !sound });
    notification.on('click', () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.focus();
    });
    notification.show();
  }
}
