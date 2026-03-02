import pptxgenModule from "pptxgenjs";
import type { AppConfig } from "../types/config.js";
import type {
  ProcessedSlide,
  TitleElement,
  TextElement,
  BulletListElement,
  ImageElement,
  ShapeElement,
  BoundingBox,
} from "../types/slide.js";

/**
 * Map our shape type names to pptxgenjs internal shape type strings.
 */
const SHAPE_TYPE_MAP: Record<string, string> = {
  rectangle: "rect",
  circle: "ellipse",
  line: "line",
  arrow: "rightArrow",
  rounded_rectangle: "roundRect",
};

// pptxgenjs CJS/ESM interop: types don't export cleanly in ESM,
// so we use permissive types for the slide and presentation objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PptxInstance = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Slide = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TextItem = { text: string; options: Record<string, any> };

/**
 * Create a new pptxgenjs presentation instance.
 * Handles CJS/ESM interop where the default export may or may not be a constructor.
 */
function createPresentation(): PptxInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = pptxgenModule as any;
  return new Ctor();
}

/**
 * Service for generating PowerPoint presentations from analyzed slide data.
 */
export class PptxService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Generate a complete PPTX file from processed slides.
   * @param slides - Array of processed slides with data, backgrounds, and cropped images
   * @param outputPath - Path to write the .pptx file
   */
  async generate(slides: ProcessedSlide[], outputPath: string): Promise<void> {
    const pres = createPresentation();

    // Set slide dimensions (widescreen 16:9 by default, matching NotebookLM)
    pres.defineLayout({
      name: "NBLM",
      width: this.config.slideWidth,
      height: this.config.slideHeight,
    });
    pres.layout = "NBLM";

    for (const processedSlide of slides) {
      console.log(
        `  Generating slide ${processedSlide.slideData.pageNumber}...`
      );
      this.addSlide(pres, processedSlide);
    }

    await pres.writeFile({ fileName: outputPath });
    console.log(`\nPresentation saved to: ${outputPath}`);
  }

  /**
   * Add a single slide to the presentation.
   */
  private addSlide(pres: PptxInstance, processed: ProcessedSlide): void {
    const slide = pres.addSlide();
    const { slideData, cleanBackground, croppedImages } = processed;

    // Set background: use the cleaned image (text removed) as slide background
    const bgBase64 = cleanBackground.toString("base64");
    slide.background = {
      data: `image/png;base64,${bgBase64}`,
    };

    // Add elements in layered order: shapes (bottom) → images → text (top)
    // This ensures text is always readable on top of shapes and images.

    // Pass 1: Shapes (background decorations, cards, panels)
    for (const element of slideData.elements) {
      if (element?.type === "shape") {
        this.addShapeElement(slide, element);
      }
    }

    // Pass 2: Images (photos, icons, illustrations)
    for (let i = 0; i < slideData.elements.length; i++) {
      const element = slideData.elements[i];
      if (element?.type === "image") {
        this.addImageElement(slide, element, i, croppedImages);
      }
    }

    // Pass 3: Text elements (titles, text blocks, bullet lists) on top
    for (const element of slideData.elements) {
      if (!element) continue;
      switch (element.type) {
        case "title":
          this.addTitleElement(slide, element);
          break;
        case "text":
          this.addTextElement(slide, element);
          break;
        case "bulletList":
          this.addBulletListElement(slide, element);
          break;
      }
    }
  }

  /**
   * Convert a percentage bounding box to pptxgenjs position options (inches).
   */
  private toInches(bbox: BoundingBox): {
    x: number;
    y: number;
    w: number;
    h: number;
  } {
    return {
      x: (bbox.x / 100) * this.config.slideWidth,
      y: (bbox.y / 100) * this.config.slideHeight,
      w: (bbox.w / 100) * this.config.slideWidth,
      h: (bbox.h / 100) * this.config.slideHeight,
    };
  }

  /**
   * Normalize a hex color string for pptxgenjs (strip leading #).
   */
  private normalizeColor(color: string): string {
    return color.replace(/^#/, "");
  }

  /**
   * Add a title element to the slide.
   */
  private addTitleElement(slide: Slide, element: TitleElement): void {
    const pos = this.toInches(element.position);

    slide.addText(element.text, {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      fontSize: element.style.fontSize,
      bold: element.style.bold,
      italic: element.style.italic,
      color: this.normalizeColor(element.style.color),
      align: element.style.align,
      valign: "middle",
      fontFace: element.style.fontFamily ?? "Arial",
      wrap: true,
      shrinkText: true,
    });
  }

  /**
   * Add a text element to the slide.
   */
  private addTextElement(slide: Slide, element: TextElement): void {
    const pos = this.toInches(element.position);

    slide.addText(element.text, {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      fontSize: element.style.fontSize,
      bold: element.style.bold,
      italic: element.style.italic,
      color: this.normalizeColor(element.style.color),
      align: element.style.align,
      valign: "top",
      fontFace: element.style.fontFamily ?? "Arial",
      wrap: true,
      shrinkText: true,
    });
  }

  /**
   * Add a bullet list element to the slide.
   */
  private addBulletListElement(
    slide: Slide,
    element: BulletListElement
  ): void {
    const pos = this.toInches(element.position);

    const textItems: TextItem[] = element.items.map((item) => ({
      text: item.text,
      options: {
        fontSize: element.style.fontSize,
        bold: item.bold || element.style.bold,
        italic: element.style.italic,
        color: this.normalizeColor(element.style.color),
        align: element.style.align,
        fontFace: element.style.fontFamily ?? "Arial",
        bullet: { indent: item.level * 12 + 12 },
        indentLevel: item.level,
        paraSpaceAfter: 4,
      },
    }));

    slide.addText(textItems, {
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
      valign: "top",
      wrap: true,
      shrinkText: true,
    });
  }

  /**
   * Add an image element to the slide using cropped image data.
   */
  private addImageElement(
    slide: Slide,
    element: ImageElement,
    elementIndex: number,
    croppedImages: Map<number, Buffer>
  ): void {
    const pos = this.toInches(element.position);
    const imageBuffer = croppedImages.get(elementIndex);

    if (!imageBuffer) {
      // If no cropped image available, skip
      console.warn(
        `    Warning: No cropped image for element ${elementIndex} (${element.description})`
      );
      return;
    }

    const base64 = imageBuffer.toString("base64");
    slide.addImage({
      data: `image/png;base64,${base64}`,
      x: pos.x,
      y: pos.y,
      w: pos.w,
      h: pos.h,
    });
  }

  /**
   * Add a shape element to the slide.
   */
  private addShapeElement(
    slide: Slide,
    element: ShapeElement
  ): void {
    const pos = this.toInches(element.position);

    // Map shape types to pptxgenjs shape type strings
    const shapeType = SHAPE_TYPE_MAP[element.shapeType] ?? "rect";

    // If shape has text, use addText with shape option
    if (element.text) {
      const textStyle = element.textStyle;
      slide.addText(element.text, {
        shape: shapeType,
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        fill: element.fillColor
          ? { color: this.normalizeColor(element.fillColor) }
          : undefined,
        line: element.borderColor
          ? {
              color: this.normalizeColor(element.borderColor),
              width: element.borderWidth ?? 1,
            }
          : undefined,
        fontSize: textStyle?.fontSize ?? 14,
        bold: textStyle?.bold ?? false,
        italic: textStyle?.italic ?? false,
        color: textStyle
          ? this.normalizeColor(textStyle.color)
          : "333333",
        align: textStyle?.align ?? "center",
        valign: "middle",
        fontFace: textStyle?.fontFamily ?? "Arial",
        rectRadius: element.shapeType === "rounded_rectangle" ? 0.1 : undefined,
      });
    } else {
      slide.addShape(shapeType, {
        x: pos.x,
        y: pos.y,
        w: pos.w,
        h: pos.h,
        fill: element.fillColor
          ? { color: this.normalizeColor(element.fillColor) }
          : undefined,
        line: element.borderColor
          ? {
              color: this.normalizeColor(element.borderColor),
              width: element.borderWidth ?? 1,
            }
          : undefined,
        rectRadius: element.shapeType === "rounded_rectangle" ? 0.1 : undefined,
      });
    }
  }
}
