# Thunder Accounting — Round-3 product visual system

## Product

- The product is a lightweight desktop ledger for recording daily income and spending.
- The visual system applies to authentication, the app shell, overview, bills, statistics, categories, profile, settings, dialogs, tables, and forms.
- Existing CloudBase/Electron behavior, bilingual copy, keyboard semantics, and local/cloud data contracts are preserved while the presentation layer is unified.

## Aurora compilation

- Light theme compiles to `--bg: paper`, `--bg-card: ink-on-paper`, `--text: ink`, and `--accent: gold`.
- Dark theme compiles to `--bg: charcoal`, `--bg-card: night`, `--text: night-text`, and the same gold accent family.
- Components must consume semantic CSS variables (`--bg`, `--bg-card`, `--border`, `--text`, `--text2`, `--accent`, `--accent-h`, `--accent-dim`) or an explicit component token. Raw blue/primary utility classes and blue SVG literals are not permitted.
- Focus, selected, progress, action, and chart accents all consume the accent token; status colors remain limited to success, warning, and danger tokens.

## Components and states

- Buttons: default, hover, active, focus-visible, disabled.
- Inputs: default, focus-visible, invalid, disabled; invalid state takes precedence over focus decoration.
- Async surfaces: loading, empty, success, error, and recoverable retry.
- Navigation and selectors: default, selected, hover, keyboard focus, and dark-theme equivalents.
- Responsive states: 640px mobile, 1024px tablet, and desktop; no horizontal overflow and no shell-side geometry drift.
- Theme states: light by default, persisted dark mode, and reduced motion.

## Direction

- Surface: product / operate — one consistent system across auth, dashboard, bills, statistics, category management, personal center, settings, dialogs, tables, and forms.
- Direction: the round-3 demo is the only visual baseline. Light default uses paper/ink/gold; dark mode uses charcoal/night/gold. No legacy blue auth styling is part of the product system.
- UX dials: low visual noise, strong form hierarchy, 1px warm borders, compact rounded cards, readable gold actions, explicit focus/error states, and restrained motion.

## Tokens

- Light: `--paper` / `--ink` / `--gold` with `--line` and `--muted` for supporting surfaces.
- Dark: `--charcoal` / `--night` / `--gold` with `--dark-line` and `--night-text`.
- Product components consume the existing `--bg`, `--bg-card`, `--border`, `--text`, `--text2`, and `--accent` aliases so business markup does not need to change.

## Responsive contract

- Desktop: two-column brand/context rail and focused form panel.
- Tablet: centered panel with reduced spacing and preserved touch targets.
- Mobile: single-column transparent panel on a quiet canvas; no horizontal overflow.
- Breakpoints: 640px / 1024px. Reduced motion removes ornamental and interaction animation.

## Accessibility contract

Every form control keeps its explicit label and existing testable semantics. Interactive elements retain visible `:focus-visible` rings, touch targets remain at least 44px, and the duplicate heading landmark was removed.
