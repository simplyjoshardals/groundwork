# DESIGN.md: Groundwork ("Reading Room")

Paste this whole file into every UI prompt. It is the single source of truth for how Groundwork looks and behaves. If a prompt conflicts with this file, say so before building.

**Identity in one line:** a quiet reading room where every claim carries its footnote.
**Hero moment:** click a citation, the page opens, a highlighter pass lands on the cited passage.
**Stack:** Next.js App Router, TypeScript, Tailwind v4 (CSS-first `@theme`), `next/font/google`, $0.

---

## 0. Hard rules (read these even if you read nothing else)

1. Colors come only from the tokens in section 1. No `gray-*`, `neutral-*`, `red-*`, `bg-black`, `bg-white`, no hex in components.
2. Three fonts only: serif for answers and headings, sans for UI, mono for page refs and numbers. Never Arial or system fonts as a design choice.
3. No spinners. Use skeletons shaped like the content that is coming.
4. No layout shift. Reserve space for anything async (answer, sources, viewer, widgets).
5. Errors, refusals, and warnings are three different things. A refusal ("I couldn't find that") is never red.
6. Every interactive element has a visible focus ring, an accessible name, and a 44 px touch target on coarse pointers.
7. Dark mode is its own palette (section 3), not inverted. The PDF page stays paper-colored in dark mode.
8. Animate only `opacity`, `transform`, color, and background-position. Respect reduced motion (section 7).
9. No gradients (the two exceptions are the skeleton shimmer band, section 5.9, and the flat single-colour layer that the highlight wipe animates, section 7, which paints one colour and never a blend), glass, glow effects (except the dark highlight), emoji, pulsing or spinning status indicators, a second icon library (Phosphor only, section 5.11), or icon-only buttons without a label or `aria-label`.
10. Copy follows the voice in section 8: calm, specific, no exclamation marks, no "Oops".

---

## 1. Design tokens

### 1.1 Color tokens (CSS variables)

Contrast ratios below were computed with the WCAG formula. Text pairs all pass AA (4.5:1). Control borders pass the 3:1 non-text rule. Re-check any pair you change.

```css
:root {
  color-scheme: light;

  /* surfaces */
  --bg: #F5F1E8;            /* page: warm paper */
  --surface: #FCFAF4;       /* cards, inputs, header */
  --sunken: #EDE8DB;        /* wells, skeletons, code, disabled */
  --raised: #FFFEFA;        /* dialogs, toasts, popovers */

  /* text */
  --text: #1E1B16;          /* 16.4:1 on surface */
  --muted: #6B645A;         /* 5.6:1 on surface, 4.8:1 on sunken */

  /* lines */
  --border: #E2DBCB;        /* decorative dividers, card edges */
  --control-border: #8C8472;/* input/button outlines, 3.3:1 on bg, 3.6:1 on surface */

  /* brand */
  --accent: #1F5A4A;        /* ink green: links, primary buttons, citation markers (7.7:1 on surface) */
  --accent-hover: #184A3D;
  --accent-fg: #FCFAF4;     /* text on solid accent (7.7:1) */
  --accent-soft: #E3EEE8;   /* tinted fills (accent text on it: 6.7:1) */
  --highlight: #F3D568;     /* the citation highlighter */
  --highlight-soft: rgba(243, 213, 104, 0.45); /* text over it: 14:1 */

  /* status */
  --danger: #A63A22;        /* 6.2:1 on surface */
  --danger-fg: #FCFAF4;
  --danger-soft: #F6E3DC;   /* danger text on it: 5.2:1 */
  --warn: #8A5A00;          /* 5.7:1 on surface */
  --warn-soft: #F5E9CC;     /* warn text on it: 4.9:1 */

  /* focus */
  --focus: #1F5A4A;         /* 7.1:1 on bg */

  /* toast (inverted slab in light mode) */
  --toast-bg: #1E1B16;
  --toast-fg: #F5F1E8;

  /* skeleton shimmer band (section 5.9): an alias of an existing surface, not a new color */
  --skeleton-band: var(--surface);

  /* paper: the page of a document (landing specimen, viewer). One definition,
     never redefined for dark mode: a page stays paper-colored there (section 3). */
  --paper: #FCFAF4;
  --paper-ink: #1E1B16;
  /* the citation highlight where it sits on paper (PDF text layer, text viewer): defined once,
     because --highlight-soft in dark mode is a glow for dark surfaces and would almost vanish on paper */
  --highlight-on-paper: rgba(243, 213, 104, 0.45);

  /* elevation (section 1.5) */
  --shadow-card: 0 1px 2px rgba(30, 27, 22, 0.06), 0 4px 12px rgba(30, 27, 22, 0.05);
  --shadow-pop: 0 2px 6px rgba(30, 27, 22, 0.08), 0 12px 28px rgba(30, 27, 22, 0.10);
  --shadow-sheet: 0 -4px 16px rgba(30, 27, 22, 0.08), 0 24px 48px rgba(30, 27, 22, 0.14);

  /* motion (section 7) */
  --dur-fast: 120ms;
  --dur-base: 180ms;
  --dur-slow: 280ms;
  --dur-sheet: 320ms;
  --dur-highlight: 600ms;
  --ease-paper: cubic-bezier(0.2, 0.7, 0.2, 1);   /* enter */
  --ease-settle: cubic-bezier(0.4, 0, 0.2, 1);    /* move/exit */
}

:root[data-theme="dark"] {
  color-scheme: dark;

  --bg: #151310;
  --surface: #1D1A16;
  --sunken: #110F0C;
  --raised: #25221C;

  --text: #EDE6D6;          /* 13.9:1 on surface; never pure white */
  --muted: #A39B8B;         /* 6.3:1 on surface */

  --border: #302B24;
  --control-border: #7A7364;/* 3.9:1 on bg, 3.7:1 on surface */

  --accent: #7CC4A8;        /* 8.5:1 on surface */
  --accent-hover: #96D2BA;
  --accent-fg: #0F1A15;     /* 8.8:1 on accent */
  --accent-soft: #1F2E28;
  --highlight: #E9C65A;
  --highlight-soft: rgba(233, 198, 90, 0.30); /* a glow: text over it stays 6.6:1 */

  --danger: #E8856B;        /* 6.6:1 on surface */
  --danger-fg: #1A0E0A;
  --danger-soft: #2E1B16;
  --warn: #E0B050;
  --warn-soft: #2B2414;

  --focus: #7CC4A8;

  --toast-bg: #25221C;
  --toast-fg: #EDE6D6;

  --skeleton-band: var(--raised);

  /* dark mode uses surface steps and borders, not shadows.
     Not `none`: inside a box-shadow list it invalidates the whole declaration (rings included). */
  --shadow-card: 0 0 #0000;
  --shadow-pop: 0 0 0 1px #433C32, 0 12px 28px rgba(0, 0, 0, 0.5);
  --shadow-sheet: 0 0 0 1px #433C32, 0 24px 48px rgba(0, 0, 0, 0.6);
}
```

**Theme switching:** one token source. A tiny blocking inline script in `<head>` sets `data-theme` before first paint from a stored choice (`light`, `dark`, or `system` resolved via `prefers-color-scheme`). The choice is stored in `localStorage` under `groundwork-theme`; a missing or unrecognised value means `system`. The script lives in `lib/theme/theme-script.ts` and runs once at load; following OS changes mid-session belongs to the toggle (U2). The root `<html>` gets `suppressHydrationWarning`. There is no `@media (prefers-color-scheme)` duplicate of the dark tokens.

### 1.2 Tailwind v4 config (in `app/globals.css`)

Tailwind v4 is CSS-first: there is no `tailwind.config.js`. Verify these directives against your installed Tailwind version before relying on them.

