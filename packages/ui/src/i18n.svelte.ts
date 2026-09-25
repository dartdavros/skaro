// Minimal ru/en localization shared by the UI kit and the app (plan: stage 4).

export type Locale = 'ru' | 'en';
export type Dictionary = Record<string, string>;

const dictionaries: Record<Locale, Dictionary> = { ru: {}, en: {} };

class I18n {
  locale = $state<Locale>('ru');
}

export const i18n = new I18n();

/** Adds translations; later calls override earlier keys. */
export function addMessages(locale: Locale, messages: Dictionary): void {
  Object.assign(dictionaries[locale], messages);
}

export function setLocale(locale: Locale): void {
  i18n.locale = locale;
}

/** `t('tabs.close')`, `t('tasks.count', { n: 3 })`. Falls back to Russian, then to the key. */
export function t(key: string, params?: Record<string, string | number>): string {
  const text = dictionaries[i18n.locale][key] ?? dictionaries.ru[key] ?? key;
  return params
    ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
    : text;
}

const pluralRules: Record<Locale, Intl.PluralRules> = {
  ru: new Intl.PluralRules('ru'),
  en: new Intl.PluralRules('en'),
};

/**
 * Plural forms: `tn('feed.files', 6)` picks `feed.files.one|few|many|other` by the locale's rules
 * and fills `{n}` (and other params).
 */
export function tn(key: string, n: number, params?: Record<string, string | number>): string {
  const form = pluralRules[i18n.locale].select(n);
  const dict = dictionaries[i18n.locale];
  const exact = `${key}.${form}`;
  const chosen =
    exact in dict || exact in dictionaries.ru
      ? exact
      : `${key}.other` in dict
        ? `${key}.other`
        : `${key}.many`;
  return t(chosen, { n, ...params });
}

/** Built-in texts of the UI kit. */
addMessages('ru', {
  'ui.close': 'Закрыть',
  'ui.closeEsc': 'Закрыть · Esc',
  'ui.cancel': 'Отмена',
  'ui.hide': 'Скрыть',
  'ui.more': 'Ещё',
  'ui.effort': 'Усилие',
  'ui.effort.hint': 'Усилие — сколько агент рассуждает перед ответом',
  'ui.effort.reset': 'Вернуть по умолчанию · {level}',
  'tabs.close': 'Закрыть вкладку',
  'tabs.open': 'Открыть проект',
  'tabs.home': 'Главная — все проекты',
  'status.working': 'Агент работает',
  'status.attention': 'Требует вашего внимания',
  'status.error': 'Ошибка запуска',
  'status.blocked': 'Заблокирована',
  'nav.collapse': 'Свернуть панель',
  'nav.expand': 'Развернуть панель',
  'card.select': 'Выделить',
  'card.unselect': 'Снять выделение',
  'window.settings': 'Настройки',
  'window.minimize': 'Свернуть',
  'window.maximize': 'Развернуть',
  'window.restore': 'Восстановить',
  'window.close': 'Закрыть',
});

addMessages('en', {
  'ui.close': 'Close',
  'ui.closeEsc': 'Close · Esc',
  'ui.cancel': 'Cancel',
  'ui.hide': 'Hide',
  'ui.more': 'More',
  'ui.effort': 'Effort',
  'ui.effort.hint': 'Effort — how much the agent reasons before answering',
  'ui.effort.reset': 'Reset to default · {level}',
  'tabs.close': 'Close tab',
  'tabs.open': 'Open project',
  'tabs.home': 'Home — all projects',
  'status.working': 'Agent is working',
  'status.attention': 'Needs your attention',
  'status.error': 'Run failed',
  'status.blocked': 'Blocked',
  'nav.collapse': 'Collapse panel',
  'nav.expand': 'Expand panel',
  'card.select': 'Select',
  'card.unselect': 'Unselect',
  'window.settings': 'Settings',
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
});
