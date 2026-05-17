# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install              # install deps
bun run build            # one-shot esbuild bundle → .output/build.js
bun run watch            # rebuild on change
bun run lint:type-check  # tsc --noEmit
bun run lint:biome       # biome lint
bun run lint             # type-check + biome lint
bun run fix              # biome format --write
```

After each build, reload the plugin in Figma (**Plugins → Development → Figma To Tokens** again).

**Do not use `bun build`** — that invokes Bun's bundler, which ignores `package.json` scripts and does not down-level ES syntax. The TS target is ES2017 and Figma's plugin validator rejects un-transpiled `??` / `?.`. Always use `bun run build` (esbuild).

There are no tests in this repo.

## Architecture

This is a Figma plugin (free Figma, no Dev Mode) that exports the current selection to JSON for **one-way consumption** by other apps / LLMs / codegen.

**The JSON is never round-tripped back into Figma.** That assumption is load-bearing: it justifies dropping Figma-specific identifiers (`id` in compact), storing `position` relative to the export root (not the parent — easier for LLMs to reason about spatially), omitting absolute canvas coordinates, etc. When adding fields, ask "does an external consumer need this?", not "would this be enough to reconstruct the Figma scene?".

### Two execution contexts

- [src/code.ts](src/code.ts) runs in Figma's plugin sandbox — has `figma.*` API, no DOM, no network (`networkAccess.allowedDomains: ["none"]` in [manifest.json](manifest.json)).
- [src/ui.html](src/ui.html) runs in an iframe — has DOM, clipboard, downloads, no `figma.*` API.
- They communicate exclusively via `figma.ui.postMessage` / `figma.ui.onmessage`. Message shapes used today: `{ type: "selection", info }`, `{ type: "export" }`, `{ type: "result", full, compact }`, `{ type: "error", message }`. The plugin computes both renders in one go so mode-toggling in the UI is instant (no round-trip).

esbuild bundles `src/code.ts` into a single `.output/build.js` that the manifest points at. `src/ui.html` is loaded as-is.

### One data model, two output formats

There is **one canonical shape**: `NodeFull` (in [src/types.ts](src/types.ts)). Full and compact modes differ in both data condensation and wire format — they share the serializer.

- `serialize(node, root)` → `NodeFull | null` is the only serializer. It skips invisible nodes (returns `null`, filtered out of `children`) and takes a `root` so `position` is relative to the export root.
- `render(tree, mode)` is the renderer fork:
  - `"full"`: `JSON.stringify(tree, null, 2)` — pretty JSON.
  - `"compact"`: walks the tree through `condense(node)` first, then `renderToon(condensed)` — TOON format (Token-Oriented Object Notation), optimized for LLM token cost.

There are two layers in compact mode and they're independent:

1. **Data condensation** (`condense` / `condensePaint` / `condenseEffect`): decides what to drop, collapse, or inline (solid fills → hex string, single-item fills array → `fill` singular, nested layout/text → flat siblings, defaults dropped, invisible paints filtered, padding collapsed when sides equal). Produces a denser polymorphic JS value.
2. **Wire format** (`renderToon` + helpers `emitObject` / `emitField` / `emitArrayField` / `emitTabular` / `emitListItem`): emits TOON text. Uses indentation for nesting, tabular `key[N]{cols}:` form for arrays of objects with identical primitive-only key sets (e.g. `gradientStops`, `effects` of one shape), inline `key[N]: a, b, c` for arrays of primitives, and bulleted lists for mixed/nested arrays. The implementation is a "TOON-style" emitter based on the spec's main ideas — small variations from any reference spec are possible.

To change what the JSON/TOON contains, edit [src/types.ts](src/types.ts) and `serialize`. To change what compact drops/collapses, edit the `condense*` functions. To change the wire format alone, edit the `renderToon` / `emit*` helpers — types don't need to follow.

### Figma type handling — no `any` casts

`SceneNode` is a union; many properties (`absoluteBoundingBox`, `cornerRadius`, `layoutMode`, `strokeWeight`, `constraints`, padding fields, etc.) exist only on certain variants. The codebase uses `"prop" in node` narrowing rather than `(node as any).prop`. When extending serialization, follow that pattern; biome has `noExplicitAny` turned off but the codebase deliberately avoids `any`.

`figma.mixed` is a sentinel symbol meaning "value differs across the selection" — returned for `fontName`, `fontSize`, `lineHeight`, `letterSpacing`, `textCase`, `textDecoration`, `cornerRadius`, `fills`, `strokeWeight`. Always check `=== figma.mixed` and emit `null` (or fall back to per-corner / per-side fields, as `getCornerRadius` does) before reading further.

Paint and Effect are discriminated unions on `type`. Narrow with `if (p.type === "SOLID")` etc. — there's an `isGradient` predicate for the four `GRADIENT_*` variants.

### Code style

- **`type` aliases, not `interface`** — even for object shapes. Consistent across the codebase.
- **Arrow functions, not function declarations** — `const x = () => {}`. Everything in [src/code.ts](src/code.ts) is at module scope and `main()` is invoked last, so const-hoisting isn't a concern.
- **JSDoc, never banner comments** — no `/* ----- Section ----- */` dividers. Add a `/** ... */` to a function only when its contract is non-obvious from the name (e.g. `serialize` returns `null` for invisible nodes; `condense` is the rendering layer).
- **Comments stay under 80 chars per line** — wrap JSDoc and `//` comments onto multiple lines as needed. Code lines have no width rule (biome handles those); the cap is only for comment text.
- **No casts** — no `as Foo`, no `as any`. Use `in` narrowing, type predicates (`(x): x is Foo => ...`), `instanceof`, or refactor the signature. The codebase currently has zero casts; keep it that way.

### Biome conventions

- Tab indentation, double quotes.
- `figma` and `__html__` are declared globals.
- `noUnusedImports` and `noUnusedFunctionParameters` are errors — clean up as you go.
- `console.log` is an error; `console.warn/error/info` are allowed.
- `.output/**` is excluded from lint/format.
