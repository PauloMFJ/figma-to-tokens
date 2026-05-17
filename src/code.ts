import type {
	CornerRadius,
	EffectFull,
	Hex,
	LayoutFull,
	Mode,
	NodeFull,
	PaintFull,
	Position,
	SelectionInfo,
	Size,
	TextFull,
} from "./types";

type SerializeOptions = {
	excludeText?: boolean;
};

const main = () => {
	figma.showUI(__html__, { width: 360, height: 480, themeColors: true });
	figma.on("selectionchange", sendSelectionInfo);
	sendSelectionInfo();
	figma.ui.onmessage = async (msg: {
		type: string;
		options?: SerializeOptions;
	}) => {
		if (msg.type === "export") {
			await handleExport(msg.options ?? {});
		}
	};
};

const sendSelectionInfo = () => {
	const sel = figma.currentPage.selection;
	const info: SelectionInfo = {
		count: sel.length,
		name: sel.length === 1 ? sel[0].name : null,
		type: sel.length === 1 ? sel[0].type : null,
		width: sel.length === 1 && "width" in sel[0] ? sel[0].width : null,
		height: sel.length === 1 && "height" in sel[0] ? sel[0].height : null,
	};
	figma.ui.postMessage({ type: "selection", info });
};

const handleExport = async (options: SerializeOptions) => {
	const sel = figma.currentPage.selection;
	if (sel.length === 0) {
		figma.ui.postMessage({ type: "error", message: "Select a frame first." });
		return;
	}

	try {
		const roots = sel.filter((n) => "absoluteBoundingBox" in n);
		if (roots.length === 0) {
			figma.ui.postMessage({
				type: "error",
				message: "Selection has no exportable node.",
			});
			return;
		}

		const tree =
			roots.length === 1
				? serialize(roots[0], roots[0], options)
				: roots.map((n) => serialize(n, n, options));

		figma.ui.postMessage({
			type: "result",
			full: render(tree, "full"),
			compact: render(tree, "compact"),
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : "Export failed.";
		figma.ui.postMessage({ type: "error", message });
	}
};

type Tree = NodeFull | (NodeFull | null)[] | null;

/** Full mode emits pretty JSON; compact mode emits TOON. */
const render = (tree: Tree, mode: Mode): string => {
	if (mode === "full") return JSON.stringify(tree, null, 2);
	const condensed = Array.isArray(tree)
		? tree.map((n) => (n ? condense(n) : null))
		: tree
			? condense(tree)
			: null;
	return renderToon(condensed);
};

const relPosToRoot = (node: SceneNode, root: SceneNode): Position => {
	if (!("absoluteBoundingBox" in node) || !("absoluteBoundingBox" in root)) {
		return { x: 0, y: 0 };
	}
	const nb = node.absoluteBoundingBox;
	const rb = root.absoluteBoundingBox;
	if (!nb || !rb) return { x: 0, y: 0 };
	return {
		x: round(nb.x - rb.x),
		y: round(nb.y - rb.y),
	};
};

const size = (node: SceneNode): Size | null => {
	if (!("width" in node)) return null;
	return { width: round(node.width), height: round(node.height) };
};

const round = (n: number): number => Math.round(n * 100) / 100;

const rgbaToHex = (c: RGB | RGBA, opacity = 1): Hex => {
	const a = "a" in c ? c.a * opacity : opacity;
	const r = Math.round(c.r * 255);
	const g = Math.round(c.g * 255);
	const b = Math.round(c.b * 255);
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	if (a >= 0.999) return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
	return `#${hex(r)}${hex(g)}${hex(b)}${hex(Math.round(a * 255))}`.toUpperCase();
};

const isGradient = (p: Paint): p is GradientPaint =>
	p.type === "GRADIENT_LINEAR" ||
	p.type === "GRADIENT_RADIAL" ||
	p.type === "GRADIENT_ANGULAR" ||
	p.type === "GRADIENT_DIAMOND";

const paintToFull = (p: Paint): PaintFull => {
	const base: PaintFull = {
		type: p.type,
		visible: p.visible ?? true,
		opacity: p.opacity ?? 1,
		blendMode: p.blendMode ?? "NORMAL",
	};
	if (p.type === "SOLID") {
		base.color = rgbaToHex(p.color, 1);
	} else if (isGradient(p)) {
		base.gradientStops = p.gradientStops.map((s) => ({
			position: round(s.position),
			color: rgbaToHex(s.color, 1),
		}));
	} else if (p.type === "IMAGE") {
		base.scaleMode = p.scaleMode;
	}
	return base;
};

const effectToFull = (e: Effect): EffectFull => {
	const base: EffectFull = { type: e.type, visible: e.visible };
	if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
		base.color = rgbaToHex(e.color, 1);
		base.offset = e.offset;
		base.radius = e.radius;
		base.spread = e.spread ?? 0;
		base.blendMode = e.blendMode;
	} else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
		base.radius = e.radius;
	}
	return base;
};

