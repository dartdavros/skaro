import { i18n, t } from '@skaro/ui';

/** "4 мин назад", "вчера", "2 дн назад" — times on cards and in lists. */
export function agoLong(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return t('ago.now');
  if (m < 60) return t('ago.min', { n: m });
  if (m < 1440) return t('ago.hour', { n: Math.round(m / 60) });
  const d = Math.round(m / 1440);
  if (d === 1) return t('ago.yesterday');
  if (d < 30) return t('ago.day', { n: d });
  return t('ago.month', { n: Math.round(d / 30) });
}

/** "4 мин", "1 ч", "вчера" — times in dense rows. */
export function agoShort(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 1) return t('agoShort.now');
  if (m < 60) return t('agoShort.min', { n: m });
  if (m < 1440) return t('agoShort.hour', { n: Math.round(m / 60) });
  const d = Math.round(m / 1440);
  return d === 1 ? t('ago.yesterday') : t('agoShort.day', { n: d });
}

const MONTHS: Record<string, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** Short time, and the date ("12 сен") for a week and older (Plan mockup). */
export function agoOrDate(at: number, now = Date.now()): string {
  if (now - at < 7 * 86_400_000) return agoShort(at, now);
  const d = new Date(at);
  const month = (MONTHS[i18n.locale] ?? MONTHS['en']!)[d.getMonth()]!;
  return i18n.locale === 'en' ? `${month} ${d.getDate()}` : `${d.getDate()} ${month}`;
}

/** "4 мин. назад", "сегодня в 15:30", "вчера в 15:30", "28 сен в 15:30" — when a message was sent. */
export function sentAt(at: number, now = Date.now()): string {
  const m = Math.floor(Math.max(0, now - at) / 60_000);
  if (m < 1) return t('ago.now');
  if (m < 60) return t('sent.min', { n: m });
  const d = new Date(at);
  const time = new Intl.DateTimeFormat(i18n.locale, { hour: '2-digit', minute: '2-digit' }).format(
    d,
  );
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000);
  if (days <= 0) return t('sent.today', { time });
  if (days === 1) return t('sent.yesterday', { time });
  const month = (MONTHS[i18n.locale] ?? MONTHS['en']!)[d.getMonth()]!;
  const year = d.getFullYear() === today.getFullYear() ? '' : ` ${d.getFullYear()}`;
  const date =
    i18n.locale === 'en' ? `${month} ${d.getDate()}${year}` : `${d.getDate()} ${month}${year}`;
  return t('sent.date', { date, time });
}
