---
name: figma-to-static
description: Take a Figma frame exported via the Figma To Tokens plugin (JSON or TOON) and turn it into static UI components that follow the host project's existing types, primitives, styling, and accessibility conventions. Use when the user pastes a JSON/TOON export from Figma To Tokens — optionally with a screenshot — and asks to implement, build, or generate code for it. The skill is project-agnostic; it defers to the host project's agent entry point (CLAUDE.md / AGENTS.md) and any docs that file points to.
---

# Figma To Static

Convert a Figma frame — exported as JSON or TOON via the [Figma To Tokens](https://www.figma.com/community/plugin/1637922141059138776)
plugin — into static UI components that follow the host project's existing
patterns. The data layer, primitives, and styling tokens are already defined
by the project; your job is to map the export onto them, not invent new
structure.

## 0. Read the project conventions first

Before writing any code, read the project's agent entry point —
`CLAUDE.md` (preferred) or `AGENTS.md`. That file is the source of truth
for where everything else lives; follow any references it makes to
related docs (frontend conventions, data-layer rules, type locations,
naming, etc.) and read those too before touching code.

If the entry point doesn't exist, or it doesn't reference the rules you
need (file layout, primitives, styling tokens, data types), ask the user
to point you at the right docs. Don't proceed by guessing.

## 1. Inputs

This workflow does **not** use the Figma MCP server. The user runs the
**Figma To Tokens** plugin in Figma, picks a mode, and pastes the export
into the chat:

1. Selects a frame in Figma.
2. Runs **Plugins → Figma To Tokens**.
3. Picks **Full (JSON)** or **Compact (TOON)** and copies/downloads the text.
4. Pastes the text in chat, usually with a screenshot of the same frame.

So your inputs are: **the exported node tree (text)** + **an optional
screenshot**. There are no `get_design_context` / `get_screenshot` calls to
make — if the export is missing or truncated, **ask for it**. A screenshot
alone is not enough for precise sizes, spacing, paint stops, or fonts.

### What the export contains

Both formats carry the same data — Compact just packs it denser to save
tokens. Coordinates are **relative to the export root**, not to the parent
node — use them for spatial reasoning across the whole frame.

| Field | Meaning |
|---|---|
| `size` | `{ width, height }` in px |
| `position` | `{ x, y }` relative to the export root |
| `opacity`, `rotation`, `blendMode` | Omitted when default |
| `fills` / `strokes` / `effects` | Paints, normalized to hex; gradients keep stops + transform; images keep `imageHash` |
| `cornerRadius` | Number, or `{ tl, tr, br, bl }` per-corner |
| `layout` | Auto-layout direction, alignment, sizing, padding, item spacing |
| `text` | For text nodes: characters, fontSize, fontName, color, alignment, line height, letter spacing |
| `children` | Recursive |

**Compact (TOON) specifics** — same data, different wire format. Knowing
these lets you read TOON exports without mentally converting them to JSON:

- Solid fills collapse to a hex string (`fill: "#0D99FF"`).
- Single-item `fills` / `strokes` arrays collapse to singular `fill` /
  `stroke`.
- `layout` and `text` are inlined as flat siblings of their parent node.
- `padding` collapses to one number if all four sides match, otherwise
  `[top, right, bottom, left]`.
- Default values (opacity 1, rotation 0, padding 0, etc.) are dropped.
- Invisible paints/effects filtered out; `id`, `absolutePosition`,
  `constraints` dropped entirely.
- Arrays of similar objects use tabular form:
  `items[3]{title,description}:` followed by CSV rows.
- Arrays of primitives are inline: `padding[4]: 2, 4, 2, 4`.
- Indentation indicates nesting — no braces, keys aren't quoted.

The export is **one-way**: it's designed for codegen consumption, not for
round-tripping back to Figma. Don't treat any node `id` as stable or
meaningful.

### Multiple exports

When the user pastes 2+ exports, identify the relationship before building:

| Relationship | How to detect | Action |
|---|---|---|
| **Same component, different breakpoints** (desktop + mobile) | Same content, different `size` / `layout` | Build **one component**, drive layout differences via the project's breakpoint mechanism. Mobile values for base; layer up. |
| **Same component, different states** (default + hover) | Same structure, visual variations only | Build **one component**, drive state with `:hover` / `data-*` attrs / `aria-*` states. |
| **Different components** (a parent + a child used inside it) | Distinct purposes | Build **separate files** in the appropriate folders. |

## 2. Map the frame to the project's data layer

Before writing any code, identify what this frame _is_ in the project's
type system. The project's conventions tell you what the type categories
are named (the typical shape is shown below — adapt to the host
project's vocabulary).

### Common mappings

| What the frame looks like | What you're typically building |
|---|---|
| A repeating list of similar items (cards, rows) inside a section | One component whose props include the list — not N separate components |
| One styled section (intro, hero, gallery, contact band) | A single section / block-level component |
| A small leaf inside a larger section (one card, one row) | A part / sub-component used inside the section |
| Full page (with header / footer chrome) | A page-scope component, composing existing sections |
| Site chrome (nav, footer) | A global / shell component, typically outside the page-scope tree |

In a TOON export, repeating lists usually surface as tabular
`children[N]{...}:` arrays — that's a strong hint you're looking at a
single component with a list prop, not N separate ones.

### Look up the matching type

For each component you intend to build, find its type in the project's
types folder. The project's conventions tell you the exact location and
the reserved field names.

If a type doesn't exist yet, **stop and tell the user**. Don't invent one
inline — the data layer is the source of truth. They can either:
(a) add the type + adaptor first, or
(b) confirm you should add it as part of this task.

### Map design fields to type fields

For every visible piece of content in the frame, pin it to a field on
the existing type. Use the **reserved field names** the project's
conventions define (e.g. preferring `title` over `heading`, `label` over
`eyebrow`, `link` over `cta`, `asset` over `image` — but the project's
docs are authoritative). Don't invent parallel synonyms.

```
Figma                            Type field (typical)
─────────────────────────────────────────────────
"OUR APPROACH" overline       →  label
"Built for ambitious brands"  →  title
big body paragraph            →  description
image / video                 →  asset
"Learn more →" CTA            →  link
light/dark section            →  colorScheme
```

## 3. Decide the file layout

Follow the file-layout rules the project's conventions define — where
blocks/sections live, where parts live, where page scopes live, and the
naming + casing rules for each. Don't invent a parallel folder shape.

## 4. Build the component

Follow every rule the project's conventions lay out. Reminders specific
to this workflow:

1. **Skeleton first** — copy the structure from a sibling component with
   the closest shape. Don't write from scratch when a near-twin exists.
2. **Destructure props in type-definition order** so reviewers can diff
   against the type at a glance.
3. **Use the project's primitives** (asset, link, rich text, icons, etc.)
   — never render raw `<img>` / `<a>` / raw richtext nodes directly.
4. **Optional fields**: guard with `&&` rather than rendering empty.
5. **Repeating items** render as `<ol>` / `<ul>` + `<li>` — never a
   `<div>` with mapped children.
6. **Map design tokens to project tokens** — never hardcode a color,
   font-size, or pixel value that has a token equivalent. If a design
   value has no token, flag it before hardcoding.

### Reading measurements from the export

- **Padding / gap**: prefer `layout.padding` and `layout.itemSpacing` over
  eyeballing differences in `position`. Auto-layout numbers are the
  designer's intent; positional deltas are derived.
- **Section size**: the export root's `size.width` is the design canvas
  width, not necessarily the breakpoint width. Cross-check against the
  project's breakpoint values rather than hardcoding the canvas number.
- **Text styles**: read `fontName`, `fontSize`, `lineHeight`,
  `letterSpacing` from the `text` block (or inlined flat siblings in
  TOON). Map to the project's typography mixins / utilities — don't pass
  raw px through to styles.
- **Colors**: in TOON, solids appear as bare hex strings (`fill: "#…"`).
  Map every hex to an existing CSS variable / SCSS token. Flag any that
  don't resolve.

## 5. Wire the new component up

Whatever the project's component registry looks like (a blocks map, a
dynamic-import table, a route file, a Storybook entry, etc.), add the
new component there. The project's conventions tell you where and how.

For new types: confirm the type member, the adaptor (if there's a CMS),
and any registry entry all align — the registry key, the type's
discriminant, and the data source's component name must match exactly.

## 6. Verify

After writing the files:

1. **Type-check** — runs as part of the dev server, or invoke explicitly
   (`tsc --noEmit`, `pnpm typecheck`, etc.).
2. **Start the dev server** and load the page that uses the new
   component.
3. **Visual comparison**: render and compare to the screenshot the user
   pasted (or the Figma frame). Note deltas — spacing, color, weight —
   and either fix them or flag them as design decisions to confirm.
4. **Test responsive**: cycle through the project's breakpoints (typical:
   mobile 375px → tablet 768px → laptop 1280px → desktop 1600px).
5. **Keyboard pass**: Tab through. Every interactive element reachable?
   `Enter` / `Space` activates buttons? Focus outline visible?
6. **Reduced motion**: enable "Reduce motion" in OS accessibility prefs;
   confirm animations stop / become static.
7. **Automated a11y audit**: run axe DevTools or Lighthouse
   Accessibility. Fix anything that fails; aim for ≥95 unless there's a
   documented exception.
8. **Screen reader spot-check**: turn on VoiceOver / NVDA / Narrator and
   step through the new component. Headings announce at the right level?
   Images have meaningful alt or are correctly skipped? Link/button
   labels make sense out of visual context?

If you can't run the dev server (no terminal access, dependencies
missing), **say so explicitly** rather than declaring the task done.

