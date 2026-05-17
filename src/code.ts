/// <reference path="../node_modules/@figma/plugin-typings/index.d.ts" />

type Mode = "full" | "compact";

interface SelectionInfo {
	count: number;
	name: string | null;
	type: string | null;
	width: number | null;
	height: number | null;
}

function main() {
	figma.showUI(__html__, { width: 360, height: 480, themeColors: true });
	figma.on("selectionchange", sendSelectionInfo);
	sendSelectionInfo();
	figma.ui.onmessage = async (msg: { type: string; mode?: Mode }) => {
		if (msg.type === "export") {
			const mode: Mode = msg.mode === "compact" ? "compact" : "full";
			await handleExport(mode);
		}
	};
}

function sendSelectionInfo() {
	const sel = figma.currentPage.selection;
	const info: SelectionInfo = {
		count: sel.length,
		name: sel.length === 1 ? sel[0].name : null,
		type: sel.length === 1 ? sel[0].type : null,
		width: sel.length === 1 && "width" in sel[0] ? sel[0].width : null,
		height: sel.length === 1 && "height" in sel[0] ? sel[0].height : null,
	};
	figma.ui.postMessage({ type: "selection", info });
}

async function handleExport(mode: Mode) {
	const sel = figma.currentPage.selection;
	if (sel.length === 0) {
		figma.ui.postMessage({ type: "error", message: "Select a frame first." });
		return;
	}

	try {
		const roots = sel.filter((n): n is SceneNode => "absoluteBoundingBox" in n);
		if (roots.length === 0) {
			figma.ui.postMessage({
				type: "error",
				message: "Selection has no exportable node.",
			});
			return;
		}

		const serializer = mode === "compact" ? serializeCompact : serializeFull;
		const result =
			roots.length === 1
				? serializer(roots[0], roots[0])
				: roots.map((n) => serializer(n, n));

		const json = JSON.stringify(result, null, mode === "compact" ? 0 : 2);
		figma.ui.postMessage({ type: "result", json, mode });
	} catch (err) {
		const e = err as Error;
		figma.ui.postMessage({
			type: "error",
			message: e.message || "Export failed.",
		});
	}
}

/* ------------------------------------------------------------------ */
/* Coordinate helpers                                                 */
/* ------------------------------------------------------------------ */

function relPosToRoot(node: SceneNode, root: SceneNode) {
	const nb = (node as any).absoluteBoundingBox;
	const rb = (root as any).absoluteBoundingBox;
	if (!nb || !rb) return { x: 0, y: 0 };
	return {
		x: round(nb.x - rb.x),
		y: round(nb.y - rb.y),
	};
}

function absPos(node: SceneNode) {
	const b = (node as any).absoluteBoundingBox;
	if (!b) return null;
	return { x: round(b.x), y: round(b.y) };
}

function size(node: SceneNode) {
	if (!("width" in node)) return null;
	return { width: round(node.width), height: round(node.height) };
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Style helpers                                                       */
/* ------------------------------------------------------------------ */

function rgbaToHex(c: RGB | RGBA, opacity = 1): string {
	const a = "a" in c ? c.a * opacity : opacity;
	const r = Math.round(c.r * 255);
	const g = Math.round(c.g * 255);
	const b = Math.round(c.b * 255);
	const hex = (n: number) => n.toString(16).padStart(2, "0");
	if (a >= 0.999) return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
	return `#${hex(r)}${hex(g)}${hex(b)}${hex(Math.round(a * 255))}`.toUpperCase();
}

function paintToCompact(p: Paint): string | object | null {
	if (!p.visible && p.visible !== undefined) return null;
	if (p.type === "SOLID") {
		return rgbaToHex(p.color, p.opacity ?? 1);
	}
	if (
		p.type === "GRADIENT_LINEAR" ||
		p.type === "GRADIENT_RADIAL" ||
		p.type === "GRADIENT_ANGULAR" ||
		p.type === "GRADIENT_DIAMOND"
	) {
		return {
			type: p.type,
			stops: p.gradientStops.map((s) => ({
				position: round(s.position),
				color: rgbaToHex(s.color, 1),
			})),
		};
	}
	if (p.type === "IMAGE") {
		return { type: "IMAGE", scaleMode: p.scaleMode, imageHash: p.imageHash };
	}
	return { type: (p as any).type };
}

function paintToFull(p: Paint): any {
	const base: any = {
		type: p.type,
		visible: p.visible ?? true,
		opacity: p.opacity ?? 1,
		blendMode: p.blendMode ?? "NORMAL",
	};
	if (p.type === "SOLID") {
		base.color = rgbaToHex(p.color, 1);
		base.rgba = { r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 };
	} else if (p.type.startsWith("GRADIENT_")) {
		const g = p as GradientPaint;
		base.gradientStops = g.gradientStops.map((s) => ({
			position: round(s.position),
			color: rgbaToHex(s.color, 1),
		}));
		base.gradientTransform = g.gradientTransform;
	} else if (p.type === "IMAGE") {
		const img = p as ImagePaint;
		base.scaleMode = img.scaleMode;
		base.imageHash = img.imageHash;
	}
	return base;
}

function effectToFull(e: Effect): any {
	const base: any = { type: e.type, visible: (e as any).visible ?? true };
	if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
		const s = e as DropShadowEffect | InnerShadowEffect;
		base.color = rgbaToHex(s.color, 1);
		base.offset = s.offset;
		base.radius = s.radius;
		base.spread = (s as any).spread ?? 0;
		base.blendMode = s.blendMode;
	} else if (e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR") {
		base.radius = (e as BlurEffect).radius;
	}
	return base;
}