const getCornerRadius = (node: SceneNode): CornerRadius | null => {
	if (!("cornerRadius" in node)) return null;
	const cr = node.cornerRadius;
	if (typeof cr === "number") return round(cr);
	if (cr === figma.mixed && "topLeftRadius" in node) {
		return {
			tl: round(node.topLeftRadius ?? 0),
			tr: round(node.topRightRadius ?? 0),
			br: round(node.bottomRightRadius ?? 0),
			bl: round(node.bottomLeftRadius ?? 0),
		};
	}
	return null;
};

const getLayout = (node: SceneNode): LayoutFull | null => {
	if (!("layoutMode" in node) || node.layoutMode === "NONE") return null;
	return {
		direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
		primaryAxisAlign: node.primaryAxisAlignItems,
		counterAxisAlign: node.counterAxisAlignItems,
		padding: {
			top: round(node.paddingTop ?? 0),
			right: round(node.paddingRight ?? 0),
			bottom: round(node.paddingBottom ?? 0),
			left: round(node.paddingLeft ?? 0),
		},
		itemSpacing: round(node.itemSpacing ?? 0),
	};
};

const fmtLineHeight = (lh: LineHeight): string => {
	if (lh.unit === "AUTO") return "auto";
	const v = round(lh.value);
	return lh.unit === "PIXELS" ? `${v}px` : `${v}%`;
};

const fmtLetterSpacing = (ls: LetterSpacing): string => {
	const v = round(ls.value);
	return ls.unit === "PIXELS" ? `${v}px` : `${v}%`;
};

const getText = (node: TextNode): TextFull => {
	const fontName = node.fontName === figma.mixed ? null : node.fontName;
	const fontSize = node.fontSize === figma.mixed ? null : node.fontSize;
	const rawLineHeight =
		node.lineHeight === figma.mixed ? null : node.lineHeight;
	const rawLetterSpacing =
		node.letterSpacing === figma.mixed ? null : node.letterSpacing;
	const textCase = node.textCase === figma.mixed ? null : node.textCase;
	const textDecoration =
		node.textDecoration === figma.mixed ? null : node.textDecoration;

	const fills = Array.isArray(node.fills) ? node.fills : [];
	const firstSolid = fills.find(
		(f): f is SolidPaint => f.type === "SOLID" && (f.visible ?? true),
	);
	const color = firstSolid
		? rgbaToHex(firstSolid.color, firstSolid.opacity ?? 1)
		: null;

	return {
		characters: node.characters,
		fontSize,
		fontName,
		color,
		textAlignHorizontal: node.textAlignHorizontal,
		textAlignVertical: node.textAlignVertical,
		lineHeight: rawLineHeight ? fmtLineHeight(rawLineHeight) : null,
		letterSpacing: rawLetterSpacing ? fmtLetterSpacing(rawLetterSpacing) : null,
		textCase,
		textDecoration,
	};
};

/**
 * Builds the canonical `NodeFull` tree. Returns `null` for nodes that
 * should be omitted (invisible, or filtered by options); the caller
 * filters those out of `children`.
 */