## 7. When you can't make it pixel-perfect

- **Decorative effects** (custom blend modes, complex SVG masks, particle
  effects): implement the closest CSS approximation; flag deeper effects
  for design follow-up.
- **Custom fonts not yet loaded**: stub the family, leave a `// TODO: font`
  comment, flag for the engineer who owns font loading.
- **Animations on a static frame**: the plugin export is a static
  snapshot and carries no motion data. Ask the user for a video,
  prototype link, or written description — don't invent motion direction
  or timing.
- **Images**: the export carries `imageHash`, not URLs. Ask the user to
  upload assets to the project's asset host (CMS, blob storage, etc.) or
  supply them before wiring real sources; in the meantime, leave a
  placeholder primitive with a clear TODO.

## 8. Open the conversation

If anything's ambiguous before writing code, ask once with concrete
options:

- "This frame could be one section with a list, or two stacked sections.
  The schema has both shapes — which do you want?"
- "The CTA arrow icon doesn't exist in the project's primitives yet —
  should I add it?"
- "The Figma frame shows a color I can't map (`#3a2d1f`). Should I add
  it as a new token or use the closest existing one?"
- "Only a Compact (TOON) export was shared and it's been truncated
  mid-tree — can you re-export Full JSON, or send Compact again from the
  section root?"

Don't ask everything up front — ask the **blocking** question, build to
it, surface secondary questions while building.

## Rules

Project conventions (TypeScript, styling, primitives, accessibility,
never/always) live in whatever docs the project's agent entry point
(`CLAUDE.md` / `AGENTS.md`) references — read those first. The rules
below are specific to this workflow:

- NEVER invent new domain types (block / part / page / global / etc.)
  inline — surface missing types as a question before writing any code.
- NEVER hardcode a design value (color, size, spacing) that has no token
  equivalent without flagging it first.
- NEVER declare the task done without running the dev server and doing a
  visual comparison against the export's screenshot or the Figma frame.
- NEVER call Figma MCP tools (`get_design_context`, `get_screenshot`,
  `get_metadata`, etc.) for this workflow — the plugin export is the
  only source. Ask for a re-export instead of trying to fetch directly.
- ALWAYS keep the registry key / type discriminant / data-source
  component name aligned — all three must match exactly.
- ALWAYS ask the blocking question before building, not after.