function effectToCompact(e: Effect): any {
	if (!((e as any).visible ?? true)) return null;
	if (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") {
		const s = e as DropShadowEffect | InnerShadowEffect;
		return {
			type: e.type === "DROP_SHADOW" ? "shadow" : "innerShadow",
			x: round(s.offset.x),
			y: round(s.offset.y),
			blur: round(s.radius),
			color: rgbaToHex(s.color, 1),
		};
	}
	if (e.type === "LAYER_BLUR")
		return { type: "blur", radius: round((e as BlurEffect).radius) };
	if (e.type === "BACKGROUND_BLUR")
		return { type: "bgBlur", radius: round((e as BlurEffect).radius) };
	return null;
}

function getCornerRadius(
	node: SceneNode,
): number | { tl: number; tr: number; br: number; bl: number } | null {
	const n = node as any;
	if (typeof n.cornerRadius === "number") return round(n.cornerRadius);
	if (n.cornerRadius === figma.mixed) {
		return {
			tl: round(n.topLeftRadius ?? 0),
			tr: round(n.topRightRadius ?? 0),
			br: round(n.bottomRightRadius ?? 0),
			bl: round(n.bottomLeftRadius ?? 0),
		};
	}
	return null;
}

function getLayout(node: SceneNode): any | null {
	const n = node as any;
	if (!n.layoutMode || n.layoutMode === "NONE") return null;
	return {
		direction: n.layoutMode === "HORIZONTAL" ? "row" : "column",
		primaryAxisAlign: n.primaryAxisAlignItems,
		counterAxisAlign: n.counterAxisAlignItems,
		primaryAxisSizing: n.primaryAxisSizingMode,
		counterAxisSizing: n.counterAxisSizingMode,
		padding: {
			top: round(n.paddingTop ?? 0),
			right: round(n.paddingRight ?? 0),
			bottom: round(n.paddingBottom ?? 0),
			left: round(n.paddingLeft ?? 0),
		},
		itemSpacing: round(n.itemSpacing ?? 0),
	};
}

function getText(node: TextNode): any {
	const fontName = node.fontName === figma.mixed ? null : node.fontName;
	const fontSize = node.fontSize === figma.mixed ? null : node.fontSize;
	const lineHeight = node.lineHeight === figma.mixed ? null : node.lineHeight;
	const letterSpacing =
		node.letterSpacing === figma.mixed ? null : node.letterSpacing;
	const textCase = node.textCase === figma.mixed ? null : node.textCase;
	const textDecoration =
		node.textDecoration === figma.mixed ? null : node.textDecoration;

	const fills = Array.isArray(node.fills) ? node.fills : [];
	const firstSolid = fills.find(
		(f) => f.type === "SOLID" && (f.visible ?? true),
	) as SolidPaint | undefined;
	const color = firstSolid
		? rgbaToHex(firstSolid.color, firstSolid.opacity ?? 1)
		: null;

	return {
		characters: node.characters,
		fontSize,
		fontName,
		fontWeight: fontName ? fontName.style : null,
		color,
		textAlignHorizontal: node.textAlignHorizontal,
		textAlignVertical: node.textAlignVertical,
		textAutoResize: node.textAutoResize,
		lineHeight,
		letterSpacing,
		textCase,
		textDecoration,
	};
}

function getTextCompact(node: TextNode): any {
	const fontName = node.fontName === figma.mixed ? null : node.fontName;
	const fontSize = node.fontSize === figma.mixed ? null : node.fontSize;
	const fills = Array.isArray(node.fills) ? node.fills : [];
	const firstSolid = fills.find(
		(f) => f.type === "SOLID" && (f.visible ?? true),
	) as SolidPaint | undefined;
	const out: any = { text: node.characters };
	if (fontSize) out.size = fontSize;
	if (fontName) out.font = `${fontName.family} ${fontName.style}`;
	if (firstSolid)
		out.color = rgbaToHex(firstSolid.color, firstSolid.opacity ?? 1);
	if (node.textAlignHorizontal && node.textAlignHorizontal !== "LEFT")
		out.align = node.textAlignHorizontal.toLowerCase();
	return out;
}