const serialize = (
	node: SceneNode,
	root: SceneNode,
	options: SerializeOptions,
): NodeFull | null => {
	if (!node.visible) return null;
	if (options.excludeText && node.type === "TEXT") return null;

	const out: NodeFull = {
		id: node.id,
		name: node.name,
		type: node.type,
		position: relPosToRoot(node, root),
	};

	const sz = size(node);
	if (sz) out.size = sz;

	if ("opacity" in node && node.opacity !== 1) out.opacity = node.opacity;
	if ("rotation" in node && node.rotation !== 0)
		out.rotation = round(node.rotation);
	if (
		"blendMode" in node &&
		node.blendMode !== "PASS_THROUGH" &&
		node.blendMode !== "NORMAL"
	) {
		out.blendMode = node.blendMode;
	}

	if ("fills" in node && Array.isArray(node.fills) && node.fills.length) {
		out.fills = node.fills.map(paintToFull);
	}
	if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length) {
		out.strokes = node.strokes.map(paintToFull);
		if ("strokeWeight" in node && typeof node.strokeWeight === "number") {
			out.strokeWeight = node.strokeWeight;
		}
		if ("strokeAlign" in node) {
			out.strokeAlign = node.strokeAlign;
		}
	}
	if ("effects" in node && Array.isArray(node.effects) && node.effects.length) {
		out.effects = node.effects.map(effectToFull);
	}

	const radius = getCornerRadius(node);
	if (radius !== null) out.cornerRadius = radius;

	const layout = getLayout(node);
	if (layout) out.layout = layout;

	if (node.type === "TEXT") {
		out.text = getText(node);
	}

	if ("children" in node && node.children.length) {
		const children = node.children
			.map((c) => serialize(c, root, options))
			.filter((c): c is NodeFull => c !== null);
		if (children.length) out.children = children;
	}

	return out;
};

/**
 * Rendering-layer transform: turns a `NodeFull` tree into a denser
 * intermediate shape for compact mode. Drops defaults, collapses
 * single-item arrays, inlines layout/text fields, and reduces opaque
 * solid fills to a hex string. The result is then emitted as TOON.
 */
const condense = (node: NodeFull): Record<string, unknown> => {
	const out: Record<string, unknown> = {
		name: node.name,
		type: node.type,
	};

	const { x, y } = node.position;
	if (x !== 0) out.x = x;
	if (y !== 0) out.y = y;

	if (node.size) {
		out.w = node.size.width;
		out.h = node.size.height;
	}

	if (node.opacity !== undefined) out.opacity = node.opacity;
	if (node.rotation !== undefined) out.rotation = node.rotation;
	if (node.blendMode !== undefined) out.blendMode = node.blendMode;

	if (node.fills?.length) {
		const fills = node.fills.filter((p) => p.visible).map(condensePaint);
		if (fills.length === 1) out.fill = fills[0];
		else if (fills.length > 1) out.fills = fills;
	}

	if (node.strokes?.length) {
		const strokes = node.strokes.filter((p) => p.visible).map(condensePaint);
		if (strokes.length) {
			out.stroke = strokes.length === 1 ? strokes[0] : strokes;
			if (node.strokeWeight !== undefined && node.strokeWeight !== 1) {
				out.strokeWidth = node.strokeWeight;
			}
		}
	}

	if (node.effects?.length) {
		const eff = node.effects
			.filter((e) => e.visible)
			.map(condenseEffect)
			.filter((e): e is Record<string, unknown> => e !== null);
		if (eff.length) out.effects = eff;
	}

	if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
		out.radius = node.cornerRadius;
	}

	if (node.layout) {
		out.layout = node.layout.direction;
		const { top, right, bottom, left } = node.layout.padding;
		if (top || right || bottom || left) {
			out.padding =
				top === right && right === bottom && bottom === left
					? top
					: [top, right, bottom, left];
		}
		if (node.layout.itemSpacing) out.gap = node.layout.itemSpacing;
		if (node.layout.primaryAxisAlign !== "MIN") {
			out.align = node.layout.primaryAxisAlign.toLowerCase();
		}
		if (node.layout.counterAxisAlign !== "MIN") {
			out.crossAlign = node.layout.counterAxisAlign.toLowerCase();
		}
	}

	if (node.text) {
		// Figma auto-names TEXT layers from their content; if name
		// already equals the rendered text, the `text` field is just
		// a duplicate token cost — drop it (name carries the content).
		if (node.name !== node.text.characters) {
			out.text = node.text.characters;
		}
		if (node.text.fontSize !== null) out.size = node.text.fontSize;
		if (node.text.fontName) {
			out.font = `${node.text.fontName.family} ${node.text.fontName.style}`;
		}
		if (node.text.color) out.color = node.text.color;
		if (node.text.textAlignHorizontal !== "LEFT") {
			out.align = node.text.textAlignHorizontal.toLowerCase();
		}
	}

	if (node.children?.length) {
		out.children = node.children.map(condense);
	}

	return out;
};

