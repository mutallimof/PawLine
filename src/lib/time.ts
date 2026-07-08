/** Relative time formatting for feed cards, chat and notifications. */
import { t } from '../i18n';

export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return t('common.justNow');
  if (mins < 60) return t('common.minAgo', { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('common.hoursAgo', { n: hours });
  return t('common.daysAgo', { n: Math.floor(hours / 24) });
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
