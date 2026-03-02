/**
 * Bounding box in percentage coordinates (0-100) relative to slide dimensions.
 */
export interface BoundingBox {
  /** Horizontal position from left edge (0-100%) */
  x: number;
  /** Vertical position from top edge (0-100%) */
  y: number;
  /** Width as percentage of slide width (0-100%) */
  w: number;
  /** Height as percentage of slide height (0-100%) */
  h: number;
}

/**
 * Text formatting style properties.
 */
export interface TextStyle {
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: "left" | "center" | "right";
  fontFamily?: string;
}

/**
 * A title text element on a slide.
 */
export interface TitleElement {
  type: "title";
  position: BoundingBox;
  text: string;
  style: TextStyle;
}

/**
 * A regular text element (paragraph, subtitle, etc.).
 */
export interface TextElement {
  type: "text";
  position: BoundingBox;
  text: string;
  style: TextStyle;
}

/**
 * A single bullet item with nesting level.
 */
export interface BulletItem {
  text: string;
  level: number;
  bold: boolean;
}

/**
 * A bullet list element on a slide.
 */
export interface BulletListElement {
  type: "bulletList";
  position: BoundingBox;
  items: BulletItem[];
  style: TextStyle;
}

/**
 * An image/icon region detected on a slide.
 * The actual image data will be cropped from the rendered page.
 */
export interface ImageElement {
  type: "image";
  position: BoundingBox;
  description: string;
}

/**
 * A shape element (rectangle, circle, line, etc.).
 */
export interface ShapeElement {
  type: "shape";
  position: BoundingBox;
  shapeType: "rectangle" | "circle" | "line" | "arrow" | "rounded_rectangle";
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
  text?: string;
  textStyle?: TextStyle;
}

/**
 * Union type for all slide elements.
 */
export type SlideElement =
  | TitleElement
  | TextElement
  | BulletListElement
  | ImageElement
  | ShapeElement;

/**
 * Structured data representing a single analyzed slide.
 */
export interface SlideData {
  pageNumber: number;
  backgroundColor?: string;
  elements: SlideElement[];
}

/**
 * A processed slide ready for PPTX generation, including image buffers.
 */
export interface ProcessedSlide {
  slideData: SlideData;
  /** The cleaned background image (text removed by FLUX) */
  cleanBackground: Buffer;
  /** Cropped image regions keyed by element index */
  croppedImages: Map<number, Buffer>;
  /** Original page image dimensions */
  pageWidth: number;
  pageHeight: number;
}

/**
 * Represents a rendered PDF page as an image.
 */
export interface PageImage {
  pageNumber: number;
  imageBuffer: Buffer;
  width: number;
  height: number;
}
