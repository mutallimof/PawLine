# PawLine Design System

*The living source of truth for visual decisions. Every value here exists
as a CSS custom property in `src/styles/index.css` (§1, §13, §14) — code
and this document are the same system. Structured so a designer (or a
Figma AI) can recreate it as a Figma library 1:1: tokens → components →
layouts. A starter Figma file generated from these tokens accompanies the
project (see the excellence-pass summary for the link/status).*

## 1. Principles

1. **Calm first, delight second.** The subject is injured animals and
   trust between strangers. Motion communicates state; it never decorates.
2. **Status is the interface.** A case's pipeline stage must be readable
   before a single word: card surfaces, pin rings, badges all speak the
   same four color families.
3. **One thumb, outdoors, in a hurry.** 48px targets, high contrast,
   nothing essential above the fold's reach.
4. **Warmth without cuteness.** Coral/terracotta warmth, serif display
   voice — never mascots or cartoon chrome on functional surfaces.

## 2. Color tokens

### Core palette
| Token | Value | Use |
|---|---|---|
| `--coral` | `#E85D4A` | Primary actions, brand |
| `--coral-deep` | `#C2402F` | Pressed, emphasis, links |
| `--coral-soft` | `#FCEAE6` | Tinted fills, active nav |
| `--grad-coral` | `135° #EF6A4F → #E85D4A → #D84A37` | Primary buttons, FAB |
| `--sand` | `#FAF3EE` | App background (+ fixed radial washes) |
| `--card` | `#FFFDFB` | Card surface |
| `--ink` | `#33241F` | Primary text (warm near-black) |
| `--ink-soft` | `#7D6A62` | Secondary text (4.6:1 on sand) |
| `--line` | `#EEDDD4` | Hairlines |

### Status families — 4 hues × 4 steps
Surfaces use 50/100; solids (rings, dots, badges) use 500; text-on-tint
uses 700 (all 700-on-50 pairs ≥ 4.5:1).

| Family | 50 | 100 | 500 | 700 | Meaning |
|---|---|---|---|---|---|
| open | `#FDEAE7` | `#FBD9D4` | `#D93A2B` | `#A82415` | Needs help |
| progress | `#FDF3E2` | `#FAE6C3` | `#E09B26` | `#9C6A12` | Accepted / vet stages |
| route | `#E9F2F8` | `#D5E6F1` | `#3F7FAE` | `#2B5C81` | En route |
| done | `#E8F5EE` | `#D2EBDD` | `#3F9B6C` | `#2B7350` | Safe at vet |

## 3. Typography
Fonts self-hosted; both verified to render the full Azerbaijani + Turkish
alphabets at the glyph level (ə Ə ğ ı İ ş ç ö ü).

| Role | Font | Size/weight | Notes |
|---|---|---|---|
| Display / page titles | Noto Serif | 26/700 (onboarding), 24/700 (titles) | The brand's voice |
| Body | Noto Sans | 16/400, line 1.5 | Base |
| Emphasis/labels | Noto Sans | 13–15 / 700–800 | Buttons, meta, nav |
| Caption | Noto Sans | 12.5/600 | Hints, timestamps |

## 4. Spacing, shape, elevation
- **Spacing scale (px):** 4 · 8 · 10 · 12 · 16 · 20 · 28 (page gutters 16
  mobile / 28 desktop)
- **Radii:** `--radius-sm` 12 (inputs, small buttons) · `--radius` 18 ·
  `--radius-lg` 24 (cards, maps) · 999 (pills, nav, badges)
- **Elevation:** `--shadow-soft` 0 2 8 rgba(90,50,35,.07) (resting) ·
  `--shadow` 0 4 18 .09 (raised) · `--shadow-lift` 0 10 30 .14 (hover/nav)

## 5. Motion
- `--t-fast` 150ms, `--t-med` 260ms, both `cubic-bezier(.2,.8,.3,1)` —
  quick and springy, never bouncy-toy.
- Named animations: `page-enter` (fade+10px rise), `pulse-dot`/`pulse-ring`
  (urgency breathing on open badges/escalated pins), `float-paw` (empty
  states, brand paw), `shimmer` (skeletons), `trail-fill` (paw trail
  progress), `paw-pop` (resolution burst — fires once, on live transition
  only), `toast-in`.
