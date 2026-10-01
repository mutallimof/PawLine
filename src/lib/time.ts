/**
 * Date and time formatting for everything the app displays.
 *
 * One formatter for every screen, with our own month names: browsers format
 * Azerbaijani poorly (Intl gives "2026 M09 25"), so no display path relies
 * on toLocale* / Intl.DateTimeFormat. Times are 24-hour in every language.
 * Relative texts ("6 gün əvvəl") come from timeAgo below.
 */
import { getLocale, t, type LocaleCode } from '../i18n';

// Months as they read after a day number: "25 sentyabr", "25 Eylül",
// "25 September", "25 сентября" (Russian takes the genitive).
const MONTHS: Record<LocaleCode, readonly string[]> = {
  az: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  tr: ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};

const toDate = (v: string | Date): Date => (typeof v === 'string' ? new Date(v) : v);
const monthName = (d: Date): string => (MONTHS[getLocale()] ?? MONTHS.en)[d.getMonth()];
const sameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "25 sentyabr" — day and month, no year (chart labels, this year's days). */
export function formatDayMonth(v: string | Date): string {
  const d = toDate(v);
  return `${d.getDate()} ${monthName(d)}`;
}

/** Full date: "25 sentyabr 2026" / "25 Eylül 2026" / "25 September 2026". */
export function formatDate(v: string | Date): string {
  const d = toDate(v);
  return `${formatDayMonth(d)} ${d.getFullYear()}`;
}

/** 24-hour time in every language: "14:05". */
export function clockTime(v: string | Date): string {
  const d = toDate(v);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Local calendar day, for grouping messages under one date separator. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/**
 * Chat day separator: "Bu gün" / "Dünən" / "25 sentyabr", with the year
 * only when it isn't the current one ("25 sentyabr 2025").
 */
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return t('common.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(d, yesterday)) return t('common.yesterday');
  return d.getFullYear() === now.getFullYear() ? formatDayMonth(d) : formatDate(d);
}

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  return t('common.daysAgo', { n: Math.floor(hours / 24) });
}
