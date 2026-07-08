/**
 * Leveling / tier system (presentation layer).
 *
 * The raw XP number is truth and lives in the database (awarded by the
 * award_xp trigger when a case resolves: rescuer +50, vet +30, reporter +10).
 * Tier names and thresholds are presentation and live here, so they can be
 * tuned without a migration.
 */
import { t } from '../i18n';

export interface Tier {
  key: 'bronze' | 'silver' | 'gold' | 'platinum';
  minXp: number;
  color: string; // used for the tier badge
}

export const TIERS: Tier[] = [
  { key: 'bronze', minXp: 0, color: '#B0754B' },
  { key: 'silver', minXp: 150, color: '#8C97A6' },
  { key: 'gold', minXp: 400, color: '#D9A035' },
  { key: 'platinum', minXp: 1000, color: '#5D7B8A' },
];

export interface TierProgress {
  tier: Tier;
  next: Tier | null;
  /** 0..1 progress from current tier floor to next tier floor. */
  progress: number;
  xpToNext: number;
}

export function tierForXp(xp: number): TierProgress {
  let tier = TIERS[0];
  for (const candidate of TIERS) {
    if (xp >= candidate.minXp) tier = candidate;
  }
  const idx = TIERS.indexOf(tier);
  const next = TIERS[idx + 1] ?? null;
  const progress = next
    ? Math.min(1, (xp - tier.minXp) / (next.minXp - tier.minXp))
    : 1;
  return { tier, next, progress, xpToNext: next ? next.minXp - xp : 0 };
}

export function tierName(tier: Tier): string {
  return t(`tier.${tier.key}` as const);
}
