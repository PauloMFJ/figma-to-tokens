export type Mode = "full" | "compact";

export type SelectionInfo = {
	count: number;
	name: string | null;
	type: string | null;
	width: number | null;
	height: number | null;
};

export type Hex = string;

export type Position = {
	x: number;
	y: number;
};

export type Size = {
	width: number;
	height: number;
};

export type Padding = {
	top: number;
	right: number;
	bottom: number;
	left: number;
};

export type CornerRadiusEach = {
	tl: number;
	tr: number;
	br: number;
	bl: number;
};

export type CornerRadius = number | CornerRadiusEach;

export type GradientStop = {
	position: number;
	color: Hex;
};

export type GradientType =
	| "GRADIENT_LINEAR"
	| "GRADIENT_RADIAL"
	| "GRADIENT_ANGULAR"
	| "GRADIENT_DIAMOND";

export type PaintFull = {
	type: string;
	visible: boolean;
	opacity: number;
	blendMode: string;
	color?: Hex;
	gradientStops?: GradientStop[];
	scaleMode?: ImagePaint["scaleMode"];
	imageHash?: string;
};

export type EffectFull = {
	type: string;
	visible: boolean;
	color?: Hex;
	offset?: Vector;
	radius?: number;
	spread?: number;
	blendMode?: string;
};

export type LayoutFull = {
	direction: "row" | "column";
	primaryAxisAlign: string;
	counterAxisAlign: string;
	padding: Padding;
	itemSpacing: number;
};

export type TextFull = {
	characters: string;
	fontSize: number | null;
	fontName: FontName | null;
	color: Hex | null;
	textAlignHorizontal: string;
	textAlignVertical: string;
	lineHeight: string | null;
	letterSpacing: string | null;
	textCase: string | null;
	textDecoration: TextNode["textDecoration"] | null;
	/** Name of the linked Figma text style, e.g. "Heading/H4". */
	textStyle: string | null;
};

/** Reference to a Figma component for INSTANCE nodes. */
export type ComponentInfo = {
	name: string;
	/** Parent component-set name, when the component is a variant. */
	set: string | null;
	/** Component property overrides (variant values, text/boolean overrides). */
	properties: Record<string, string | boolean> | null;
};

export type NodeFull = {
	id: string;
	name: string;
	type: string;
	size?: Size;
	/**
	 * Position relative to the export root (not the parent). The JSON is
	 * one-way: never round-tripped back into Figma.
	 */
	position: Position;
	opacity?: number;
	rotation?: number;
	blendMode?: string;
	fills?: PaintFull[];
	strokes?: PaintFull[];
	strokeWeight?: number;
	strokeAlign?: string;
	effects?: EffectFull[];
	cornerRadius?: CornerRadius;
	layout?: LayoutFull;
	text?: TextFull;
	/** Name of the linked Figma fill style (paint-style token). */
	fillStyle?: string;
	strokeStyle?: string;
	effectStyle?: string;
	/** Set when the node is a component INSTANCE. */
	component?: ComponentInfo;
	/** True when the node has prototyping reactions (clicks, hovers). */
	interactive?: boolean;
	/** True for frame-like nodes with no visible content (likely slots). */
	slot?: boolean;
	children?: NodeFull[];
};