```css
@import "tailwindcss";

/* dark: variant follows the data attribute, so rare `dark:` overrides still work */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* Remove the default palette, shadows and radii so gray-500, shadow-md or
   rounded-2xl cannot be used by accident. Do not reset `--font-*`: it also
   clears the font-medium / font-semibold weights. */
@theme {
  --color-*: initial;
  --shadow-*: initial;
  --radius-*: initial;
}

@theme inline {
  --color-transparent: transparent;
  --color-current: currentColor;
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-sunken: var(--sunken);
  --color-raised: var(--raised);
  --color-ink: var(--text);
  --color-muted: var(--muted);
  --color-line: var(--border);
  --color-control: var(--control-border);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-fg: var(--accent-fg);
  --color-accent-soft: var(--accent-soft);
  --color-highlight: var(--highlight);
  --color-highlight-soft: var(--highlight-soft);
  --color-danger: var(--danger);
  --color-danger-fg: var(--danger-fg);
  --color-danger-soft: var(--danger-soft);
  --color-warn: var(--warn);
  --color-warn-soft: var(--warn-soft);
  --color-focus: var(--focus);
  --color-toast: var(--toast-bg);
  --color-toast-fg: var(--toast-fg);
  --color-paper: var(--paper);
  --color-paper-ink: var(--paper-ink);

  --font-serif: var(--font-newsreader), ui-serif, Georgia, serif;
  --font-sans: var(--font-instrument), ui-sans-serif, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;

  --shadow-card: var(--shadow-card);
  --shadow-pop: var(--shadow-pop);
  --shadow-sheet: var(--shadow-sheet);
}

/* Type scale: see 1.3 */
@theme {
  --text-xs: 0.75rem;     --text-xs--line-height: 1rem;
  --text-sm: 0.875rem;    --text-sm--line-height: 1.25rem;
  --text-base: 1rem;      --text-base--line-height: 1.5rem;
  --text-lg: 1.125rem;    --text-lg--line-height: 1.75rem;
  --text-read: 1.1875rem; --text-read--line-height: 1.7;
  --text-h3: 1.25rem;     --text-h3--line-height: 1.4;
  --text-h2: 1.625rem;    --text-h2--line-height: 1.25;  --text-h2--letter-spacing: -0.01em;
  --text-h1: 2.25rem;     --text-h1--line-height: 1.15;  --text-h1--letter-spacing: -0.015em;
  --text-display: clamp(2.5rem, 5.5vw, 3.75rem);
  --text-display--line-height: 1.04;
  --text-display--letter-spacing: -0.02em;
}

/* Base layer */
@layer base {
  html { background: var(--bg); color: var(--text); }
  body {
    @apply font-sans; /* @apply, not var(--font-sans): works whether or not inline theme vars are emitted */
    font-size: 1rem;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  h1, h2, h3 { @apply font-serif; text-wrap: balance; }
  p { text-wrap: pretty; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; } /* no border-radius: it would square off rounded controls on focus */
  button { cursor: pointer; }
  ::selection { background: var(--highlight-soft); }
  /* the citation highlight everywhere (PDF text layer, text viewer, fallback) */
  mark[data-hl] { background: var(--highlight-soft); color: inherit; border-radius: 2px; }
}
```

### 1.3 Type

Fonts via `next/font/google`. Verified for Next 16.4: Newsreader (axes `wght` 200 to 800 and `opsz` 6 to 72, italic is a separate file), Instrument Sans (`wght` 400 to 700, `wdth` 75 to 100), Geist Mono (`wght` 100 to 900). Only `wght` is loaded by default. Preload the serif and the sans only. Option for later: `axes: ["opsz"]` on Newsreader gives finer display headings at the cost of a larger preloaded file.

| Role | Family | Used for | Load |
|---|---|---|---|
| Serif | **Newsreader** | answer text, composer text, h1 to h3, wordmark | variable `wght`, `latin`, normal style only (add italic only if used), `display: "swap"`, CSS var `--font-newsreader` |
| Sans | **Instrument Sans** | buttons, labels, badges, nav, helper text, banners | variable `wght`, `latin`, `--font-instrument` |
| Mono | **Geist Mono** (already in the project) | `p. 7`, counters, citation markers, file meta | `weight: "400 500"` (a range: it is a variable font, and arrays are for static fonts), `preload: false`, `--font-geist-mono` |

| Token | Size / line | Font | Use |
|---|---|---|---|
| `text-display` | 40 to 60 px / 1.04 | serif 600 | landing headline only |
| `text-h1` | 36 / 1.15 | serif 600 | page titles (auth, 404) |
| `text-h2` | 26 / 1.25 | serif 600 | section titles |
| `text-h3` | 20 / 1.4 | serif 600 | card titles, viewer title |
| `text-read` | 19 / 1.7 | serif 400 | the answer and the question composer |
| `text-lg` | 18 / 28 | sans 400 | landing sub-headline |
| `text-base` | 16 / 24 | sans 400 | inputs (16 px minimum so iOS never zooms), body |
| `text-sm` | 14 / 20 | sans 400/500 | buttons, list rows, banners |
| `text-xs` | 12 / 16 | sans 500 or mono | badges, meta, helper text |

Typographic rules:
- Answer column max width **36rem** (about 68 characters).
- `font-variant-numeric: tabular-nums` on counters, page numbers, and sizes.
- Use curly quotes and a real ellipsis (`…`) in all user-facing text.
- No text smaller than 12 px. No all-caps except `text-xs` labels with `tracking-wide`, used sparingly.

### 1.4 Spacing, radius, borders

- Base unit 4 px (Tailwind default). **Allowed steps:** 1, 2, 3, 4, 6, 8, 12, 16 (4, 8, 12, 16, 24, 32, 48, 64 px). Do not invent others.
- Between major blocks on a page: `gap-8`. Between related items: `gap-3` or `gap-4`. Inside cards: `p-4` (compact) or `p-6` (roomy).
- Page padding: `px-4` mobile, `px-6` from `md`, `px-8` from `xl`.
- Radius: `rounded-sm` 4 (citation markers, chips), `rounded-md` 8 (buttons, inputs, banners), `rounded-lg` 12 (cards), `rounded-xl` 16 (dialogs, sheets), `rounded-full` (badges only).
- Borders are 1 px. Card and divider edges use `border-line`. Anything the user must find or operate (inputs, secondary buttons, file dropzone) uses `border-control` (passes 3:1).

### 1.5 Elevation

Paper logic: flat by default, edges instead of shadows.

| Level | Light | Dark | Use |
|---|---|---|---|
| 0 | `border-line`, no shadow | same | cards, rows, inputs |
| 1 | `shadow-card` | border color step only | interactive card on hover, the PDF sheet |
| 2 | `shadow-pop` | ring plus deep shadow | toasts, dialogs |
| 3 | `shadow-sheet` | ring plus deep shadow | viewer sheet (mobile and tablet) |

---

## 2. Brand assets

- **Wordmark:** "Groundwork" in Newsreader 600, 20 px in the header, tracking `-0.01em`. On the landing hero only, a 3 px `bg-accent` rule runs under the whole word.
- **Favicon / app icon:** a custom Groundwork mark, supplied as a finished raster asset rather than drawn in code (it replaced the earlier serif "G" placeholder). `app/icon.png` is 512 px, square. `app/apple-icon.png` is 180 px, full-bleed with no rounded corners, because iOS applies its own mask and a transparent or pre-rounded icon gets a black or double-rounded edge. Both come from one 1024 px master, and the mark must stay recognisable at 16 px (thick shapes, no fine detail). Next emits the link tags from these file names, so there is no `<link>` to maintain, and `app/icon.svg` is removed: if it stayed, the page would carry two competing favicons. The default `app/favicon.ico` is deleted and replaced with a custom `favicon.ico` as a fallback for desktop tabs and legacy browsers.
- **Metadata:** title template `%s · Groundwork`, default title "Groundwork: ask your documents, see the source". Per-route titles. Fix the current "Create Next App" title first.
- **Social image:** `app/opengraph-image.tsx` with the wordmark, the headline, and a highlighted footnote. Verify the `next/og` font-loading approach for your Next version.

---

## 3. Dark mode (designed, not inverted)

Dark mode is a "reading lamp" version of the same room. Differences from light that are deliberate:

| Concern | Light | Dark |
|---|---|---|
| Background logic | warm paper | warm charcoal (`#151310`, never pure black) |
| Depth | soft warm shadows | lighter surface steps plus 1 px border, no shadows |
| Text | near-black `#1E1B16` | warm off-white `#EDE6D6`, never `#FFF` |
| Accent | deep ink green (fill) | lighter sage green (so it keeps 8 plus : 1 on dark) |
| Highlight | flat yellow at 45% | **a glow**: yellow at 30% alpha over the dark surface, text stays readable |
| Serif text | 400 | 400, but allow `font-weight: 420` and 0.01em letter-spacing if thin strokes shimmer (check on a real screen) |
| PDF page | paper on paper | **the page stays paper-colored** (`--paper` with `--paper-ink`, defined once for both themes); it sits on a dark "desk" (`--sunken`) with `filter: brightness(0.94)` so it isn't a white flashbang. Never CSS-invert a PDF canvas. The highlight on it uses `--highlight-on-paper` (the light-mode strength), through `.paper`, which also covers the text viewer. |
| Skeleton shimmer | paper to lighter paper | surface to `raised` |
| Toast | ink slab | `raised` surface with ring |