- **`prefers-reduced-motion: reduce` collapses all of it.** Non-negotiable.

## 6. Component state matrices

### Button (`.btn`) — min-height 48 (40 small)
| State | primary | secondary | ghost | danger |
|---|---|---|---|---|
| Default | grad-coral, white, coral glow shadow | coral-soft bg, coral-deep text | transparent, line border | open-500 bg |
| Hover (pointer) | brightness 1.04, shadow ↑ | bg 100-step | bg coral-soft | brightness 1.04 |
| Active | scale .97 | scale .97 | scale .97 | scale .97 |
| Disabled | 45% opacity, no shadow | same | same | same |
| Loading | label → localized "…ing" string, disabled | — | — | — |
| Focus-visible | 2px coral outline, 2px offset (global rule) | same | same | same |

### Case card (`.case-card`, wallet-style)
| State | Treatment |
|---|---|
| Surface | status-family 50 bg + 100 border, radius-lg |
| Escalated (open >30min) | + 2px open-100 outer ring + "still waiting" pulse-dot label |
| Press | scale .985 |
| Hover (desktop) | translateY(-3px) + shadow-lift |
| Loading | `.skeleton--card` shimmer block (never a bare spinner) |
| Empty feed | floating paw + copy + (no cases is good news) |
| Error | warn banner + Retry button |

### Map pins (§14) — the case IS the pin
| Pin | Spec |
|---|---|
| Photo pin (normal density) | 46px circle photo, 3.5px status-500 ring, pointer tip, shadow; resolved = done ring + ✓ badge + 78% opacity; escalated = pulse-ring |
| Compact dot (>60 visible singles) | 16px status-500 dot, white 2.5px ring; hover ×1.35 |
| Cluster (≥2 within 56px) | count pill, card bg; contains-open → open-500 ring + open-700 text; tap = zoom to bounds |
| Vet | 34px white rounded-square, route-500 border, coral `+` — never clustered with cases |
| Rescuer (en-route) | 🚗 with drop shadow |

### Inputs
Default: card bg, 1.5px line border, 48px min-height. Focus: coral border +
3px 14%-coral halo. Password fields: trailing 38px eye toggle. Error:
message via warn banner adjacent (inline field-level errors reserved for
future forms with >4 fields).

### Status badge
Pill, family-500 dot (`::before`) + 700 text on 50 tint; open state's dot
breathes (`pulse-dot`).

## 7. Layout specs
- **Mobile (<1024):** single column, `--page-max` 640; floating glass-pill
  bottom nav (blur 14, radius 999, safe-area inset) with raised grad-coral
  report FAB; content bottom padding clears it.
- **Desktop (≥1024):** 264px sticky sidebar (brand, Report CTA, nav,
  tagline foot) + main column max 720 — except Home: full-width board,
  `minmax(360px,440px)` scrolling feed | sticky live map, toggle hidden
  (both panes visible).
- **Onboarding:** full-screen sand overlay, icon 76 float, dots, primary
  advance + link-skip.

## 8. Iconography & imagery
Feather-style 2px stroke set (`Icons.tsx`) + intentional emoji for warmth
(animals, paw, clinic) — consistent 19–21px in nav/rows. Case photos are
the imagery; no decorative illustration on functional screens (per
reference direction), the paw glyph is the only brand mark.

## 9. Accessibility contract
- Global `:focus-visible` coral outline; all tap targets ≥44px
  (buttons 48); emoji-only buttons carry `aria-label`s
- Text contrast ≥4.5:1 on every token pairing above (700-on-50 verified)
- Status never encoded by color alone: badge text + pin ✓/pulse + labels
- `role="alert"` on error banners; onboarding is `role="dialog"` +
  `aria-modal`; skeletons `aria-hidden`
- Full `prefers-reduced-motion` collapse; `<html lang>` tracks locale

## 10. Voice
Short, warm, literal. Errors say what to DO next ("drag the map to set the
spot"), never blame, never jargon. All three locales are first-class:
labels are written to survive Azerbaijani/Turkish length (+~30% vs
English) — components must not truncate meaning, only overflow gracefully.
