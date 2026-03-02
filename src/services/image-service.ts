import sharp from "sharp";
import type { AppConfig } from "../types/config.js";
import type { BoundingBox } from "../types/slide.js";

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
   * Sends the image to Azure AI Foundry's image editing endpoint.
   * @param imageBuffer - Original slide image as PNG buffer
   * @returns Cleaned image buffer with text removed
   */
  async removeTextFromImage(imageBuffer: Buffer): Promise<Buffer> {
    console.log(`  Removing text from image...`);

    const base64Image = imageBuffer.toString("base64");

    // Use the deployment-specific endpoint for image generation
    const endpoint = this.config.azureImageEndpoint;
    const url = `${endpoint}/images/generations?api-version=2024-10-21`;

    const requestBody = {
      prompt:
        "Remove ALL text, letters, numbers, and written words from this image completely. " +
        "Fill the areas where text was with the surrounding background pattern, color, or texture " +
        "so it looks natural and seamless. Preserve all illustrations, icons, photos, shapes, " +
        "decorative elements, and background patterns exactly as they are. " +
        "The result should look like the original slide but with absolutely no text visible anywhere.",
      n: 1,
      size: "1024x1024",
      image: `data:image/png;base64,${base64Image}`,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": this.config.azureImageApiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      // If the generations endpoint with image doesn't work, try the edits endpoint
      console.log(
        `  Generations endpoint returned ${response.status}, trying edits endpoint...`
      );
      return this.removeTextViaEditsEndpoint(imageBuffer);
    }

    const result = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = result.data?.[0];
    if (!imageData) {
      throw new Error("FLUX API returned no image data");
    }

    if (imageData.b64_json) {
      return Buffer.from(imageData.b64_json, "base64");
    }

    if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    throw new Error("FLUX API returned neither b64_json nor url");
  }

  /**
   * Fallback: Try the /images/edits endpoint for text removal.
   */
  private async removeTextViaEditsEndpoint(
    imageBuffer: Buffer
  ): Promise<Buffer> {
    const endpoint = this.config.azureImageEndpoint;
    const url = `${endpoint}/images/edits?api-version=2024-10-21`;

    // Create multipart form data
    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(imageBuffer)], { type: "image/png" });
    formData.append("image", imageBlob, "slide.png");
    formData.append(
      "prompt",
      "Remove ALL text, letters, numbers, and written words from this image completely. " +
        "Fill the areas where text was with the surrounding background pattern, color, or texture. " +
        "Preserve all illustrations, icons, photos, shapes, and decorative elements exactly as they are."
    );
    formData.append("n", "1");
    formData.append("size", "1024x1024");

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
        `  FLUX edits endpoint also failed (${response.status}): ${errorText}`
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
      console.warn("  FLUX edits returned no data, using original image");
      return imageBuffer;
    }

    if (imageData.b64_json) {
      return Buffer.from(imageData.b64_json, "base64");
    }

    if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    return imageBuffer;
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
