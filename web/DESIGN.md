# DESIGN.md: Event Checkin website

Documents the design as implemented in `web/src` (final source). It lives here because the repository root is outside the frontend assignment's write scope.

## Overview

Audience: organisers and attendees of a Sepolia test-toy event who arrive with a browser wallet, and funders who want to see balances before approving anything. The visual character is a calm, light, single-column utility page: warm off-white surfaces, one indigo accent reserved for the primary action and links, and status colours only where a state is shown. Density is moderate (16px rhythm inside cards, 24px between cards) so long addresses, hashes and notices stay readable.

System-wide rules: one page, sections as cards, one filled action per form, every async action reports its state in text, every value shown before a transaction is requested. The current arrangement (CHKN panel, tabs, organiser/attendee panels, all-events list, footer) is this page's layout, not a rule for other pages.

## Colors

Defined in `web/src/styles.css` (`:root`), oklch notation. Primitives are named by hue and never used in components; semantic tokens are the only tier components reference.

| Role token | Value (primitive) | Use |
| --- | --- | --- |
| `--color-bg-page` | `--neutral-50` oklch(97.6% 0.005 80) | page background (`html`) |
| `--color-bg-surface` | `--neutral-0` oklch(99.4% 0.002 80) | cards, inputs, secondary buttons |
| `--color-bg-subtle` | `--neutral-100` oklch(94.5% 0.007 80) | hover fill, neutral badge, pass box |
| `--color-bg-accent-subtle` | `--indigo-100` | info notice |
| `--color-border` / `--color-border-strong` | `--neutral-200` / `--neutral-300` | structural borders (event items, tabs rule, table rows) / inputs and secondary buttons |
| `--color-text-primary` | `--neutral-900` oklch(22% 0.014 80) | body and headings |
| `--color-text-secondary` | `--neutral-500` oklch(52% 0.014 80) | `.muted`, hints, stat labels, table headers, unselected tab |
| `--color-text-on-accent` | `--neutral-0` | text on the primary button |
| `--color-accent-solid` / `-hover` / `-active` | `--indigo-500/600/700` | primary button fill and its states, selected-tab underline |
| `--color-accent-text` | `--indigo-600` | links, selected tab, `<summary>` |
| `--color-focus-ring` | `--indigo-500` | `:focus-visible` outline (2px, offset 2px) |
| `--color-status-success-bg/-text` | `--green-100/700` | Open badge, success notices |
| `--color-status-error-bg/-text` | `--red-100/700` | Closed badge, error notices, field errors, invalid input border |
| `--color-status-warning-bg/-text` | `--amber-100/800` | Ended and Wrong-network badges, warning notices |

Measured rendered contrast is recorded in `docs/validation/frontend-validation.md` §4 (all text pairs ≥ 5.14:1, focus ring ≥ 6.87:1). There is no dark theme and no second accent; do not add either without a reason that two things must be told apart at a glance.

## Typography