/* ------------------------------------------------------------------ */
/* Serializers                                                         */
/* ------------------------------------------------------------------ */

function serializeFull(node: SceneNode, root: SceneNode): any {
	if (!node.visible) return null;

	const out: any = {
		id: node.id,
		name: node.name,
		type: node.type,
	};

	const sz = size(node);
	if (sz) out.size = sz;

	out.position = {
		x: round((node as any).x ?? 0),
		y: round((node as any).y ?? 0),
	};
	const rel = relPosToRoot(node, root);
	out.positionRelativeToRoot = rel;
	const abs = absPos(node);
	if (abs) out.absolutePosition = abs;

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

	if ("constraints" in node && (node as any).constraints) {
		out.constraints = (node as any).constraints;
	}

	if ("fills" in node && Array.isArray(node.fills) && node.fills.length) {
		out.fills = node.fills.map(paintToFull);
	}
	if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length) {
		out.strokes = node.strokes.map(paintToFull);
		out.strokeWeight = (node as any).strokeWeight;
		out.strokeAlign = (node as any).strokeAlign;
	}
	if ("effects" in node && Array.isArray(node.effects) && node.effects.length) {
		out.effects = node.effects.map(effectToFull);
	}

	const radius = getCornerRadius(node);
	if (radius !== null) out.cornerRadius = radius;

	const layout = getLayout(node);
	if (layout) out.layout = layout;

	if (node.type === "TEXT") {
		out.text = getText(node as TextNode);
	}

	if ("children" in node && node.children.length) {
		const children = node.children
			.map((c) => serializeFull(c, root))
			.filter((c) => c !== null);
		if (children.length) out.children = children;
	}

	return out;
}

function serializeCompact(node: SceneNode, root: SceneNode): any {
	if (!node.visible) return null;

	const out: any = {
		name: node.name,
		type: node.type,
	};

	const rel = relPosToRoot(node, root);
	out.x = rel.x;
	out.y = rel.y;

	if ("width" in node) {
		out.w = round(node.width);
		out.h = round(node.height);
	}

	if ("opacity" in node && node.opacity !== 1)
		out.opacity = round(node.opacity);
	if ("rotation" in node && node.rotation !== 0)
		out.rotation = round(node.rotation);

	if ("fills" in node && Array.isArray(node.fills) && node.fills.length) {
		const fills = node.fills
			.filter((f) => f.visible ?? true)
			.map(paintToCompact)
			.filter((f) => f !== null);
		if (fills.length === 1) out.fill = fills[0];
		else if (fills.length > 1) out.fills = fills;
	}

	if ("strokes" in node && Array.isArray(node.strokes) && node.strokes.length) {
		const strokes = node.strokes
			.filter((s) => s.visible ?? true)
			.map(paintToCompact)
			.filter((s) => s !== null);
		if (strokes.length) {
			out.stroke = strokes.length === 1 ? strokes[0] : strokes;
			const w = (node as any).strokeWeight;
			if (typeof w === "number" && w !== 1) out.strokeWidth = round(w);
		}
	}

	if ("effects" in node && Array.isArray(node.effects) && node.effects.length) {
		const eff = node.effects.map(effectToCompact).filter((e) => e !== null);
		if (eff.length) out.effects = eff;
	}

	const radius = getCornerRadius(node);
	if (radius !== null && radius !== 0) out.radius = radius;

	const n = node as any;
	if (n.layoutMode && n.layoutMode !== "NONE") {
		out.layout = n.layoutMode === "HORIZONTAL" ? "row" : "column";
		const pt = round(n.paddingTop ?? 0);
		const pr = round(n.paddingRight ?? 0);
		const pb = round(n.paddingBottom ?? 0);
		const pl = round(n.paddingLeft ?? 0);
		if (pt || pr || pb || pl) {
			out.padding = pt === pr && pr === pb && pb === pl ? pt : [pt, pr, pb, pl];
		}
		const gap = round(n.itemSpacing ?? 0);
		if (gap) out.gap = gap;
		if (n.primaryAxisAlignItems && n.primaryAxisAlignItems !== "MIN") {
			out.align = n.primaryAxisAlignItems.toLowerCase();
		}
		if (n.counterAxisAlignItems && n.counterAxisAlignItems !== "MIN") {
			out.crossAlign = n.counterAxisAlignItems.toLowerCase();
		}
	}

	if (node.type === "TEXT") {
		Object.assign(out, getTextCompact(node as TextNode));
	}

	if ("children" in node && node.children.length) {
		const children = node.children
			.map((c) => serializeCompact(c, root))
			.filter((c) => c !== null);
		if (children.length) out.children = children;
	}

	return out;
}

main();
