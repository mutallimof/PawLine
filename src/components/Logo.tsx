/**
 * Stray's Call logo — the ONE place the brand mark is drawn in the app.
 *
 * Placeholder concept from the v3 style board (a "call" speech bubble
 * holding a paw, on a plum tile); the designer may replace it. To swap it,
 * change the artwork below and the matching static icons in public/
 * (favicon.svg, apple-touch-icon.png, pwa-192/512, pwa-512-maskable), which
 * are drawn from the same shapes.
 *
 * Three colours, four bold paw shapes — legible at 32px. Colours come from
 * the tokens (inline style, since SVG presentation attributes can't read
 * CSS variables). Decorative by default; pass `title` when it stands alone
 * as the only label.
 */
export function BrandMark({
  className,
  size = 32,
  title,
}: {
  className?: string;
  size?: number;
  title?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      {...(title ? { role: 'img', 'aria-label': title } : { 'aria-hidden': true })}
    >
      <rect width="64" height="64" rx="15" style={{ fill: 'var(--anchor)' }} />
      <path
        d="M32 12c-12.2 0-22 8.1-22 18.2 0 5.6 3 10.6 7.8 14L15.5 53l11.2-5.6c1.7.4 3.5.6 5.3.6 12.2 0 22-8.1 22-18.2S44.2 12 32 12z"
        style={{ fill: 'var(--lemon)' }}
      />
      <g style={{ fill: 'var(--anchor)' }}>
        <ellipse cx="25.2" cy="24.6" rx="3.1" ry="3.7" />
        <ellipse cx="32" cy="22.4" rx="3.1" ry="3.7" />
        <ellipse cx="38.8" cy="24.6" rx="3.1" ry="3.7" />
        <path d="M32 28.6c-4.6 0-8.3 4.2-8.3 7.5 0 2.3 1.8 3.4 3.8 3.4 1.7 0 2.7-.9 4.5-.9s2.8.9 4.5.9c2 0 3.8-1.1 3.8-3.4 0-3.3-3.7-7.5-8.3-7.5z" />
      </g>
    </svg>
  );
}
