# Figma To Tokens

> Export Designs for AI, LLMs and Agents.

A Figma plugin that exports a selected frame (or any node) to a structured text format, with two modes:

- **Full (JSON)** — every meaningful property, pretty-printed JSON. Good for inspection.
- **Compact (TOON)** — Token-Oriented Object Notation: tabular rows for arrays of similar items, defaults dropped, indentation for nesting. Significantly fewer tokens than equivalent JSON; designed for LLM consumption.

Works in **free Figma** (no Dev Mode required).

**One-way:** the output is intended for consumption by other apps, LLMs, or codegen — **not** to be round-tripped back into Figma. That shapes the choices: positions are relative to the export root (not the parent), absolute canvas coords aren't emitted, and compact drops Figma identifiers.

## Install (dev)

```bash
bun install
bun run build
```

In Figma: **Menu → Plugins → Development → Import plugin from manifest…** and pick `manifest.json`.

## Use

1. Open any Figma file.
2. Select a frame (or any node).
3. Run **Plugins → Figma To Tokens**.
4. Pick **Full JSON** or **Compact**, click **Export**.
5. **Copy** to clipboard or **Download** as `.json`.

The selection indicator at the top shows what you've selected. Selection updates live.

## Output

### Full mode

Every node includes:

- `id`, `name`, `type`
- `size` — `{ width, height }`
- `position` — `{ x, y }` relative to the exported selection root (the JSON is portable — paste it elsewhere and the layout stays self-consistent)
- `opacity`, `rotation`, `blendMode` (omitted when default)
- `constraints`
- `fills`, `strokes`, `effects` — paints normalized to hex; gradients keep stops + transform; images keep `imageHash`
- `cornerRadius` — number, or `{ tl, tr, br, bl }` if corners differ
- `layout` — auto-layout direction, alignment, sizing, padding, item spacing
- `text` (text nodes) — characters, fontSize, fontName, color, alignment, line height, letter spacing, etc.
- `children` — recursive

### Compact (TOON) mode

Same node data as Full, with two layers of compression on top:

**Data dropping/collapsing** (still a valid JS shape):
- Solid fills collapse to a hex string: `fill: "#0D99FF"`
- Single-item `fills`/`strokes` arrays collapse to singular `fill`/`stroke`
- Nested `layout: {...}` and `text: {...}` inlined as flat siblings
- `padding` collapses to a single number if all four sides are equal, otherwise `[top, right, bottom, left]`
- Default values (opacity 1, rotation 0, padding 0, etc.) are omitted
- Invisible paints/effects filtered out; `id`, `absolutePosition`, `constraints` dropped

**TOON encoding** (the wire format):
- Indentation for nesting, no braces or quoted keys
- Arrays of objects with identical primitive-only keys get tabular form: `gradientStops[3]{position,color}:` followed by CSV rows
- Arrays of primitives go inline: `padding[4]: 2, 4, 2, 4`
- Mixed/nested arrays use bulleted `- item` lines
- Strings only quoted when ambiguous (contain `:`/`,`/`#`/etc., look numeric, equal `true`/`false`/`null`)

Coordinates are **relative to the export root** in both modes — the output is self-consistent and portable.

## Project layout

```
.
├── manifest.json        # editorType: ["figma"] — no Dev-Mode requirement
├── ui.html              # plugin UI
├── biome.json           # lint + format config
├── tsconfig.json        # type-check config
├── src/
│   ├── code.ts          # serializer + message handling
│   └── figma.d.ts
└── .output/
    └── build.js         # esbuild output (gitignored)
```

## Develop

```bash
bun run build      # one-shot build
bun run watch      # rebuild on change
bun run typecheck  # tsc --noEmit
bun run check      # biome lint + format
```

Note: use `bun run build`, **not** `bun build` — the latter is Bun's bundler subcommand, which doesn't read `package.json` scripts and doesn't down-level ES syntax (Figma's plugin validator rejects `??` / `?.`).

Reload the plugin in Figma (`Plugins → Development → <plugin name>` again, or use Figma's reload shortcut) after each build.
