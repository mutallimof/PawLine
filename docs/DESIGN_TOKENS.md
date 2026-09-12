# PawLine Design Tokens

Status: **proposed — not yet implemented in code.**

This is a reference for the semantic design tokens approved to replace the
hardcoded colors, spacing, radii, font sizes, font families, and shadows
currently scattered across `src/styles/index.css` (2,325 lines) and inline
`style={{}}` blocks in 24 TSX files. Values below are final; wiring them
into the codebase is a separate follow-up pass.

See [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) for the existing raw CSS custom
properties (`--coral`, `--radius-sm`, etc.) these tokens are renaming and
consolidating.

## Color

30 raw values exist today, several duplicated by hand as hex and again as
loose `rgba()` triplets. Consolidated to 20 semantic tokens.

### Brand

| Token | Value | Used in |
|---|---|---|
| `color-brand` | `#e85d4a` | Primary buttons, FAB, active nav icon, unread dot |
| `color-brand-strong` | `#c2402f` | Pressed states, secondary-button text, active tab label |
| `color-brand-subtle` | `#fceae6` | Secondary-button fill, active chip, hover tint |

### Surface & text

| Token | Value | Used in |
|---|---|---|
| `color-bg-app` | `#faf3ee` | App background, behind every page |
| `color-bg-surface` | `#fef9f3` | Cards, list rows, modals, inputs, bottom nav — merges old `--card` (`#fffdfb`) and `--paper` |
| `color-bg-surface-alt` | `#f1e4dc` | Segmented-control track, skeleton loading base |
| `color-border-default` | `#eeddd4` | Hairline dividers, input borders, chip borders |
| `color-border-hairline` | `rgba(238,221,212,.7)` | Card outline, bottom-nav pill border (on translucent surfaces) |
| `color-text-primary` | `#33241f` | Headings, primary body copy |
| `color-text-secondary` | `#7d6a62` | Captions, meta rows, subtitles |
| `color-text-on-brand` | `#ffffff` | Text/icons on colored fills — buttons, badges, FAB, chat bubble (~25 uses) |
| `color-disabled-bg` | `#dbc9c2` | Disabled primary-button fill |

### Case status (open → progress → en route → resolved)

| Token | Value | Used in |
|---|---|---|
| `color-status-open` | `#d93a2b` | Open-case pill, map pin ring, urgent badge |
| `color-status-open-subtle` | `#fdeae7` | Open-case card wash |
| `color-status-open-strong` | `#a82415` | Waiting-on-vet label, cluster-pin text |
| `color-status-progress` | `#e09b26` | Accepted / vet-stage pill |
| `color-status-progress-subtle` | `#fdf3e2` | Progress-case card wash |
| `color-status-progress-strong` | `#9c6a12` | Progress text-on-tint |
| `color-status-enroute` | `#3f7fae` | Vet pin, "moving" pill — also hand-duplicated in `maps.tsx:541,543` |
| `color-status-enroute-subtle` | `#e9f2f8` | En-route card wash, vet avatar background |
| `color-status-enroute-strong` | `#2b5c81` | En-route text-on-tint |
| `color-status-resolved` | `#3f9b6c` | Resolved pill, success accents |
| `color-status-resolved-subtle` | `#e8f5ee` | Resolved-case card wash, "always open" vet tag |
| `color-status-resolved-strong` | `#2b7350` | Resolved text-on-tint, "open now" vet-hours label |

### Feedback, overlay & focus

| Token | Value | Used in |
|---|---|---|
| `color-feedback-success-bg` | `rgba(63,155,108,.12)` | Success banner fill (resolution celebration) |
| `color-feedback-warning-bg` | `rgba(224,155,38,.14)` | Warning banner fill |
| `color-feedback-warning-text` | `#a06d10` | Warning banner text |
| `color-overlay-scrim` | `rgba(51,36,31,.5)` | Modal backdrop, blurred-photo reveal overlay — was 3 different alphas |
| `color-focus-ring` | `rgba(232,93,74,.4)` | Keyboard-focus outline and input focus ring — was 2 different values |

*Not tokenized by design:* the sender-avatar hash palette in `CaseChatPage.tsx`
and the XP tier-badge colors in `xp.ts` stay as local constants — they're
categorical/data-driven, not brand palette.

## Spacing

126 padding/margin/gap declarations in `index.css` and 71 in inline styles —
**none** currently reference a variable. Consolidated onto an
8-point-adjacent scale (25+ ad-hoc values in, 8 tokens out).

| Token | Value | Absorbs |
|---|---|---|
| `space-2xs` | 4px | 2, 3, 4px — icon gaps, badge padding |
| `space-xs` | 8px | 6, 7, 8, 9px — chip/tag padding, tight gaps |
| `space-sm` | 12px | 10, 11, 12, 13px — card body padding, list-row gap |
| `space-md` | 16px | 14, 16px — page gutters, card padding |
| `space-lg` | 20px | 18, 20px — sheet padding, section gaps |
| `space-xl` | 24px | 22, 24, 26px — modal padding, empty-state padding |
| `space-2xl` | 32px | 28, 32px — spinner margin, onboarding gaps |
| `space-3xl` | 48px | 42, 44, 46, 48px — empty-state top padding |

