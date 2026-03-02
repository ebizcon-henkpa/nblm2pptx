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
        "Fill the areas where text was with the surrounding background pattern, color, or texture " +
        "so it looks natural and seamless. Preserve all illustrations, icons, photos, shapes, " +
        "decorative elements, and background patterns exactly as they are. " +
        "The result should look like the original slide but with absolutely no text visible anywhere."
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
