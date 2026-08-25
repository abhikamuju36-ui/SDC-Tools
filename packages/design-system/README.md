# @sdc/design-system

Shared design tokens and UI primitives for every SDC Tools app.

Two plain-CSS files, no build step, no framework dependency — so the same system
works in all five stacks this repo ships:

| Stack | Apps |
|---|---|
| Vite + React | shell, Assemblies, State Logic, Calendar |
| esbuild + React | Build Readiness |
| Next.js + Tailwind + TS | ETC Planner |
| Vanilla CSS / server-rendered | SDC Scheduler |

```
packages/design-system/
  tokens.css      ← colour, type, spacing, radius, elevation, motion, z-index
  primitives.css  ← sdc-* component classes built on those tokens
```

## Why this exists

Before this package, each app maintained its own `:root` block. Measured drift:

| Token | Shell | ETC Planner | Scheduler | Assemblies | Build Readiness | Calendar |
|---|---|---|---|---|---|---|
| Primary blue | `#1574C4` | `#1574c4` | `#1574c4` | `#2563EB` | `#1E5DD8` | `#0066CC` |
| Page background | `#F4F6FA` | `#f7f7f7` | `#f1f5f9` | `#FAFAF9` (warm) | `#FAFAF7` (warm) | `#FFFFFF` |
| Text tokens | `--text/-2/-3` | `--foreground` | `--text/--muted` | `--ink/-2/-3/-4` | `--ink` + `--fg-0..3` | `--ink/-2/-3/-4` |
| UI font | Montserrat | — | Montserrat | Inter | — | — |

Three of six apps were off-brand on the primary colour, two used a **warm** stone
neutral ramp against a cool navy brand, and there were four mutually incompatible
text-token naming schemes.

`tokens.css` invents almost nothing — it is a merge of the two most mature token
sets already in the repo: the shell's brand palette and light/dark theming, and
the Scheduler's type/weight/radius/elevation/motion scales. The one genuinely new
addition is the spacing scale (`--sp-*`), because no app had one.

## Adoption: the bridge pattern

**Do not mass-rename CSS variables across ~300 component files.** That is a large
diff over six production apps with no visual payoff and real regression risk.

Instead, import the tokens and then **alias** the app's existing local names to
them in the app's own `:root`. Component code is untouched; the visuals converge
immediately; reverting is a one-file change.

```css
/* apps/assemblies/client/src/index.css */
@import "../../../../packages/design-system/tokens.css";

:root {
  /* Bridge: local name  →  shared token */
  --sdc-blue:      var(--sdc-blue);       /* now #1574C4, was #2563EB */
  --bg:            var(--bg-page);        /* now cool, was warm stone */
  --surface:       var(--surface);
  --border:        var(--border);
  --border-strong: var(--border-strong);
  --ink:           var(--text);
  --ink-2:         var(--text-2);
  --ink-3:         var(--text-3);
  --ink-4:         var(--text-4);
  --radius:        var(--radius-sm);
  --font-sans:     var(--font-ui);        /* Montserrat, was Inter */
}
```

Where a local name collides with a shared one (`--surface`, `--border` above),
the shared definition already provides the right value — just delete the local
declaration rather than aliasing it to itself.

Adopt `primitives.css` **incrementally**: every class is `sdc-` prefixed, so
nothing changes until you actually put an `sdc-` class on an element. Convert one
component at a time and verify as you go.

## Using the primitives

```html
<!-- Buttons: one geometry ladder, five intents -->
<button class="sdc-btn sdc-btn--primary">Save</button>
<button class="sdc-btn sdc-btn--secondary">Cancel</button>
<button class="sdc-btn sdc-btn--danger-quiet sdc-btn--sm">Delete</button>
<button class="sdc-btn sdc-btn--icon sdc-btn--ghost" aria-label="Refresh">⟳</button>

<!-- Fields: label above, 34px height, explicit required -->
<div class="sdc-field">
  <label class="sdc-label" data-required for="job">Job number</label>
  <input class="sdc-input" id="job" aria-invalid="true" aria-describedby="job-err">
  <span class="sdc-field__error" id="job-err">Job number is required</span>
</div>

<!-- Table cell semantics -->
<td class="sdc-num sdc-cell--editable">120.0</td>
<td class="sdc-num sdc-cell--calculated">1,440.00</td>
<td class="sdc-num sdc-cell--locked">Closed</td>
```

### Conventions the primitives assume

These are the rules that make the components behave; they are not optional.

- **Tabs** use `aria-selected="true"` on the active tab — not a `.active` class.
- **Selected table rows** use `aria-selected="true"` on the `<tr>`.
- **Sortable headers** use `aria-sort="ascending" | "descending"`.
- **Invalid fields** use `aria-invalid="true"` and point at the error with
  `aria-describedby`.
- **Icon-only buttons** must carry `aria-label`, `aria-labelledby`, or `title`.
  Any that don't get a red dashed outline (see below).

Driving state through ARIA rather than class names means the styling and the
screen-reader semantics can never drift apart.

## Accessibility built in

- A single visible focus ring (`--focus-ring`) is applied to all interactive
  elements via `:focus-visible`. Never `outline: none` without restoring it.
- `prefers-reduced-motion` is honoured globally.
- No status is communicated by colour alone: badges carry a dot + text label,
  calculated cells are italic, locked cells carry a padlock, invalid fields get
  an error message rather than just a red border.
- **Dev guard:** any `.sdc-btn--icon` without an accessible name renders with a
  red dashed outline. If you see one, that button is unusable by screen reader —
  add the label. This intentionally cannot be ignored.

## Dark theme

`tokens.css` honours both conventions already used in this repo — `data-theme="dark"`
(shell) and `.dark` (Tailwind apps) — so an app keeps whatever theme toggle it
already has.

## Adding to this package

The bar is the same as `packages/README.md` sets: it must be genuinely shared by
2+ apps **today**. Don't add speculative components. When you do add one, build it
from tokens only — a primitive containing a raw hex or px value is a bug.
