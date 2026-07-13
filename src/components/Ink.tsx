/**
 * "The Hand That Helps" — the ink illustration system.
 *
 * Direction A's core idea: warmth comes from CRAFT (visible hand, imperfect
 * line, ink texture), never from cuteness (no mascot face — the paw is a
 * character through mark-making and behaviour, not eyes). Every path here is
 * deliberately slightly irregular: variable stroke weight, a little wobble,
 * organic bézier curves rather than geometric ones. On a screen that shows
 * injured animals, a smiling cartoon would be wrong; an honest inked mark
 * reads as "a real person made this, and a real person will come."
 *
 * All marks use `currentColor` so they inherit ink color from context, and
 * carry a subtle roughen via a shared SVG filter. Respects reduced-motion
 * (the draw-on animations are opt-in per component).
 */
import type { CSSProperties } from 'react';

/**
 * Shared SVG defs: a gentle displacement filter that gives vector paths a
 * hand-inked edge (the "human fingerprint" the 2026 research kept pointing
 * to). Mounted once, referenced by url(#ink-rough).
 */
export function InkDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <filter id="ink-rough" x="-20%" y="-20%" width="140%" height="140%">
          {/* Low-frequency turbulence + small displacement = a pen that isn't
              perfectly steady. Kept subtle so it reads as craft, not glitch. */}
          <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
        </filter>
        <filter id="ink-rough-strong" x="-25%" y="-25%" width="150%" height="150%">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="3" result="n" />
          <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4" />
        </filter>
      </defs>
    </svg>
  );
}

type PawProps = {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Draw-on animation (used at emotional moments, not everywhere). */
  animate?: boolean;
  title?: string;
};

/**
 * The paw mark — hand-inked, asymmetric on purpose. One pad is a touch larger,
 * the toes aren't evenly spaced. Perfect symmetry is what makes a paw read as
 * a corporate icon; this reads as drawn.
 */
export function Paw({ size = 40, className = '', style, animate = false, title }: PawProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={`ink ${animate ? 'ink--draw' : ''} ${className}`}
      style={style}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      fill="currentColor"
    >
      <g filter="url(#ink-rough)">
        {/* main pad — slightly lopsided teardrop */}
        <path d="M32 34c-7.2 0-12.4 4.9-12.4 10.7 0 5.2 4.9 8.1 12.4 8.1s12.7-2.7 12.7-8.1C44.7 39 39.3 34 32 34z" />
        {/* toe pads — uneven sizes and spacing, like a real print */}
        <ellipse cx="18.5" cy="27.5" rx="5.2" ry="6.6" transform="rotate(-16 18.5 27.5)" />
        <ellipse cx="26.5" cy="19" rx="5" ry="6.9" transform="rotate(-6 26.5 19)" />
        <ellipse cx="37" cy="18.6" rx="5.1" ry="7" transform="rotate(7 37 18.6)" />
        <ellipse cx="45.8" cy="27" rx="5.3" ry="6.5" transform="rotate(17 45.8 27)" />
      </g>
    </svg>
  );
}

/**
 * A short inked trail of paw prints, fading in sequence — the app's heartbeat
 * motif. Used in loading and empty states. Each print is nudged off the line
 * so the trail wanders like a real one rather than marching in a rule.
 */
export function PawTrailInk({ count = 4, size = 26 }: { count?: number; size?: number }) {
  const prints = Array.from({ length: count });
  const wobble = [0, -4, 3, -2, 5, -3]; // vertical wander, deterministic
  const rot = [-12, 8, -6, 14, -9, 5];
  return (
    <div className="paw-trail-ink" aria-hidden="true">
      {prints.map((_, i) => (
        <Paw
          key={i}
          size={size}
          className="paw-trail-ink__print"
          style={{
            transform: `translateY(${wobble[i % wobble.length]}px) rotate(${rot[i % rot.length]}deg)`,
            animationDelay: `${i * 180}ms`,
            opacity: 0.25 + (i / count) * 0.75,
          }}
        />
      ))}
    </div>
  );
}

/**
 * Illustrated empty-state vignettes — small inked scenes, not icons. Emotion
 * via subject and posture (per the Headspace principle), never a face.
 * `kind` picks the scene so empty states across the app feel authored.
 */
export function InkScene({ kind, size = 132 }: { kind: EmptyKind; size?: number }) {
  return (
    <svg
      viewBox="0 0 200 160"
      width={size}
      height={size * (160 / 200)}
      className="ink ink-scene"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
    >
      <g filter="url(#ink-rough)" strokeLinecap="round" strokeLinejoin="round">
        {SCENES[kind]}
      </g>
    </svg>
  );
}

