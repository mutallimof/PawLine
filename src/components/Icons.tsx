/** Small inline SVG icon set — no icon-font dependency, works offline. */
import { t } from '../i18n';

interface IconProps {
  size?: number;
}

const base = (size = 24) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

/**
 * Google's "G" mark — the one icon in this file NOT drawn in currentColor.
 * Brand marks stay their own fixed colors regardless of the button's theme,
 * same as every other "Continue with Google" button on the web.
 */
export const IconGoogle = ({ size = 18 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 18 18">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.92c1.71-1.57 2.68-3.88 2.68-6.64z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.27c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.71c-.18-.54-.29-1.11-.29-1.71s.11-1.17.29-1.71V4.96H.96C.35 6.17 0 7.55 0 9s.35 2.83.96 4.04l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

export const IconMap = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);

export const IconPlus = ({ size }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.5}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChat = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

export const IconBell = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

export const IconUser = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

/* ---- Figma v2 set (same 24px / stroke-2 base as the rest) ---- */

export const IconGrid = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
  </svg>
);

export const IconChatRound = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
  </svg>
);

export const IconChevronRight = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);

export const IconHelp = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </svg>
);

export const IconSearch = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);

export const IconFilter = ({ size }: IconProps) => (
  <svg {...base(size)} strokeWidth={1.5}>
    <path d="M13 18.5H3M13 5.5H3M11 12h10" />
    <circle cx="18" cy="18.5" r="2.5" />
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
  </svg>
);

export const IconPin = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

export const IconClock = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 3" />
  </svg>
);

export const IconHistory = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5" />
    <path d="M12 7v5l4 2" />
  </svg>
);

export const IconSettings = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconLogOut = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export const IconShield = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

export const IconClinic = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 21h18" />
    <path d="M5 21V8l7-5 7 5v13" />
    <path d="M12 9v5M9.5 11.5h5" />
    <path d="M10 21v-3h4v3" />
  </svg>
);

export const IconBlock = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.6 5.6 12.8 12.8" />
  </svg>
);

export const IconArrowUpRight = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const IconStethoscope =({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M11 2v2M5 2v2" />
    <path d="M5 3H4a2 2 0 0 0-2 2v4a6 6 0 0 0 12 0V5a2 2 0 0 0-2-2h-1" />
    <path d="M8 15a6 6 0 0 0 12 0v-3" />
    <circle cx="20" cy="10" r="2" />
  </svg>
);

/**
 * Marks a vet/clinic account after a display name (chat senders, DM rows,
 * profiles). Unlike the decorative icons it carries meaning, so it is
 * announced as "Vet". Sized in em via .vet-tag to track the name's text.
 */
export const VetTag = () => (
  <span className="vet-tag" role="img" aria-label={t('admin.roleVet')}>
    <IconStethoscope />
  </span>
);

/** The design's brand mark: a paw whose main pad carries a heart. Filled, currentColor. */
export const PawHeartMark = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 28 28" fill="currentColor" aria-hidden="true">
    <ellipse cx="5" cy="11.2" rx="2.9" ry="3.4" transform="rotate(-18 5 11.2)" />
    <ellipse cx="10.4" cy="5.4" rx="3" ry="3.6" transform="rotate(-6 10.4 5.4)" />
    <ellipse cx="17.6" cy="5.4" rx="3" ry="3.6" transform="rotate(6 17.6 5.4)" />
    <ellipse cx="23" cy="11.2" rx="2.9" ry="3.4" transform="rotate(18 23 11.2)" />
    <path
      fillRule="evenodd"
      d="M14 11.6c5.4 0 9.6 4.9 9.6 9.3 0 3.6-2.6 5.6-5.6 5.6-1.6 0-2.8-.6-4-.6s-2.4.6-4 .6c-3 0-5.6-2-5.6-5.6 0-4.4 4.2-9.3 9.6-9.3Zm0 7.1c-.8-1.5-3.6-1.4-3.6.8 0 1.8 2.2 3.3 3.6 4.3 1.4-1 3.6-2.5 3.6-4.3 0-2.2-2.8-2.3-3.6-.8Z"
    />
  </svg>
);

/**
 * Empty-state paw — a clean single-weight outline on a soft lavender disc.
 * Deliberately crisp (no ink filter) and muted: it marks the empty list
 * without competing with the copy under it.
 */
export const EmptyPaw = ({ size = 88 }: IconProps) => (
  <span className="empty-paw" style={{ width: size, height: size }} aria-hidden="true">
    <svg
      width={size / 2}
      height={size / 2}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M32 34c-6.6 0-12.4 5.3-12.4 10.8 0 4.3 3.3 6.6 7.3 6.6 2.1 0 3.3-1 5.1-1s3 1 5.1 1c4 0 7.3-2.3 7.3-6.6C44.4 39.3 38.6 34 32 34z" />
      <ellipse cx="18.5" cy="27" rx="4.2" ry="5.6" transform="rotate(-20 18.5 27)" />
      <ellipse cx="26.5" cy="17.5" rx="4.2" ry="5.8" transform="rotate(-8 26.5 17.5)" />
      <ellipse cx="37.5" cy="17.5" rx="4.2" ry="5.8" transform="rotate(8 37.5 17.5)" />
      <ellipse cx="45.5" cy="27" rx="4.2" ry="5.6" transform="rotate(20 45.5 27)" />
    </svg>
  </span>
);

export const IconSend =({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="m22 2-7 20-4-9-9-4 20-7z" />
  </svg>
);

export const IconCrosshair = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
  </svg>
);

export const IconBack = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="m15 18-6-6 6-6" />
  </svg>
);

export const IconCamera = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const IconCheck = ({ size }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.5}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/** Animal emoji — friendlier than abstract icons for the subject matter. */
export function animalEmoji(animal: 'dog' | 'cat' | 'other'): string {
  return animal === 'dog' ? '🐕' : animal === 'cat' ? '🐈' : '🐾';
}

export const IconEye = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const IconEyeOff = ({ size }: IconProps) => (
  <svg {...base(size)}>
    <path d="M17.94 17.94A10.6 10.6 0 0 1 12 19c-6.5 0-10-7-10-7a18.4 18.4 0 0 1 5.06-5.94" />
    <path d="M9.9 4.24A9.7 9.7 0 0 1 12 4c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
    <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
    <path d="M2 2l20 20" />
  </svg>
);