Rules: components use token utilities (`bg-surface`, `text-ink`) so they switch automatically. `dark:` variants are for exceptions only (the PDF brightness filter, the serif tweak).

---

## 4. Layout rules

### 4.1 Widths

| Context | Rule |
|---|---|
| Landing container | `max-w-[68rem]`, hero text column `max-w-[38rem]` |
| Auth card | `max-w-[26rem]`, centered, `p-6` mobile / `p-8` from `md` |
| App container | `max-w-[84rem]`, centered |
| Ask column | `40rem` wide on `xl`, full width below |
| Answer text | `max-w-[36rem]` |
| Right column (shelf or viewer) | takes the rest, min `30rem` for the viewer |

### 4.2 App shell

- **Header:** 56 px (`h-14`), sticky, solid `bg-bg` (no blur), a 1 px `border-line` bottom edge that appears once the page has scrolled.
  - Left: wordmark.
  - The header content uses the same width as the page below it (`max-w-2xl` centered below `xl`), so the wordmark lines up with the content.
  - Right: question counter (mono, "14 of 20 left today"), session chip ("Demo session" or the email, truncated), theme toggle (three-state icon button with a text label in its `aria-label`), sign out (ghost).
  - On mobile: wordmark plus counter plus theme toggle. Session chip and sign out move to an "Account" section at the bottom of the documents section. **No dropdown menus anywhere in this app.**
- **Workspace at `xl` and up:** two columns, `grid-cols-[minmax(0,40rem)_minmax(0,1fr)]`, `gap-8`.
  - Left: composer, answer, sources.
  - Right (sticky, `top-20`): the **Documents shelf** when no viewer is open, the **Viewer** when one is. The ask column never moves when the viewer opens. This fixes the current layout jump.
- **Below `xl`:** single column. The shelf is a section under the answer. The viewer is a modal sheet:
  - `md` to `xl`: right-anchored sheet, full height, `max-w-[34rem]`.
  - Below `md`: bottom sheet, `top-12` to bottom, `rounded-t-xl`, safe-area padding, with a backdrop.
- **Single column below `xl`:** centered and capped at `max-w-2xl` so lines and rows stay readable on tablets.
- **Mobile behavior:** composer stays at the top (this is single-shot Q&A, not a chat). Inputs 48 px tall. Viewer controls 44 px. No horizontal scroll at 320 px.

### 4.3 Viewer modes

| Mode | Element | Behavior |
|---|---|---|
| Docked (`xl` plus) | `<aside>` in the right column | non-modal, Escape closes, focus moves in on open and returns to the chip on close (existing behavior stays) |
| Sheet (below `xl`) | native `<dialog>` via `showModal()` | focus trap, Escape, backdrop click closes, `inert` background, body scroll locked |

---

## 5. Component patterns

Class recipes are the canonical starting point. Keep them in one `components/ui/` folder and reuse them. Merge classes with a tiny `cn` (clsx) helper. Do not add a variants library.

### 5.1 Button

Base: `inline-flex items-center justify-center gap-2 rounded-md font-sans font-medium transition-colors duration-(--dur-fast) disabled:cursor-not-allowed pointer-coarse:min-h-11`

| Variant | Classes |
|---|---|
| primary | `bg-accent text-accent-fg hover:bg-accent-hover` |
| secondary | `border border-control bg-surface text-ink hover:bg-sunken` |
| ghost | `text-ink hover:bg-sunken` |
| quiet | `text-muted hover:bg-sunken hover:text-ink` (a secondary action that must not compete with the content next to it: Delete on a document row. Hover classes are `enabled:hover:` like the rest.) |
| danger (outline) | `border border-danger text-danger hover:bg-danger-soft` |
| danger (solid, confirm only) | `bg-danger text-danger-fg` |
| link | `text-accent underline underline-offset-4 hover:text-accent-hover` (inline text only; never as a stand-in for a button) |

| Size | Classes |
|---|---|
| sm | `h-8 px-3 text-sm` |
| md (default) | `h-10 px-4 text-sm` |
| lg (landing CTA) | `h-12 px-6 text-base` |

Disabled is **not** just opacity: `disabled:bg-sunken disabled:text-muted disabled:border-line`. Pending state swaps the label ("Asking…") and keeps the button width fixed (set `min-w`). No spinner inside buttons.

Implementation notes (`components/ui/button.tsx`): hover classes are `enabled:hover:` so a disabled button never shows a hover color; `type` defaults to `"button"`; the `link` variant has no height, padding or touch floor so it never breaks a line of prose; `buttonClasses()` is exported so a `<Link>` can look like a button.

### 5.2 Input and composer

Input: `h-10 w-full rounded-md border border-control bg-surface px-3 text-base text-ink placeholder:text-muted aria-[invalid=true]:border-danger`. Add `pointer-coarse:h-12` (48 px on touch, per 4.2). Disabled: `disabled:bg-sunken disabled:text-muted disabled:border-line`. Focus uses the global ring. Error text sits under the field in `text-sm text-danger`, tied with `aria-describedby`. Helper text is `text-xs text-muted`.

**Field** (`components/ui/field.tsx`): label (`text-sm font-medium text-ink`), input, helper, error, in a `flex flex-col gap-1`. The caller passes a stable `id`; `aria-invalid` and `aria-describedby` (error first, then helper) are set for it.

**Composer (the ask box):** a `rounded-lg border border-control bg-surface` container, auto-growing `<textarea>` (1 to 4 lines, Enter submits, Shift+Enter newline) set in `font-serif text-read`. The primary submit button sits inside, bottom right. A character counter (mono, `text-xs`) appears only past 80% of the limit. The composer is 56 px tall at rest. **The focus ring sits on the container, not the textarea** (`focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40`; the textarea has `outline-none`), because the textarea is not the visual edge. A one-line helper row under the box is always present (offline note on the left, counter on the right, counter hidden with `invisible` until 80%), so neither shifts the page. Enter is ignored while an input method is composing. The box clears on submit; the question is echoed above the answer.

**Upload control: the shelf strip (U5).** The dashed dropzone (a dashed box with "drag a file here") is what every upload screen looks like, so it is not used. The shelf holds at most 10 documents, so the control is drawn as that shelf: ten slots in a row on a shelf line, with the upload button beside it. The slot count is the document cap (`SHELF_SLOTS` in `lib/documents/shelf.ts` reads `MAX_DOCS_PER_USER_HINT`), never a second copy of it.

- **Spines.** A document stands in its slot as a spine, oldest on the left, so the newest is last. Height is 36 px plus 0.8 px per page and width is 16 px plus 0.55 px per page, both up to 30 pages (about 60 × 32 px at the top). Everything without a trusted page count (processing, queued, failed, text) is 44 × 24 px, as is an empty slot. The shelf is only as wide as its books and never wider than its column; when the books are wider than the column they shrink in proportion, so a spine stays book-shaped (never a wide tile). The shelf line is a 2 px `bg-control` rule under the slots; spines have `rounded-t-[3px]` and a 4 px gap.
- **Status on the spine.** Ready `bg-accent`. Processing `bg-accent/35`, pulsing (a tint of the accent, because `accent-soft` is near-black in dark mode and the spine disappeared). Queued: dashed `border-control`, no fill. Failed `bg-danger`, leaning 5 degrees. A file on its way (no row yet): a dashed spine that lands in the next slot. Empty slots: dashed `border-line`, 44 px tall (the default spine height, so an empty shelf has no dead space above it).
- **Next slot.** The first empty slot is where an upload goes. It lights up (`border-accent bg-accent-soft`) while the person hovers or focuses the upload button, and a taller ghost spine rises in it while a file is dragged over the page. Hovering or focusing a document row lifts its own spine 6 px.
- **Decorative.** The strip is `aria-hidden`: every fact in it is also in the caption, the button and the list. A spine's `title` is the document's name, for sighted people hovering it. It is not clickable.
- **Caption and button.** Under the shelf: a mono `text-xs text-muted tabular-nums` caption, "{n} of 10 on your shelf" (a file on its way counts; blank while the shelf loads). The button is a real `<input type="file">` (`sr-only`) under a label styled like a secondary button: `h-10 pointer-coarse:h-11 rounded-lg border border-control bg-surface px-4 text-sm font-medium` with the upload glyph, hover `bg-sunken`; unavailable `border-line bg-sunken text-muted cursor-not-allowed`. The focus ring is on the wrapper (`has-[:focus-visible]`), because the input is the invisible one. From `sm` the button sits beside the shelf, bottom-aligned with the caption; below `sm` it sits under it.
- **Hint line.** Under the button, one `text-xs` line with its height reserved (two lines below `sm`, one from `sm`), made of up to two spans so nothing shifts when the text changes: the file rules when idle; "Uploading {name}…" then "Keep this tab open." (or "One file at a time. The others were skipped.") while uploading; "Processing {name}…" then "This can take a minute or more." while processing; "Drop to shelve it." while dragging; "Uploads need a connection." offline. At the cap the banner says why, so the line keeps the file rules. A visually hidden `role="status"` repeats progress for screen readers.
- **Drop anywhere.** A file can be dropped anywhere on the page (window listeners, files only). Every file drag has its default cancelled, so a miss never makes the browser open the file and leave the app. A drop is refused (`dropEffect: none`) while uploads are unavailable or a modal dialog is open. Only the first file is taken.

