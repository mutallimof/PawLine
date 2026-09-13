/** Small inline SVG icon set — no icon-font dependency, works offline. */

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

export const IconSend = ({ size }: IconProps) => (
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