const condensePaint = (p: PaintFull): unknown => {
	if (
		p.type === "SOLID" &&
		p.opacity === 1 &&
		p.blendMode === "NORMAL" &&
		p.color
	) {
		return p.color;
	}

	const out: Record<string, unknown> = { type: p.type };
	if (p.opacity !== 1) out.opacity = p.opacity;
	if (p.blendMode !== "NORMAL") out.blendMode = p.blendMode;
	if (p.color) out.color = p.color;
	if (p.gradientStops) out.stops = p.gradientStops;
	if (p.scaleMode) out.scaleMode = p.scaleMode;
	return out;
};

const condenseEffect = (e: EffectFull): Record<string, unknown> | null => {
	if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
		const out: Record<string, unknown> = {
			type: e.type === "DROP_SHADOW" ? "shadow" : "innerShadow",
		};
		if (e.offset?.x) out.x = e.offset.x;
		if (e.offset?.y) out.y = e.offset.y;
		if (e.radius) out.blur = e.radius;
		if (e.spread) out.spread = e.spread;
		if (e.color) out.color = e.color;
		return out;
	}
	if (e.type === "LAYER_BLUR") return { type: "blur", radius: e.radius };
	if (e.type === "BACKGROUND_BLUR")
		return { type: "bgBlur", radius: e.radius };
	return null;
};

/**
 * TOON-style emitter for the condensed compact tree. Uses indentation
 * for nesting, tabular form (`key[N]{cols}:` then CSV rows) for arrays
 * of objects with identical primitive-valued keys, inline
 * `key[N]: a, b, c` for primitive arrays, and bulleted lists for
 * mixed/nested arrays. Goal: minimize LLM token cost vs JSON.
 */
const renderToon = (value: unknown): string => {
	const lines: string[] = [];
	if (isPrim(value)) {
		lines.push(fmtPrim(value));
	} else if (Array.isArray(value)) {
		emitTopArray(value, lines);
	} else {
		emitObject(value as Record<string, unknown>, 0, lines);
	}
	return lines.join("\n");
};

const isPrim = (v: unknown): boolean =>
	v === null || v === undefined || typeof v !== "object";