**Example chip** (idle ask state, 6.4): `rounded-full border border-control bg-surface px-3 py-1.5 text-sm text-ink`, hover `bg-sunken`, `pointer-coarse:min-h-11`, disabled while asking or offline. A click asks immediately with the chip's full question (its `title`). The chip that cannot be answered is set apart by `border-dashed` as well as by its label.

### 5.3 Card

`rounded-lg border border-line bg-surface p-4` (or `p-6`). Interactive card: add `transition-shadow duration-(--dur-base) hover:shadow-card hover:border-control`.

### 5.4 Badge

`inline-flex h-5 items-center gap-1 rounded-full border pr-2 pl-1.5 text-xs font-medium` with a 12 px Phosphor glyph before the label. Every badge is a soft fill with a hairline edge in its own tone (`border-current/20`), so it reads as a small stamped label rather than a flat chip. **Nothing animates**: a status is a state, and the row's progress line (section 7) carries "work in progress". The label is always present and each status has its own glyph shape, so color is never the only signal.

| Status | Classes | Glyph |
|---|---|---|
| Queued | `border-dashed border-control bg-transparent text-muted` (no fill: a slot still waiting) | clock, bold |
| Processing | `border-current/20 bg-accent-soft text-accent` | half-filled circle, static |
| Ready | `border-current/20 bg-accent-soft text-accent` | check in a circle, fill |
| Failed | `border-current/25 bg-danger-soft text-danger` | exclamation in a circle, fill |
| Sample | `border-highlight/60 bg-highlight-soft text-ink` | bookmark, fill |

### 5.5 Citation marker and source card

**Marker** (a real `<button>` inside the answer): raised about 0.3em, mono, `0.7em`, `rounded-sm bg-accent-soft px-1 text-accent font-medium`, hover `bg-accent text-accent-fg`. The hit area extends 6 px beyond the pill (`after:absolute after:-inset-1.5`). The marker whose source is open in the viewer is solid (`bg-accent text-accent-fg`). Accessible name stays "Source 2: report.pdf, page 7". On coarse pointers the marker grows to a 24 px minimum width, sits 8 px from its neighbour, and its hit area is about 44 px tall (`pointer-coarse:after:-inset-y-2.5`); it cannot be 44 px wide without two adjacent markers sharing a tap, so width is about 36 px.

**Cross-highlight:** hovering or focusing a marker gives its source card `ring-2 ring-accent/40 bg-accent-soft`, and the reverse. This replaces a popover (no floating-UI dependency, works with keyboard, nothing to position).

**Source card** (footnote style, an `<li>` in an `<ol>`): grid with a mono numeral in `text-muted`, then the document title (`font-medium text-sm`), `p. 7` in mono `text-xs text-muted`, a 2-line-clamped snippet in `font-serif text-sm text-muted`, and a ghost button "Open page 7". The numeral is the same one as in the answer.

### 5.6 Banner (inline notice)

A banner is a slip of paper with a small tab at the start: `flex items-start gap-3 rounded-md border p-3 text-sm text-ink`, a full 1 px frame (not a left rule: the left rule is the margin-note motif and belongs to the cited passage in 6.6), and a 28 px icon chip (`size-7 rounded-sm border bg-surface`) holding a 16 px fill-weight glyph. Text sits beside the chip with `text-pretty`; an optional action sits to its right from `sm` up and wraps below the text on narrow screens. The frame firms up as urgency rises, and the icon shape changes with the tone, so the tone never rests on color alone.

| Tone | Frame and fill | Chip | Icon | ARIA | Use |
|---|---|---|---|---|---|
| info | `border-line bg-sunken` | `border-line text-muted` | circle with "i" | `role="status"` | neutral notes, refusals' secondary text |
| warn | `border-warn/35 bg-warn-soft` | `border-warn/30 text-warn` | triangle | `role="status"` | limits, offline, stale data, paused uploads |
| danger | `border-danger/60 bg-danger-soft` | `border-danger/40 text-danger` | octagon | `role="alert"` | failures that block the user |

Retry actions are a `secondary` `sm` button inside the banner.

### 5.7 Dialog

Native `<dialog>` with `showModal()` (`components/ui/confirm-dialog.tsx`). `m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-line bg-raised p-6 shadow-pop` (`m-auto` because the Tailwind reset zeroes margins, which un-centers a modal dialog). Title in serif `text-h3`, one sentence of consequence, buttons right-aligned: a `secondary` Cancel first and a `danger (solid)` confirm with a fixed `min-w`, so the label can swap to "Deleting…".

- **Focus.** Cancel is first in the DOM and has initial focus (the **safe** action). Escape cancels, except while a request is running. Focus returns to the element that opened it, if it is still there; if it is gone (a deleted row), the caller moves focus (the shelf heading, `tabIndex={-1}`).
- **No backdrop-click close.** For a destructive confirmation a stray click must not decide anything.
- **Failure.** A failed request keeps the dialog open with a danger banner inside it, and the confirm button retries.
- **Scrim.** `rgb(0 0 0 / 0.5)` in both themes (`dialog.confirm-dialog::backdrop`). `bg-ink/40` flips to a light veil in dark mode, which washes the page out instead of dimming it.
- **Scroll lock.** With `scrollbar-gutter: stable` on `html`, hiding the scrollbar leaves an empty band that a scrim never covers (a scrim covers neither a scrollbar nor a reserved gutter). While a modal dialog is open the gutter is released and its measured width is added as `padding-right` on `html` (`--scrollbar-w`, set by `ConfirmDialog` just before `showModal()`), so the scrim covers the whole window and the page does not move. The viewer sheet's own lock (`body:has(dialog.viewer-sheet:modal)`) has the same band on platforms with classic scrollbars and could use the same approach.
- One dialog per Delete button, mounted closed. Used for delete confirmation (replaces the inline "Are you sure?" group).

### 5.8 Toast

One region, bottom center, `max-w-sm`, `rounded-lg bg-toast text-toast-fg shadow-pop px-4 py-3 text-sm`, `role="status"`, `aria-live="polite"`. Auto-dismisses after 4 s (pauses on hover and focus), with a 120 ms opacity exit. Only one visible at a time: a new toast replaces the current one. The region is mounted from the start (a live region must exist before its content changes to be announced) and lives in `ToastProvider`, at the shell (`app/page.tsx`); `useToast()` outside a provider is a no-op with a development warning, so a component renders on its own in a test. Colors: light is the inverted `toast-bg` slab; dark uses the `toast-bg` token (`#25221C`, a slab slightly lighter than the page), so it is a dark slab in both themes, which is intended.

**Use for:** completed actions that leave no other trace ("{name} is ready to search.", "Document deleted", "Link copied").
**Do not use for:** errors that need action (those stay inline as banners), or anything the user must read.

### 5.9 Skeleton

`rounded-sm bg-sunken` with a shimmer (section 7), implemented as the `skeleton` utility in `globals.css`: a `--sunken` base with one `linear-gradient` band in `--skeleton-band`, animated through `background-position`. It is the only gradient allowed (rule 9). Under reduced motion the gradient is removed and only `bg-sunken` remains. Use `shape="pill"` for badge-shaped placeholders. Skeletons match the final shape and size so nothing jumps:

