/**
 * Admin → Stats: two growth charts, signups and cases over time.
 *
 * Deliberately small: plain elements, no chart library. Each chart is one
 * series, so it has no legend (the title names it), one colour (--coral, which
 * clears 3:1 against --card), bars anchored to a single baseline with a 2px gap,
 * and a readout line that answers "how many on that day/week?" on hover or
 * keyboard focus. The readout sits above the bars so a finger never covers it.
 *
 * Data comes from created_at on profiles and cases, both already readable by
 * an admin (see fetchCreatedAtSince). Buckets are in the viewer's local time.
 * More charts can slot in as more <BarChart> instances later.
 */
import { useEffect, useMemo, useState } from 'react';
import { fetchCreatedAtSince } from '../../lib/api';
import { getLocale, t } from '../../i18n';

type Granularity = 'day' | 'week';

interface Bucket {
  start: Date;
  count: number;
}

const DAYS = 14;
const WEEKS = 12;

/** Local midnight at the start of the bucket containing `d`. */
function bucketStart(d: Date, g: Granularity): Date {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (g === 'week') {
    // Weeks start Monday — (getDay() + 6) % 7 is days since Monday.
    s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  }
  return s;
}

function emptyBuckets(g: Granularity): Bucket[] {
  const n = g === 'day' ? DAYS : WEEKS;
  const step = g === 'day' ? 1 : 7;
  const last = bucketStart(new Date(), g);
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(last);
    start.setDate(last.getDate() - (n - 1 - i) * step);
    return { start, count: 0 };
  });
}

function fill(timestamps: string[], g: Granularity): Bucket[] {
  const buckets = emptyBuckets(g);
  const index = new Map(buckets.map((b, i) => [b.start.getTime(), i]));
  for (const ts of timestamps) {
    const i = index.get(bucketStart(new Date(ts), g).getTime());
    if (i !== undefined) buckets[i].count += 1;
  }
  return buckets;
}

function bucketLabel(b: Bucket, g: Granularity): string {
  const d = b.start.toLocaleDateString(getLocale(), { day: 'numeric', month: 'short' });
  return g === 'week' ? t('admin.chartWeekOf', { date: d }) : d;
}

function BarChart({ title, buckets, g }: { title: string; buckets: Bucket[]; g: Granularity }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const shown = active !== null ? buckets[active] : null;

  return (
    <div className="card admin-chart">
      <div className="admin-chart__head">
        <div className="admin-chart__title">{title}</div>
        <div className="admin-chart__readout" aria-live="polite">
          {shown ? (
            <>
              <strong>{shown.count}</strong> · {bucketLabel(shown, g)}
            </>
          ) : (
            <>
              <strong>{total}</strong> ·{' '}
              {g === 'day' ? t('admin.chartLastDays', { n: DAYS }) : t('admin.chartLastWeeks', { n: WEEKS })}
            </>
          )}
        </div>
      </div>
      <div className="admin-chart__plot" role="group" aria-label={title} onMouseLeave={() => setActive(null)}>
        <span className="admin-chart__max">{max}</span>
        {buckets.map((b, i) => (
          <button
            key={b.start.getTime()}
            type="button"
            className={`admin-chart__col${active === i ? ' active' : ''}`}
            aria-label={`${bucketLabel(b, g)}: ${b.count}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(active === i ? null : i)}
          >
            <span className="admin-chart__bar" style={{ height: `${(b.count / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="admin-chart__axis">
        <span>{bucketLabel(buckets[0], g)}</span>
        <span>{bucketLabel(buckets[buckets.length - 1], g)}</span>
      </div>
    </div>
  );
}

export default function GrowthCharts() {
  const [g, setG] = useState<Granularity>('day');
  const [raw, setRaw] = useState<{ g: Granularity; signups: string[]; cases: string[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRaw(null);
    setFailed(false);
    const since = emptyBuckets(g)[0].start.toISOString();
    Promise.all([fetchCreatedAtSince('profiles', since), fetchCreatedAtSince('cases', since)])
      .then(([signups, cases]) => {
        if (!cancelled) setRaw({ g, signups, cases });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [g]);

  // Keyed on the granularity the data was fetched for, so switching never
  // renders one frame of old timestamps bucketed the new way.
  const series = useMemo(
    () =>
      raw && raw.g === g ? { signups: fill(raw.signups, g), cases: fill(raw.cases, g) } : null,
    [raw, g],
  );

  return (
    <>
      <div className="section-label">{t('admin.chartsTitle')}</div>
      <div className="chip-row" style={{ marginBottom: 12 }}>
        {(['day', 'week'] as const).map((opt) => (
          <button
            key={opt}
            type="button"
            className={`chip${g === opt ? ' active' : ''}`}
            aria-pressed={g === opt}
            onClick={() => setG(opt)}
          >
            {opt === 'day' ? t('admin.chartDaily') : t('admin.chartWeekly')}
          </button>
        ))}
      </div>
      {failed && <div className="empty-state">{t('common.error')}</div>}
      {!failed && !series && <div className="spinner" />}
      {series && (
        <div className="admin-charts">
          <BarChart title={t('admin.chartSignups')} buckets={series.signups} g={g} />
          <BarChart title={t('admin.chartCases')} buckets={series.cases} g={g} />
        </div>
      )}
    </>
  );
}