export type EmptyKind = 'calm' | 'search' | 'done' | 'offline' | 'lost';

// Each scene is loose line-work; stroke width varies per element to feel inked.
const SCENES: Record<EmptyKind, JSX.Element> = {
  // No open cases — a good thing: a bowl at rest, a wandering paw trail.
  calm: (
    <>
      <path d="M62 108c0-11 12-18 28-18s28 7 28 18" strokeWidth="3.2" />
      <path d="M58 108h64" strokeWidth="3.6" />
      <path d="M74 108c2 8 8 12 16 12s14-4 16-12" strokeWidth="2.4" opacity="0.7" />
      <g strokeWidth="0" fill="currentColor" opacity="0.55">
        <ellipse cx="140" cy="70" rx="3.6" ry="4.6" transform="rotate(12 140 70)" />
        <ellipse cx="150" cy="62" rx="3.4" ry="4.4" transform="rotate(4 150 62)" />
        <ellipse cx="156" cy="72" rx="3.5" ry="4.5" transform="rotate(18 156 72)" />
        <path d="M143 82c-4 0-7 2.6-7 5.6 0 2.7 3 4.2 7 4.2s7-1.5 7-4.2c0-3-3-5.6-7-5.6z" />
      </g>
    </>
  ),
  // Searching / loading — a magnifier over a paw print.
  search: (
    <>
      <circle cx="86" cy="74" r="30" strokeWidth="3.4" />
      <path d="M108 96l20 20" strokeWidth="4.2" />
      <g strokeWidth="0" fill="currentColor" opacity="0.75">
        <ellipse cx="80" cy="70" rx="3.4" ry="4.4" transform="rotate(-10 80 70)" />
        <ellipse cx="88" cy="66" rx="3.3" ry="4.4" />
        <ellipse cx="95" cy="71" rx="3.4" ry="4.3" transform="rotate(12 95 71)" />
        <path d="M83 80c-4.5 0-7.8 3-7.8 6.4 0 3 3.3 4.8 7.8 4.8s7.8-1.8 7.8-4.8c0-3.4-3.3-6.4-7.8-6.4z" />
      </g>
    </>
  ),
  // Resolved / safe — an open door with warmth spilling out, a heart.
  done: (
    <>
      <path d="M74 118V52c0-4 3-7 7-7h38c4 0 7 3 7 7v66" strokeWidth="3.4" />
      <path d="M64 118h84" strokeWidth="3.8" />
      <circle cx="112" cy="86" r="2.6" fill="currentColor" strokeWidth="0" />
      <path
        d="M100 74c-3-6-12-5-12 2 0 6 12 12 12 12s12-6 12-12c0-7-9-8-12-2z"
        strokeWidth="2.6"
        transform="translate(0 -30) scale(0.9)"
        style={{ transformOrigin: '100px 74px' }}
      />
      <path d="M150 60l4 6 6-4-3 7 7 2-7 2 3 7-6-4-4 6-2-7-7 1 5-6-5-6 7 1z" strokeWidth="1.8" opacity="0.6" />
    </>
  ),
  // Offline — a cloud with a gentle dashed line.
  offline: (
    <>
      <path
        d="M70 96c-9 0-16-6.5-16-15 0-8 6.5-14 14.5-14.5C71 56 80 50 90 50c12 0 21 8.5 22.5 20 8 .5 13.5 6 13.5 13.5 0 7-6 12.5-14 12.5z"
        strokeWidth="3.2"
      />
      <path d="M64 116h16M92 116h16M120 116h14" strokeWidth="3" opacity="0.55" strokeDasharray="2 10" />
    </>
  ),
  // Not found (404) / lost — a signpost with a paw, pointing nowhere certain.
  lost: (
    <>
      <path d="M100 120V58" strokeWidth="3.6" />
      <path d="M100 66h34l8 8-8 8h-34" strokeWidth="3.2" />
      <path d="M100 92H70l-8 8 8 8h30" strokeWidth="3.2" opacity="0.75" />
      <g strokeWidth="0" fill="currentColor" opacity="0.7">
        <ellipse cx="112" cy="74" rx="2.6" ry="3.4" />
        <ellipse cx="118" cy="72" rx="2.6" ry="3.4" />
      </g>
    </>
  ),
};