| Context | Skeleton |
|---|---|
| Answer | 3 lines at `text-read` height, last line 60% wide |
| Sources | 2 source-card shapes |
| Document row | the same structure as a real row: title bar 40% wide and a badge pill on one line, a meta bar on a 24 px line (so rows do not jump when they arrive) |
| Viewer | a paper-colored rectangle at 8.5 : 11 with 8 faint text bars (the `skeleton` utility, with `--sunken` and `--skeleton-band` redefined on `.paper-skeleton` so the bars stay faint on paper in dark mode) |
| Header counter | 80 × 16 px bar |

### 5.10 Document list (a list, not a table)

Each row is an `<li>`: `relative flex flex-col gap-1 overflow-hidden rounded-lg border border-line bg-surface p-4`. Line one: the title (`font-medium`, wraps) and the status badge. Line two, always 24 px tall: the meta in mono `text-xs text-muted` ("6 pages · PDF · added 2 days ago"; the page count only once ready; the kind from the file extension; relative time from the clock of the last read, so the server and the browser print the same) and the row actions at the right end. Below that, at most one note.

- **Actions.** Retry is a `ghost` `sm` button, Delete a `quiet` `sm` button. Both are always visible: Retry is the next step on a failed or stuck row, and a Delete that appears on hover is hard to find and did not behave the same across devices. The actions drop to their own right-aligned line when the meta is too long (360 px); because the meta line and the action area are both 24 px tall (`h-6`, the 32 px buttons overflow it evenly), the meta sits at the same height either way.
- **Notes.** A failed row shows its failure message in `text-sm text-danger`. A stuck row shows "This is taking longer than expected. You can retry it." in `text-sm text-muted`; the outcome of the last Retry (`no_op`, unconfirmed, limit) replaces it. A scanned PDF has no Retry: it needs a different file.
- **Progress.** A processing row that is not stuck shows a 2 px indeterminate progress line along its bottom edge (`.row-progress`): all rows share one keyframe and timing, so several move as one and count as one looping animation. A stuck row has none (nothing is moving). Static, full width, under reduced motion.
- **Badge.** It crossfades in place with `--dur-base` when the status changes after first paint; the first paint does not animate. The row does not change height when the status changes.
- **Pending row.** From the moment a file is chosen, the shelf shows a row for it at the top (dashed "Uploading" pill, then "Queued" once the row exists, with the progress line). It has the same structure and height as a real row, is `aria-hidden` (the upload control's live region announces the progress) and is replaced by the real row without a jump once the list holds its id. The shelf is never "empty" while a file is being added.
- **Strip link.** Hovering or focusing a row lifts its spine in the shelf strip (5.2).
- **Delete.** Opens the dialog (5.7). On success the row is removed at once, a reload reconciles, the toast "Document deleted" shows, and focus moves to the "Your documents" heading.

### 5.11 Icons

Phosphor is the only icon library (`@phosphor-icons/react`, pinned exactly). Feature components never import it directly: everything goes through `components/ui/icons.tsx`, which re-exports the small set in use under semantic names (`InfoIcon`, `ReadyIcon`, ...), so the set stays small and consistent. It imports from the `/ssr` entry so icons work in Server Components without a client boundary.

- **Weights:** `regular` for general UI, `fill` for status glyphs (badges, banners). One weight per role, never mixed within a role.
- **Sizes:** 12 px in badges, 16 px elsewhere, in `currentColor`.
- **Accessibility:** every icon is `aria-hidden` and `focusable="false"` (set once in `icons.tsx`). The text beside it carries the meaning, and an icon-only control gets its name from `aria-label`.
- **Shape carries meaning:** statuses and banner tones each have a different glyph, so color is never the only signal.
- **No raw `<svg>`, no emoji, no text glyphs (`×`, `→`) standing in for icons.**

### 5.12 Theme toggle

A three-state icon button (System, Light, Dark) that cycles in that order on each press. Ghost style, the Button `icon` size: a 36 px square on fine pointers and 44 px on coarse ones (`pointer: coarse`), no horizontal padding, so the 16 px icon can never be squeezed. The icon shows the **current choice**: Monitor (System), Sun (Light), Moon (Dark). The `aria-label` names the state and the next one: "Theme: System. Switch to Light." There is no menu. The choice is stored under the existing theme key and applied to `data-theme` (System resolves the OS preference to light or dark, the same as the head script). While on System it follows OS changes live. The first render uses the System icon on the server and swaps after hydration, in a fixed-size box, so nothing shifts.

### 5.13 Question counter

Header text in mono, `text-sm`, `tabular-nums`, `text-muted`: "14 of 20 left" (the full sentence with the reset time is the `aria-label` and `title`, so it is not squeezed into 360 px). Zero state: "0 left today" in `text-warn` with the warn glyph beside it, never red, because running out is a limit, not an error. The value sits in a box with a reserved minimum width (`min-w-[7rem]`, sized for "20 of 20 left") so a change of digits does not shift the header. Unknown (the lookup failed): "– left" in the same box, with the label "Question count unavailable." It is a polite live region (`aria-live="polite"`, `aria-atomic`), so a change after an answer is announced and first paint is not. The value is fetched on the server, so the counter has data before the first answer; the 80 × 16 px skeleton bar (5.9) is only for route loading states.

### 5.14 Header scroll edge

The header always has `border-b border-transparent`. Once the page has scrolled past 0 px, the border becomes `border-line` (color change only, no layout change, `--dur-fast`). A zero-height sentinel at the top of the page drives it through an `IntersectionObserver`, not a scroll listener.

### 5.15 Account section (below `md`)

At the bottom of the documents section on small screens: a quiet `bg-sunken` card with the session chip ("Demo session" or the email, truncated) and a secondary "Sign out" button. A demo session's "Create an account" is not repeated: it is the card in the shelf right above. It repeats what the header shows from `md` up; only one of the two is ever visible.

### 5.16 Shelf and viewer swap

On `xl`, the shelf and the viewer share the right column. The shelf stays mounted (so polling and state survive) and is hidden while the viewer is open; the viewer fades in with `--dur-base` opacity only. Under reduced motion it appears instantly. The column does not change width.

---

## 6. Screen inventory and states

Legend: **L** loading, **E** empty, **X** error, **S** success, **P** partial, **O** offline, **D** permission-denied. "n/a" always carries its reason. Existing user-facing strings in `lib/**` are kept unless a row says otherwise.

### 6.1 Landing (`/`, signed out) — new

Header (wordmark with the 3 px accent rule, ghost "Sign in", primary "Try demo"; the header button keeps the fixed label "Try demo" in every state and is only disabled while the check runs or the request is in flight). Hero: display headline "Answers that show their sources.", sub-line, primary lg "Try demo" plus link "Sign in". Beside or below it: a **static specimen** built from HTML and CSS (a short answer with footnote markers next to a paper page with a highlighted passage). No image, no JS. Below: three guarantees (Cited, Honest refusals, Private by design), an eval-numbers strip (**renders nothing until Task 6.5 produces real numbers; never invent them**), a privacy note, footer.

| | Treatment |
|---|---|
| L | Server-rendered, nothing to wait for. Only the CTAs have a pending state: the hero button swaps to "Preparing demo…" (fixed width) while Turnstile verifies; the header button keeps its label. After 2 s add "Verifying that you're human…" in `text-xs text-muted` (the existing delayed status). The widget sits directly under the hero CTA in a slot shared by both buttons. The slot reserves the status line (20 px); at `xl`, where the hero sits beside the specimen and the space is invisible, it reserves Turnstile's full 64 px. On narrower screens a rare interactive challenge pushes the content below it down rather than leaving a visible hole for every visitor (the widget is `interaction-only`). |
| E | n/a: static content. |
| X | Demo start failures show as a danger banner under the CTA with existing messages (captcha rejected, auth unavailable, generic). The widget resets quietly. |
| S | Redirect into the workspace. |
| P | Turnstile still verifying: CTAs disabled, with the delayed status line above. |
| O | Warn banner above the CTA: "You’re offline. The demo needs a connection." CTAs disabled. |
| D | n/a: public. An expired confirmation link lands on Sign in, which shows the warn banner (6.2). |
| Shared link | A visitor who opens `/?doc=…&page=…&chunk=…` signed out sees an info banner above the CTA: "You opened a shared page. Try the demo or sign in to see it." Try demo and Sign in carry the link as `next` (only `doc`, `page` and `chunk`, each validated). |

### 6.2 Sign in and Sign up

Centered auth card on `bg-bg`. Serif h1, fields, primary submit, link to the other form, a divider, then "Just looking around?" with a secondary "Try demo" button.

| | Treatment |
|---|---|
| L | Submit shows "Signing in…" or "Creating account…" at fixed width, fieldset disabled. |
| E | Initial form. Password hint under the field. |
| X | Field errors under fields (`aria-invalid`, `aria-describedby`), form-level danger banner, captcha rejection and auth-unavailable messages as existing. |
| S | Sign in: redirect. Sign up: the card is replaced by "Check your email" (an `h1` styled at the h2 size, so the page keeps one h1; the address in mono, one line of what to do, link back to sign in). |
| P | Captcha not verified yet: submit disabled; the existing delayed status line (after 2 s) reads "Verifying that you're human…". No separate helper under the button. |
| O | Warn banner "You're offline." Submit disabled. |
| D | Invalid or expired callback link: warn banner at the top of Sign in. Already signed in with a real account: redirect. |

### 6.3 Workspace shell (`/`, signed in)

Header per 4.2, two-column body per 4.2. Contains Ask, Shelf, Viewer below.

| | Treatment |
|---|---|
| L | Header counter skeleton; shelf renders from server-fetched initial data so it has no loading flash. |
| E | See Ask and Shelf. |
| X | Auth service unreachable: the Waiting page (6.7). |
| S | Normal view. |
| P | n/a: parts load independently. |
| O | Global offline banner under the header (6.8). |
| D | Signed out while on the page: redirect to the landing page. |

### 6.4 Ask (composer, answer, sources)

| | Treatment |
|---|---|
| L | After submit, before the first event: composer stays, the question is echoed in serif muted, answer skeleton plus source skeleton, and "Searching your documents…" in `text-sm text-muted` (`aria-live="polite"`). When streaming starts without sources yet: "Writing the answer…" under the first line. |
| E | Idle state. Demo or no own documents: one line ("Ask about the documents on the shelf. Every claim comes with a source you can open.") plus **4 example question chips**: 3 answerable, 1 labeled "Try one it can't answer". Signed-in with own documents: just the line, no chips. |
| X | Danger banner with the existing message and a Retry button when retryable. Any partial answer stays, labeled "Incomplete answer" in `text-xs text-muted`. |
| S | The answer in `font-serif text-read`, markers as citation markers, sources as footnote cards crossfaded in over their skeleton. Counter updates in the header. |
| P | (a) Provider fallback ("closest passages"): info banner plus the source cards. (b) Refusal ("not found"): **neutral card** (`bg-sunken`, not red, no Retry) with the existing message in serif, the "Try rephrasing" line, and a `<details>` "Closest passages (n)". (c) Done with no text: info line. |
| O | Warn banner "Connection lost. Check your network and retry." with Retry. While offline the submit button is disabled with helper text. |
| D | Limit states, each a warn banner with no Retry: daily limit ("You've used today's questions. Resets at …"), too fast ("You're asking too quickly…", clears itself), kill switch ("Demo is resting; back tomorrow."). Expired demo session: banner plus a primary "Start a new demo" button. |

**Layout stability while streaming.** Nothing above the answer moves: the composer, the echoed question and the status line keep their place, and the skeleton (3 lines, then 2 source cards) is replaced by content of the same width. Content below the answer (the source cards) is pushed down as paragraphs arrive; this is inherent to a list under streaming text and is accepted, but nothing above it ever shifts.

**Notes.** The idle line lives in the ask panel (the page no longer carries its own intro). A cooldown limit keeps its Retry button (the question is cleared from the composer on submit, so Retry is the only way back to it); the daily and kill-switch limits have none. The highlighted marker and its card carry `aria-current="true"`. All ask copy uses curly apostrophes and a real ellipsis, including the refusal and limit messages.

**Sources after the answer.** While the answer streams, every retrieved passage is shown. When `done` arrives, the cards for the markers the answer actually cites stay as "Sources" and the rest move into a collapsed "Other passages searched (n)" group; if the answer cites nothing, all stay. A card whose source is open in the viewer has a firmer border (`border-accent/60`). Markers are grouped with the word before them and the punctuation after them (`whitespace-nowrap`), so a wrapped line never leaves "2." alone. The echoed question is `font-serif text-base text-muted` so the answer stays the largest text. Small labels inside the ask column ("Try asking", "Sources") are `font-sans text-xs font-medium text-muted`, not the global serif heading style. The composer placeholder is "Ask a question…" so it never wraps at 360 px.

**Ask drill (dev only).** `/dev-states/ask/index` lists scripted scenarios (`answer`, `slow`, `refusal`, `error-early`, `error-mid`, `fallback`, `limit-daily`, `limit-cooldown`, `limit-global`, `network`, `expired`, `empty`); `/dev-states/ask/<name>` runs the real ask panel against one, `?chips=1` shows the chips. It 404s outside `next dev`.

### 6.5 Documents shelf

Right column on `xl` (below it on smaller screens). Heading "Your documents" (signed in) or "Sample documents" (demo). Signed in, the order is: heading, the shelf strip with its caption and the upload button, the hint line, the privacy note, any banner, then the rows. The upload control never moves between states.

| | Treatment |
|---|---|
| L | 3 skeleton rows with a real row's structure. Only appears on refresh failures or after an action, because first paint is server data. |
| E | Signed in, none yet: ten empty slots (0 of 10), the upload button, and below them a card with serif "Nothing on the shelf yet." and one sentence. The strip stays where it is, so the first upload does not move it. Demo: the sample documents are listed with the "Sample" badge, plus a quiet card "Uploading needs an account" with a link. |
| X | Danger banner "We couldn't load your documents." with "Try again"; after another failure "Still couldn't load your documents." Per-row failures show the existing failure message under the row. |
| S | Rows with badges and matching spines. Upload success: toast "{name} is ready to search." (the spine has landed and the pending row has become the real one). Delete: toast "Document deleted". |
| P | Uploading and processing: the arriving spine, the pending row, and the hint line ("Uploading {name}…", "Processing {name}…"). Processing row (progress line), stuck row (note plus Retry), retry notes (`no_op`, unconfirmed, limit) as small `text-sm text-muted` lines. A failed ingest: a danger banner under the button, "Uploaded {name}, but it could not be processed. The reason is on its row below.", and the reason once, on the row. Stale list after a failed refresh: warn banner "Couldn't refresh. Showing the last list we have." with "Try again", which shows "Trying…" for at least 700 ms and, if it fails again, changes to "Still couldn't refresh. Showing the last list we have." |
| O | Stale list plus warn banner. Upload button unavailable, hint line "Uploads need a connection." |
| D | Demo: cannot upload (explainer card above). At the 10-document cap: the strip is full ("10 of 10 on your shelf"), the button is unavailable, and a warn banner carries the existing cap message (the hint line keeps the file rules; the cap is said once). Budget exhausted: warn banner with the existing paused message ("Uploads are paused right now. …"); the button stays enabled so the person can try again later. Privacy note ("Don't upload sensitive documents. Their text is sent to AI providers to answer questions.") sits directly under the hint line, always present. |

### 6.6 Viewer (docked panel or sheet)

Header row: serif `text-h3` document title (wraps), a "Close" secondary button. Under it: highlight status note, optional fallback passage, then the PDF or text body with page controls.

| | Treatment |
|---|---|
| L | The panel opens at once. Title shows a skeleton bar if unknown. Body is the paper-page skeleton. No "Opening the document…" text-only state. |
| E | n/a: the viewer only opens with a target. |
| X | Danger banner for: invalid link ("This citation link isn't valid."), lookup failure (with Retry), PDF or text render failure (with Retry). |
| S | Paper page with the highlight wipe (section 7). Page controls: Previous, "Page 7 of 12" in mono (`aria-live="polite"`), Next. |
| P | Highlight could not be pinpointed: the **fallback passage** card sits above the page, styled as a margin note (`bg-sunken`, `border-l-2 border-highlight`, serif text, mono label "Cited passage, page 7") with the line "Shown as text because it couldn't be pinpointed on the page." Text file types highlight as `mark[data-hl]`. Types with no preview: info banner. |
| O | Warn banner. The page already on screen stays. Retry for lookups. |
| D | A document the user can't open looks exactly like a missing one: "That document isn't available. It may have been deleted." Never reveal that it exists. |

### 6.7 Waiting page (auth service unreachable)

Centered card with a serif h1 "Groundwork is waking up.", the line "The database is starting after a quiet spell." and, under it, one reserved line that reads "This usually takes under a minute." (replaced by the "Still not reachable" line after a retry, so it is never empty and never changes height). A secondary "Try again" button (full reload). Optional later: quiet auto-retry every 15 s.

| | Treatment |
|---|---|
| L | Retry shows "Checking…" at fixed width. |
| E | n/a: it only exists in this state. |
| X | Same page again; the reserved second line reads "Still not reachable. Try again in a minute." It appears only when "Try again" was pressed within the last two minutes (a timestamp in `sessionStorage`, so an old episode never looks like a second attempt). |
| S | Reload lands on the workspace. |
| P | n/a: a single message. |
| O | The global offline banner replaces the explanation: "You're offline." |
| D | n/a: no data is involved. |

### 6.8 Global: 404, error, loading, offline

| | Treatment |
|---|---|
| 404 (`not-found.tsx`) | Serif h1 "That page isn't on the shelf." one line, primary "Go to Groundwork". |
| Error (`error.tsx`, `global-error.tsx`) | Serif h1 "Something broke on our side." one line, "Try again" (calls `reset`) plus a link home. Never a stack trace or a provider message. |
| Loading (`loading.tsx`) | Header plus skeleton blocks in the shape of the route. |
| Offline | A shared banner under the header, `role="status"`, appears when `navigator.onLine === false` and when a request fails with a network error. Text: "You're offline. Questions and uploads will work again when you're back." (same as section 8) Disappears on reconnect. |

---

## 7. Motion

Motion makes state changes legible. It never decorates.

| What | Animation | Duration / easing |
|---|---|---|
| Hover, focus color changes | color, background | `--dur-fast` / `--ease-settle` |
| Badge status change | crossfade | `--dur-base` |
| Skeleton to content (answer, sources, rows) | opacity crossfade; the container height is already reserved | `--dur-base` / `--ease-paper` |
| Toast | enter: opacity plus `translateY(8px)` to 0; exit: opacity | enter `--dur-base`, exit `--dur-fast` |
| Dialog | opacity plus `scale(0.98)` to 1; backdrop opacity | `--dur-base` / `--ease-paper` |
| Viewer sheet (below `xl`) | `translateY(24px)` or `translateX(24px)` to 0 plus opacity; close reverses | open `--dur-sheet` / `--ease-paper`, close `--dur-slow` / `--ease-settle` |
| Docked viewer / shelf swap | crossfade only; the grid never reflows | `--dur-base` |
| **Highlight wipe** (signature) | the highlight background grows left to right once over the cited passage, after the page has scrolled into place and settled | `--dur-highlight` / `--ease-paper`; animate `background-size` on a flat single-colour layer, play once, never loop. The marks are drawn hidden (`data-wipe="pending"` on the paper sheet), the viewer's own scroll region scrolls to them, and when it settles (`scrollend`, or a 700 ms timer) `data-wipe="play"` starts the wipe; a passage over several lines staggers 80 ms per line, capped at 400 ms. A safety timer plays it after 2.5 s regardless: a highlight is never left hidden. Reduced motion: shown at once |
| Skeleton shimmer | a soft light band moves across, `background-position` | 1.4 s linear, infinite, only while loading |
| Processing row progress line | indeterminate slide (the badge itself is static); every row uses one keyframe and timing, so they move as one | 1.2 s ease-in-out, infinite; static under reduced motion |
| Shelf spines | a row hover or focus lifts its spine (`translateY(-6px)`); a processing spine pulses (opacity); an arriving file lands (`translateY(-34px)` to 0 plus opacity); a ghost spine rises while a file is dragged over the page | lift `--dur-fast` / `--ease-settle`; land `--dur-base` / `--ease-paper`; pulse 1.4 s and rise 0.9 s alternate, only while in progress or dragging; none under reduced motion |
| Streaming text | **no per-character animation.** Render text as it arrives. An optional 1 px caret blinks at the end while streaming. | caret: 1 s steps |

Rules:
- Only `opacity`, `transform`, color, `background-position`/`background-size`. Never animate `width`, `height`, `top`, `left`, or `margin`.
- At most one looping animation visible per region.
- Never block interaction on an animation. Never delay content to show an animation.
- Interruptible: a new question or a closed viewer cancels in-flight transitions.

**Reduced-motion fallback** (`prefers-reduced-motion: reduce`):
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```
Plus: skeletons are static (`bg-sunken`, no shimmer), spines do not pulse, rise, land or lift (a failed spine keeps its lean: it is a position, not motion), the row progress line is a static full bar, the highlight appears instantly at full strength, the caret is solid, sheets and dialogs fade only (no translate or scale), and `scrollIntoView` uses `behavior: "auto"`.

---

## 8. Microcopy voice

**Voice:** a careful librarian. Precise, calm, specific, a little dry. It says what happened and what to do next. It is honest about uncertainty and never cute.

Rules:
- Sentence case everywhere. No exclamation marks. No "Oops", "Whoops", "Uh-oh", no emoji.
- Say what happened, then what the user can do. Under 20 words where possible.
- Never blame the user. Never show provider names, stack traces, or error codes.
- Use "I" only for the assistant's own answer states ("I couldn't find that"). The product itself says "we" sparingly, mostly "we couldn't load…".
- Prefer concrete nouns: "documents", "page 7", "questions left today". Avoid "oops-style" abstractions like "something went wrong" unless the cause is truly unknown.
- Buttons are verbs: "Ask", "Retry", "Delete document", "Keep it", "Try demo".

| Moment | Copy |
|---|---|
| Landing headline | Answers that show their sources. |
| Landing sub | Ask your documents a question. Every claim links to the exact page, highlighted. If it isn't in your documents, it says so. |
| Ask: idle (demo) | Ask about the documents on the shelf. Every claim comes with a source you can open. |
| Ask: example chip, unanswerable | Try one it can't answer |
| Ask: loading | Searching your documents… / Writing the answer… |
| Ask: refusal | I couldn't find that in your documents. *(sub-line)* Try rephrasing, or ask about something the documents cover. |
| Ask: provider fallback | I can't generate an answer right now. The closest passages I found are listed below. |
| Ask: error, retryable | An answer couldn't be generated right now. Please try again. |
| Ask: interrupted | The answer was interrupted. Retry to get the full answer. |
| Ask: offline | Connection lost. Check your network and retry. |
| Limit: daily | You've used today's questions. Resets at 01:00 (00:00 UTC). |
| Limit: rate | You're asking too quickly. Wait a few seconds and try again. |
| Limit: kill switch | Demo is resting; back tomorrow. |
| Shelf: empty (signed in) | **Nothing on the shelf yet.** Add a PDF, text, or Markdown file. Answers will cite the exact page. |
| Shelf: demo | **Sample documents.** Ask anything about these. |
| Shelf: demo upload | Uploading needs an account. Create an account to add your own documents. |
| Upload: scanned PDF | The row shows the existing failure message (`INGEST_FAILURE_MESSAGES.scanned_pdf`, no Retry); the banner under the button is short: "Uploaded {name}, but it could not be processed. The reason is on its row below." The reason is written once. |
| Upload: cap | You already have 10 documents. Delete one before uploading another. *(the existing `DOCUMENT_LIMIT_MESSAGE`; shown once, in the banner)* |
| Upload: privacy note | Don't upload sensitive documents. Their text is sent to AI providers to answer questions. |
| Shelf caption | {n} of 10 on your shelf |
| Upload: busy | Uploading {name}… Keep this tab open. / Processing {name}… This can take a minute or more. |
| Upload: dragging | Drop to shelve it. |
| Upload: several files | One file at a time. The others were skipped. |
| Upload: offline | Uploads need a connection. |
| Upload: ready (toast) | {name} is ready to search. |
| Upload: paused | Uploads are paused right now. Your existing documents still work. Please try again later. *(the existing message)* |
| Delete: toast | Document deleted |
| Stuck row | This is taking longer than expected. You can retry it. |
| Shelf: load failed | We couldn't load your documents. / Still couldn't load your documents. |
| Shelf: refresh failed | Couldn't refresh. Showing the last list we have. / Still couldn't refresh. Showing the last list we have. |
| Delete: dialog | **Delete "{name}"?** This removes the file and everything made from it. It can't be undone. *(buttons: Delete document / Keep it)* |
| Viewer: fallback passage | Cited passage, page 7. Shown as text because it couldn't be pinpointed on the page. |
| Viewer: unavailable | That document isn't available. It may have been deleted. |
| Waiting | **Groundwork is waking up.** The database is starting after a quiet spell. This usually takes under a minute. |
| 404 | That page isn't on the shelf. |
| 500 | Something broke on our side. Try again, or head back to the start. |
| Offline (global) | You're offline. Questions and uploads will work again when you're back. |

---

## 9. Sleekness checklist

The six moments where this app will feel polished or cheap. A UI slice is not done until every relevant item passes by hand, in light and dark, at desktop and 375 px width.

1. **The first five seconds.**
   - *Cheap:* a bare password form, Arial, a tab titled "Create Next App".
   - *Polished:* landing page with the specimen visible above the fold, the correct serif and tab title, and "Try demo" as the single obvious action.
   - *Check:* a stranger can say what it does after five seconds. The CTA does not move when Turnstile loads. Click to first answer takes two clicks or fewer.
2. **The streaming answer never jumps.**
   - *Cheap:* text pops in, sources pop in below, the column reflows, the page scrolls on its own.
   - *Polished:* the answer area and source area are reserved from submit, skeletons crossfade into content, markers stay hidden until validated, no auto-scroll after the user scrolls.
   - *Check:* record a layout-shift trace for one question. CLS stays at 0 inside the answer region.
3. **Citation click to highlight.** This is the product.
   - *Cheap:* the page flashes in, the highlight is the default browser yellow, the layout shifts to make room.
   - *Polished:* the viewer opens without moving the ask column, a paper-shaped skeleton holds the place, the page scrolls to the passage, the highlighter wipe plays once. The fallback passage looks intentional.
   - *Check:* test a matched highlight, an unmatched fallback, a text file, and a failure. Test it with keyboard only.
4. **Skeletons, never spinners, never bare text status.**
   - *Cheap:* "Loading your documents…" in gray text, rows that pop in.
   - *Polished:* shaped skeletons for answer, sources, shelf, viewer, header counter. Status badges change in place without row-height changes.
   - *Check:* throttle the network to Slow 4G and walk every screen.
5. **Designed empty, refusal, and error states.**
   - *Cheap:* a red sentence for everything, "No documents yet." with no next step, refusals that look like crashes.
   - *Polished:* each state has the right component and tone: refusals neutral, limits warn, failures danger with a next action, empties with one clear action.
   - *Check:* force every state in the section 6 tables once (the failure drills from Task 5.9 can drive many of them).
6. **Dark mode and the small screen.**
   - *Cheap:* inverted colors, a white PDF slab glaring on dark, a cramped desktop layout squeezed to 375 px, 24 px tap targets.
   - *Polished:* the dark palette from section 3, the PDF page on a dark desk, a real bottom sheet with a backdrop and safe-area padding, 44 px targets.
   - *Check:* the full demo flow on a real phone. No horizontal scroll at 320 px.

Typographic finish (applies everywhere): `text-wrap: balance` on headings, `pretty` on paragraphs, tabular numerals on counters, curly quotes, no orphaned single words in banners.

---

## 10. Accessibility minimums (must hold in every slice)

- Visible focus on every interactive element (global `:focus-visible` ring).
- The streaming answer region has `aria-live="polite"` and `aria-busy` while streaming. Status changes announce once, not per token.
- Markers are buttons with names like "Source 2: report.pdf, page 7".
- Color is never the only signal (badges have labels, the highlight has the fallback passage and the page jump).
- Text contrast AA (4.5:1), non-text controls 3:1 (`border-control`).
- Dialogs and the sheet trap focus, close on Escape, and return focus to the trigger.
- Run axe on the landing page, auth, workspace, and viewer states. No serious or critical violations.

---

## 11. Do-not list (anti-defaults)

- No shadcn or Radix default look, no Tailwind default palette, no `rounded-md` on everything.
- No purple or blue gradients, no glass or blur surfaces, no glow (except the dark highlight).
- No centered-hero-plus-three-icon-cards template. The landing page earns its layout from the specimen.
- No full-page spinners. No modal for something that can be inline. No dropdown menus.
- No new colors, fonts, or shadows. If something is missing from the tokens, propose a token first.
- No stock upload pattern (a dashed box saying "drag a file here"): the upload control is drawn from the product, the shelf (5.2).
- Never hide a row's next step behind hover, and never use `bg-ink/*` for a scrim (it flips to a light veil in dark mode).
- No decorative marks that look like data: a mark on a spine or row means something or is not there.

---

## Appendix: viewer implementation notes (U4)

- **Shells.** One `ViewerPanel` (pinned header with the title and Close, then one scroll region) sits in either shell. From `xl` it is an `<aside aria-label="Document viewer">` of fixed height (`100dvh - 6.5rem`), so skeleton to page never resizes it. Below `xl` it is a native `<dialog class="viewer-sheet">` opened with `showModal()`: focus trap and inert background come from the platform, Escape (`cancel`), a press that starts and ends on the backdrop, and Close all call the same `onClose`, so the URL stays the one source of truth. Body scroll is locked in CSS (`body:has(dialog.viewer-sheet:modal)`), and `html` reserves its scrollbar (`scrollbar-gutter: stable`) so the lock never shifts the page.
- **Exit.** The URL closes the viewer at once, so `ViewerHost` keeps the last open location mounted until the sheet's exit transition ends (or 450 ms pass). Docked has no exit animation.
- **Focus.** On open, focus goes to the document title (`tabIndex={-1}`), which names what appeared. On close it returns to the control that opened the viewer (a citation marker or a source card's Open button); if that button is gone, to the marker or card with the same `data-citation-chunk`, else nowhere.
- **Layout.** Note or fallback passage, then the sticky page toolbar, then the page on a `bg-sunken` desk. The toolbar is part of the scroll region so a long page scrolls under it; the highlight scroll accounts for its height. Crossing `xl` while open swaps shells and reloads the page once; that is accepted.
- **Dev drill.** `/dev-states/viewer/<scenario>` (a 404 outside `next dev`) runs the real viewer against a scripted `ViewerSource` and a small generated PDF (`public/dev/viewer-sample.pdf`); `/dev-states/viewer/index` lists the scenarios.

---

## Appendix: documents implementation notes (U5)

- **Data seam.** `lib/documents/source.ts` defines `DocumentsSource` (`list`, `upload`, `ingest`, `remove`) with the real backend as the default, provided through `DocumentsSourceContext`. The shelf, the upload control and the delete button all read through it; nothing above it calls Supabase or `fetch`. `DocumentsPanel` takes an optional `source`; only the dev drill passes one. No backend or contract change.
- **Shared state.** `DocumentsPanel` is the hub: it holds the pending upload, the documents the list last read (`onDocumentsChange`) and the hovered row (`onRowActiveChange`), and passes them to the upload control (which draws the strip) and to the list. The pending placeholder logic is `isPendingShown` in `lib/documents/shelf.ts`, used by both.
- **Page-wide drop.** `components/use-file-drop.ts` listens on `window` for file drags only; see 5.2.
- **Online status.** The existing `useOnlineStatus` hook is used; nothing was duplicated.
- **Strings kept.** Existing user-facing strings in `lib/` (the cap message, the paused message, the failure messages) are unchanged; DESIGN §8 now quotes them. The scanned-PDF banner was shortened and the e2e assertion changed with it.
- **Try again.** `DocumentList` keeps "Trying…" on screen for at least 700 ms (`MIN_TRYING_MS`) and counts consecutive failed tries; the banner text and a polite live region follow. In `next dev`, React StrictMode runs the page's effect twice and the second run reads on mount, so scripted "fails once" drill scenarios fail one extra time.
- **CSS.** `app/globals.css` gained `.row-progress`, `dialog.confirm-dialog` (and its scrim and the `html:has(...)` scroll lock), `.toast-enter` and `.toast-leave`, and the `.spine*` classes. No token was added; the scrim is a literal `rgb(0 0 0 / 0.5)` because a token that flips with the theme is the bug.
- **Dev drill.** `/dev-states/documents/index` and `/dev-states/documents/<scenario>` (a 404 outside `next dev`) run the real shelf against an in-memory `DocumentsSource` (real file checks, scripted outcomes). Scenarios: `mixed`, `empty`, `slow`, `load-error`, `refresh-error`, `stuck`, `retry-notes`, `cap`, `paused`, `scanned`, `ingest-limit`, `delete-error`, `session-ended`. Offline is DevTools.
- **Constants.** Spine sizes and the shelf's slot count live in `lib/documents/shelf.ts` with unit tests; change them there, not in the component.