## Radius

52 of 74 declarations are hardcoded — mostly `50%` and `999px` repeated by
hand. Five bespoke four-value radii (the "hand-placed" wobbly cards) are
kept as inline art direction, not tokens.

| Token | Value | Used in |
|---|---|---|
| `radius-sm` | 12px | Buttons, inputs, list rows, chips |
| `radius-md` | 18px | Default card radius, map corners |
| `radius-lg` | 24px | Modal sheets, hero cards, danger zone |
| `radius-pill` | 999px | Status badges, chips, toast, bottom nav (~12 places) |
| `radius-circle` | 50% | Avatars, FAB, map pins, dots (~15 places) |

## Typography

### Font family — already consistent, formalizing only

| Token | Value |
|---|---|
| `font-family-display` | `'Fraunces', 'Georgia', serif` |
| `font-family-body` | `'Noto Sans', system-ui, sans-serif` |

### Text scale

89 font-size declarations in CSS, 33 in inline styles — 0 use a variable.
~40 distinct values collapse to 8 steps (no separate "md" — 13px snaps to
12 or 14 depending on context).

| Token | Value | Absorbs |
|---|---|---|
| `font-size-2xs` | 10px | 10, 10.5px — nav labels, tags |
| `font-size-xs` | 11px | 11, 11.5px — timestamps, section labels |
| `font-size-sm` | 12px | 12, 12.5, 13px — captions, badges |
| `font-size-base` | 14px | 13.5, 14, 14.5px — body copy, buttons |
| `font-size-lg` | 16px | 15, 15.5, 16, 17px — field text, list titles |
| `font-size-xl` | 20px | 19, 20px — case-detail heading |
| `font-size-2xl` | 24px | 22, 24px — sub-headings |
| `font-size-3xl` | 28px | 26, 27, 28px — page titles |

### Display & hero scale

| Token | Value | Used in |
|---|---|---|
| `font-size-display-sm` | 32px | 30, 34px — impact-page hero title |
| `font-size-display-md` | 44px | 40, 42, 44, 48px — onboarding icon, empty-state icon |
| `font-size-display-lg` | 64px | 64, 76px — onboarding hero icon |
| `font-size-title` | `clamp(26px, 7vw, 34px)` | `.page-title` — fluid, kept as-is |
| `font-size-hero-md` | `clamp(36px, 11vw, 48px)` | Impact-page stat numbers |
| `font-size-hero-lg` | `clamp(40px, 12vw, 56px)` | Case-resolution arrival title |
| `font-size-hero-xl` | `clamp(56px, 18vw, 84px)` | Impact-page hero stat — merges 82px/84px max variants |

## Shadow

44 declarations, 24 hardcoded. Two named shadow families overlapped in the
CSS (a flat warm-ink set and a later layered set) and a third,
`--depth-card`, had quietly won the cascade on cards. All three fold into
one three-step scale, plus a dedicated focus token.

| Token | Value | Used in |
|---|---|---|
| `shadow-sm` | `0 2px 8px rgba(90,50,35,.07)` | Bell icon, active segmented tab, small floating controls |
| `shadow-md` | `0 1px 1px rgba(120,74,52,.05), 0 3px 6px rgba(120,74,52,.08), 0 10px 22px rgba(120,74,52,.10)` | Default card, list row, paw-trail, modal sheet — replaces `--shadow-ink` and `--depth-card` |
| `shadow-lg` | `0 2px 4px rgba(120,74,52,.08), 0 8px 18px rgba(120,74,52,.12), 0 20px 40px rgba(120,74,52,.16)` | Card hover/lift, toast, floating bottom nav, dragged states |
| `shadow-focus` | `0 0 0 3px rgba(232,93,74,.4)` | Keyboard focus outline, input focus ring — was 2 separate values |

## Decisions made while building this table

1. **`color-bg-surface`** merges the old `--card` (`#fffdfb`) and `--paper`
   (`#fef9f3`) into one value — the paper tone, since the CSS comments
   describe it as the intended replacement for the near-white card color.
   The difference is a couple of points of warmth, not visible side by side.
2. **`shadow-md`** and **`shadow-lg`** absorb `--depth-card`, not just the
   two named "ink" shadows — it was overriding them on `.card` and
   `.case-card` already, so keeping it separate would have meant a fourth,
   uncounted shadow. Its subtle inset top-highlight is dropped in the
   merge; flag if that sheen should survive as a fifth token instead.
3. Sender-avatar hash colors (`CaseChatPage.tsx`) and XP tier-badge colors
   (`xp.ts`) stay as local constants — categorical data, not brand palette.
4. The five hand-placed asymmetric card radii stay inline — they're the
   app's deliberate "wobbly, hand-drawn" art direction, not a reusable
   system value.

**Reference only — implementation is a separate step.**