- Families: `--font-sans` (system stack: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, …`), `--font-mono` (`ui-monospace, "SF Mono", Menlo, Consolas, …`) for addresses, hashes, pass JSON and inputs of code-like values. No font files are shipped, so weights depend on the platform font; the CSS asks for 400 (body), 550 (labels, buttons, badges) and 600/650 (headings).
- Scale (rem): `--text-xs` 0.8125, `--text-sm` 0.875, `--text-base` 1, `--text-lg` 1.125, `--text-xl` 1.375, `--text-2xl` 1.75. Roles: `h1` 2xl/650 with −0.01em tracking, `h2` xl/600, `h3` lg/600; body base; labels, buttons and notices sm/550 or sm/400; hints, badges, table headers and stat labels xs (labels uppercase with 0.04em tracking).
- Line height: headings `--leading-tight` 1.15, body `--leading-body` 1.5 (unitless).
- Wrapping: headings `text-wrap: balance`; paragraphs `text-wrap: pretty` with `max-width: var(--measure)` (68ch); `code`, `.mono`, `.stats dd`, pass box and link box use `overflow-wrap: anywhere`; badges and buttons `white-space: nowrap`.
- Numbers: `.num` and `.stats dd` use `font-variant-numeric: tabular-nums`. Inputs are 16px so iOS does not zoom. Underlines use `text-underline-position: from-font` and `text-decoration-thickness: from-font`.

## Layout

- Container: `.page`, `max-width: var(--content-max)` (64rem), centred, inline padding `max(16px, safe-area inset)`, vertical `flex` with 24px gaps between sections.
- Spacing scale: `--space-1..8` = 4, 8, 12, 16, 24, 32px. Inside a card: 16px between blocks (`.card`, `.stack`, `form`), 8px inside a field group (`.stack-tight`, `.field`), 12px between adjacent controls (`.row`). Between cards: 24px. Groups are separated by space; borders appear only on inputs, event items and table rows.
- Grids: `.form-grid` and `.stats` use `repeat(auto-fit, minmax(min(100%, 14rem | 11rem), 1fr))`, so columns collapse from the content, not from device breakpoints. `.row` wraps. The header is a wrapping flex row (title block, wallet controls).
- Logical properties throughout (`padding-inline`, `margin-inline`, `inset-inline-start`, `text-align: start`).
- Observed: single column at 320px with no horizontal overflow, two columns of fields at 768px, three at 1280px (screenshots 08, 09, 01). Tables scroll inside `.table-wrap` when narrower than their content.

## Elevation & Depth

Flat with one elevation step: cards use `--shadow-card` (two soft transparent shadows) and no border. Borders carry structure only: inputs and secondary buttons (`--color-border-strong`), event items, the tab rule and table rows (`--color-border`), a selected event item switches its border to the accent. Notices and badges are tinted fills without shadow. No overlays, dialogs or z-stacking beyond the skip link.

## Shapes

Concentric radii: card 16px (`--radius-lg`), buttons, notices, event items and the pass box 10px (`--radius-md`), inputs and small elements 6px (`--radius-sm`), badges pill (999px). Buttons have a 1px border; the primary button's border equals its fill. Nothing is clipped except the `sr-only` utility.

## Components

All in `web/src/components/` unless noted; styles are class-based in `web/src/styles.css`.

- **Button** (`ui.tsx`, `.btn`, `.btn-primary`, `.btn-sm`): `type="button"` by default; `primary` for the one filled action per form; `busy` renders a spinner beside the label and sets `aria-busy`; native `disabled` for genuinely unavailable actions with the reason in visible text beside it. States: hover fill (`@media (hover: hover)`), active fill and `scale(0.96)` under `prefers-reduced-motion: no-preference`, disabled opacity 0.55, `:focus-visible` ring.
- **Notice** (`ui.tsx`, `.notice-{warning,error,success,info}`): icon glyph (aria-hidden) plus text; `role="alert"` only for the error variant.
- **TxStatus** (`ui.tsx`): checking / confirm-in-wallet / pending / confirmed (with `done` label) / error, with an explorer link for the hash. Use one per action.
- **StatusRegion + `announce()`** (`ui.tsx`): a single `role="status"` region rendered from the start; call `announce()` for non-urgent updates (copied, confirmed, failed).
- **CopyButton** (`ui.tsx`): small secondary button "Copy <label>" that announces the result.
- **Field pattern** (`.field`): `<label for>`, input, then either `.hint` or `.error` referenced by `aria-describedby`; `aria-invalid` on failure; forms use `noValidate`, validate on submit and focus the first invalid field.
- **Stats** (`.stats` definition list): uppercase xs labels over tabular values; used for wallet balances, event summaries and pass details.
- **Badge** (`.badge`, `-success`, `-error`, `-warning`): state text always accompanies the colour ("Open", "Closed", "Ended", "Wrong network").
- **Tabs** (`App.tsx`, `.tabs`, `.tab`): `role="tablist"`/`tab`/`tabpanel`, roving tabindex, Arrow/Home/End keys, hash-synced; panels use the `hidden` attribute (guaranteed by `[hidden] { display: none !important }`).
- **Event item and attendee table** (`EventsList.tsx`, `.event-list`, `.event-item`, `table`): summary stats plus a native `<details>` disclosure for the attendee list; table cells' standalone links get a 24px hit area (`td > a`).
- **Pass box** (`OrganiserView.tsx`, `.pass-box`, `.link-box`): subtle fill, pre-wrapped JSON, copy controls and the wrapping link.
- **WalletPanel** (`WalletPanel.tsx`): connect / wallet picker / connected badge with explorer link / "Switch to <network>" / Disconnect, and `WalletPanel.Balances` for the CHKN panel with the Withdraw control.
- **Skip link** (`.skip-link`): visually parked off-canvas until focused; `<main id="main" tabindex="-1">` is the target.

## Do's and Don'ts

- Start a new section as a `.card` with an `<h2>` in its `<header>`; put related controls in `.row`, related fields in `.form-grid`, and values in `.stats`.
- One `primary` button per form; every other action is the neutral button. Never colour a non-interactive element with the accent.
- Every transaction control: read and show the relevant state first, disable with a visible reason when prerequisites (chain, code check, eligibility) fail, simulate before signing, render a `TxStatus`.
- Reference semantic tokens only; add a role token rather than reusing one for a different job (for example do not use `--color-border` as text).
- Keep motion opt-in behind `prefers-reduced-motion: no-preference`; keep a static text cue for every state.
- Do not add web fonts, a dark theme, dialogs or a second accent without a product reason; do not override `hidden` with display classes.
- Recipe for one more page: copy `index.html`, mount a component that returns the skip link, `StatusRegion`, a `.page` with `.site-header` and `<main id="main" className="stack">`, compose `.card` sections from the components above, and load deployment data only through `loadDeployment()` in `src/lib/config.ts`.
