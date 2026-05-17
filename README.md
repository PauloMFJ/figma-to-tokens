# Figma To Tokens

> Export Designs for AI, LLMs and Agents.

A Figma plugin that exports a selected frame (or any node) to clean JSON, with two modes:

- **Full JSON** — every meaningful property, formatted, good for round-tripping or full inspection.
- **Compact** — short keys, defaults omitted, single-line. Optimized for LLM token cost.

Works in **free Figma** (no Dev Mode required).

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
- `position` — relative to parent
- `positionRelativeToRoot` — relative to the exported selection root
- `absolutePosition` — absolute canvas coordinates
- `opacity`, `rotation`, `blendMode` (omitted when default)
- `constraints`
- `fills`, `strokes`, `effects` — paints normalized to hex; gradients keep stops + transform; images keep `imageHash`
- `cornerRadius` — number, or `{ tl, tr, br, bl }` if corners differ
- `layout` — auto-layout direction, alignment, sizing, padding, item spacing
- `text` (text nodes) — characters, fontSize, fontName, color, alignment, line height, letter spacing, etc.
- `children` — recursive

### Compact mode

- Short keys: `n` (name → `name`), `t` (type → `type`), `x`, `y`, `w`, `h`
- Solid fills collapse to a hex string: `"fill": "#0D99FF"`
- `radius` only present if non-zero
- `padding` collapses to a single number if all four sides are equal, otherwise `[top, right, bottom, left]`
- Default values (opacity 1, rotation 0, etc.) are omitted
- Invisible nodes are skipped

Coordinates in compact mode are **relative to the export root**, so the JSON is portable — paste it elsewhere and the layout stays self-consistent.

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