// Quote a string when an unquoted emission would be ambiguous:
// special chars, numeric-looking, boolean/null literals, leading/
// trailing whitespace, or empty.
const NEEDS_QUOTE = /[,:\n"[\]{}#]|^[+-]|^\d|^\s|\s$|^$|^(true|false|null)$/;
const quoteIfNeeded = (s: string): string =>
	NEEDS_QUOTE.test(s) ? JSON.stringify(s) : s;

const fmtPrim = (v: unknown): string => {
	if (v === null || v === undefined) return "null";
	if (typeof v === "boolean") return v ? "true" : "false";
	if (typeof v === "number") return String(v);
	if (typeof v === "string") return quoteIfNeeded(v);
	return JSON.stringify(v);
};

const fmtKey = (k: string): string => quoteIfNeeded(k);

// An array is tabular when every element is a plain object with the
// same key set and only primitive values.
const isTabular = (arr: unknown[]): boolean => {
	if (arr.length === 0) return false;
	const first = arr[0];
	if (first === null || typeof first !== "object" || Array.isArray(first)) {
		return false;
	}
	const keys = Object.keys(first);
	if (keys.length === 0) return false;
	for (const item of arr) {
		if (item === null || typeof item !== "object" || Array.isArray(item)) {
			return false;
		}
		const obj = item as Record<string, unknown>;
		if (Object.keys(obj).length !== keys.length) return false;
		for (const k of keys) {
			if (!(k in obj) || !isPrim(obj[k])) return false;
		}
	}
	return true;
};

const emitObject = (
	obj: Record<string, unknown>,
	indent: number,
	lines: string[],
) => {
	for (const [k, v] of Object.entries(obj)) {
		emitField(k, v, indent, lines);
	}
};

const emitField = (
	key: string,
	value: unknown,
	indent: number,
	lines: string[],
) => {
	const pad = "  ".repeat(indent);
	const k = fmtKey(key);
	if (isPrim(value)) {
		lines.push(`${pad}${k}: ${fmtPrim(value)}`);
		return;
	}
	if (Array.isArray(value)) {
		emitArrayField(k, value, indent, lines);
		return;
	}
	const obj = value as Record<string, unknown>;
	if (Object.keys(obj).length === 0) {
		lines.push(`${pad}${k}: {}`);
		return;
	}
	lines.push(`${pad}${k}:`);
	emitObject(obj, indent + 1, lines);
};

const emitArrayField = (
	key: string,
	arr: unknown[],
	indent: number,
	lines: string[],
) => {
	const pad = "  ".repeat(indent);
	if (arr.length === 0) {
		lines.push(`${pad}${key}: []`);
		return;
	}
	if (arr.every(isPrim)) {
		const items = arr.map(fmtPrim).join(", ");
		lines.push(`${pad}${key}[${arr.length}]: ${items}`);
		return;
	}
	if (isTabular(arr)) {
		emitTabular(key, arr as Record<string, unknown>[], indent, lines);
		return;
	}
	lines.push(`${pad}${key}[${arr.length}]:`);
	for (const item of arr) {
		emitListItem(item, indent + 1, lines);
	}
};

const emitTabular = (
	key: string,
	arr: Record<string, unknown>[],
	indent: number,
	lines: string[],
) => {
	const pad = "  ".repeat(indent);
	const inner = "  ".repeat(indent + 1);
	const cols = Object.keys(arr[0]);
	const header = cols.map(fmtKey).join(",");
	lines.push(`${pad}${key}[${arr.length}]{${header}}:`);
	for (const row of arr) {
		lines.push(inner + cols.map((c) => fmtPrim(row[c])).join(", "));
	}
};

const emitListItem = (item: unknown, indent: number, lines: string[]) => {
	const pad = "  ".repeat(indent);
	if (isPrim(item)) {
		lines.push(`${pad}- ${fmtPrim(item)}`);
		return;
	}
	if (Array.isArray(item)) {
		if (item.length === 0) {
			lines.push(`${pad}- []`);
			return;
		}
		if (item.every(isPrim)) {
			const items = item.map(fmtPrim).join(", ");
			lines.push(`${pad}- [${item.length}]: ${items}`);
			return;
		}
		// Complex nested array inside a list — punt to JSON
		lines.push(`${pad}- ${JSON.stringify(item)}`);
		return;
	}
	const obj = item as Record<string, unknown>;
	const entries = Object.entries(obj);
	if (entries.length === 0) {
		lines.push(`${pad}- {}`);
		return;
	}
	// First entry shares the "- " line; the rest indent under it.
	const [firstK, firstV] = entries[0];
	const fk = fmtKey(firstK);
	if (isPrim(firstV)) {
		lines.push(`${pad}- ${fk}: ${fmtPrim(firstV)}`);
	} else if (Array.isArray(firstV)) {
		emitListItemFirstArray(pad, fk, firstV, indent, lines);
	} else {
		const nested = firstV as Record<string, unknown>;
		if (Object.keys(nested).length === 0) {
			lines.push(`${pad}- ${fk}: {}`);
		} else {
			lines.push(`${pad}- ${fk}:`);
			emitObject(nested, indent + 2, lines);
		}
	}
	for (let i = 1; i < entries.length; i++) {
		emitField(entries[i][0], entries[i][1], indent + 1, lines);
	}
};

const emitListItemFirstArray = (
	pad: string,
	key: string,
	arr: unknown[],
	indent: number,
	lines: string[],
) => {
	if (arr.length === 0) {
		lines.push(`${pad}- ${key}: []`);
		return;
	}
	if (arr.every(isPrim)) {
		const items = arr.map(fmtPrim).join(", ");
		lines.push(`${pad}- ${key}[${arr.length}]: ${items}`);
		return;
	}
	if (isTabular(arr)) {
		const rows = arr as Record<string, unknown>[];
		const cols = Object.keys(rows[0]);
		const header = cols.map(fmtKey).join(",");
		lines.push(`${pad}- ${key}[${arr.length}]{${header}}:`);
		const inner = "  ".repeat(indent + 2);
		for (const row of rows) {
			lines.push(inner + cols.map((c) => fmtPrim(row[c])).join(", "));
		}
		return;
	}
	lines.push(`${pad}- ${key}[${arr.length}]:`);
	for (const sub of arr) {
		emitListItem(sub, indent + 2, lines);
	}
};

const emitTopArray = (arr: unknown[], lines: string[]) => {
	if (arr.length === 0) {
		lines.push("[]");
		return;
	}
	if (arr.every(isPrim)) {
		lines.push(arr.map(fmtPrim).join(", "));
		return;
	}
	if (isTabular(arr)) {
		emitTabular("", arr as Record<string, unknown>[], 0, lines);
		return;
	}
	for (const item of arr) {
		emitListItem(item, 0, lines);
	}
};

main();
