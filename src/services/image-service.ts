import sharp from "sharp";
import type { AppConfig } from "../types/config.js";
import type { BoundingBox } from "../types/slide.js";

/** API version for FLUX.1-Kontext-pro on Azure AI Foundry */
const FLUX_API_VERSION = "2025-04-01-preview";

/**
 * Service for image manipulation: text removal via FLUX.1-Kontext-pro
 * and cropping image regions from rendered slides.
 */
export class ImageService {
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  /**
   * Remove all text from a slide image using FLUX.1-Kontext-pro.
   * Uses the /images/edits endpoint with multipart form data.
   * @param imageBuffer - Original slide image as PNG buffer
   * @returns Cleaned image buffer with text removed
   */
  async removeTextFromImage(imageBuffer: Buffer): Promise<Buffer> {
    console.log(`  Removing text from image...`);

    // Resize image to fit FLUX supported dimensions while preserving aspect ratio.
    // FLUX supports: 1024x1024, 1792x1024, 1024x1792
    // Slides are typically 16:9 (landscape), so use 1792x1024
    const metadata = await sharp(imageBuffer).metadata();
    const isLandscape = (metadata.width ?? 1) > (metadata.height ?? 1);
    const fluxSize = isLandscape ? "1792x1024" : "1024x1792";

    // Resize the input image to match the FLUX output size for consistency
    const [targetW, targetH] = fluxSize.split("x").map(Number) as [number, number];
    const resizedImage = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: "cover" })
      .png()
      .toBuffer();

    // Use the /images/edits endpoint (not /images/generations)
    const endpoint = this.config.azureImageEndpoint;
    const url = `${endpoint}/images/edits?api-version=${FLUX_API_VERSION}`;

    // Build multipart form data - FLUX editing requires file upload
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(resizedImage)], {
      type: "image/png",
    });
    formData.append("image", imageBlob, "slide.png");
    formData.append(
      "prompt",
      "Remove ALL text, letters, numbers, and written words from this image completely. " +
        "Fill the areas where text was with the surrounding background color, gradient, or pattern. " +
        "Do NOT generate any new objects, faces, figures, or illustrations. " +
        "Keep all existing illustrations, icons, photos, and decorative elements exactly as they are. " +
        "Only remove text - nothing else should change."
    );
    formData.append("model", "flux.1-kontext-pro");
    formData.append("n", "1");
    formData.append("size", fluxSize);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": this.config.azureImageApiKey,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.warn(
        `  FLUX edits endpoint failed (${response.status}): ${errorText}`
      );
      console.warn(
        "  Falling back to using original image as background..."
      );
      return imageBuffer;
    }

    const result = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = result.data?.[0];
    if (!imageData) {
      console.warn("  FLUX returned no image data, using original image");
      return imageBuffer;
    }

    // Get the edited image and resize back to original slide dimensions
    let editedBuffer: Buffer;

    if (imageData.b64_json) {
      editedBuffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      editedBuffer = Buffer.from(arrayBuffer);
    } else {
      console.warn("  FLUX returned neither b64_json nor url, using original");
      return imageBuffer;
    }

    // Resize back to original slide dimensions
    if (metadata.width && metadata.height) {
      editedBuffer = await sharp(editedBuffer)
        .resize(metadata.width, metadata.height, { fit: "fill" })
        .png()
        .toBuffer();
    }

    return editedBuffer;
  }

  /**
   * Mask out (paint over) image regions from a background image.
   * After FLUX removes text, the photos/illustrations are still visible in the background.
   * This method paints over those regions with the slide's background color so that
   * the cropped images (placed as separate PPTX objects) are the only copies.
   *
   * @param imageBuffer - The FLUX-cleaned background image
   * @param imageRegions - Array of bounding boxes (percentage 0-100) for image elements
   * @param backgroundColor - Hex color to fill masked regions (e.g. "#F0F0F0")
   * @param pageWidth - Width of the image in pixels
   * @param pageHeight - Height of the image in pixels
   * @returns Image buffer with image regions painted over
   */
  static async maskImageRegions(
    imageBuffer: Buffer,
    imageRegions: BoundingBox[],
    backgroundColor: string,
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer> {
    if (imageRegions.length === 0) {
      return imageBuffer;
    }

    // Parse hex color to RGB
    const hex = backgroundColor.replace(/^#/, "");
    const r = parseInt(hex.substring(0, 2), 16) || 240;
    const g = parseInt(hex.substring(2, 4), 16) || 240;
    const b = parseInt(hex.substring(4, 6), 16) || 240;

    // Create SVG overlay rectangles for each image region
    const rects = imageRegions
      .map((bbox) => {
        const x = Math.round((bbox.x / 100) * pageWidth);
        const y = Math.round((bbox.y / 100) * pageHeight);
        const w = Math.round((bbox.w / 100) * pageWidth);
        const h = Math.round((bbox.h / 100) * pageHeight);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgb(${r},${g},${b})" />`;
      })
      .join("\n    ");

    const svgOverlay = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}">
    ${rects}
  </svg>`
    );

    return sharp(imageBuffer)
      .composite([{ input: svgOverlay, top: 0, left: 0 }])
      .png()
      .toBuffer();
  }

  /**
   * Crop a region from a page image based on percentage bounding box.
   * @param imageBuffer - Full page image buffer
   * @param bbox - Bounding box in percentage coordinates (0-100)
   * @param pageWidth - Width of the full page image in pixels
   * @param pageHeight - Height of the full page image in pixels
   * @returns Cropped image buffer
   */
  static async cropRegion(
    imageBuffer: Buffer,
    bbox: BoundingBox,
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer> {
    const left = Math.round((bbox.x / 100) * pageWidth);
    const top = Math.round((bbox.y / 100) * pageHeight);
    const width = Math.round((bbox.w / 100) * pageWidth);
    const height = Math.round((bbox.h / 100) * pageHeight);

    // Clamp values to image bounds
    const clampedLeft = Math.max(0, Math.min(left, pageWidth - 1));
    const clampedTop = Math.max(0, Math.min(top, pageHeight - 1));
    const clampedWidth = Math.max(
      1,
      Math.min(width, pageWidth - clampedLeft)
    );
    const clampedHeight = Math.max(
      1,
      Math.min(height, pageHeight - clampedTop)
    );

    return sharp(imageBuffer)
      .extract({
        left: clampedLeft,
        top: clampedTop,
        width: clampedWidth,
        height: clampedHeight,
      })
      .png()
      .toBuffer();
  }
}
