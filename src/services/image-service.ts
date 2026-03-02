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
   * Use FLUX inpainting to fill image regions with the surrounding background.
   * Creates a mask (transparent where images are) and sends it to FLUX with
   * a prompt to extend the background seamlessly. This produces a natural fill
   * that respects gradients, textures, and patterns.
   *
   * @param imageBuffer - The FLUX-cleaned background image (text already removed)
   * @param imageRegions - Array of bounding boxes (percentage 0-100) for image elements
   * @param pageWidth - Width of the image in pixels
   * @param pageHeight - Height of the image in pixels
   * @returns Image buffer with image regions filled by FLUX
   */
  async inpaintImageRegions(
    imageBuffer: Buffer,
    imageRegions: BoundingBox[],
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer> {
    if (imageRegions.length === 0) {
      return imageBuffer;
    }

    console.log(`  Inpainting ${imageRegions.length} image region(s) with FLUX...`);

    const metadata = await sharp(imageBuffer).metadata();
    const isLandscape = (metadata.width ?? 1) > (metadata.height ?? 1);
    const fluxSize = isLandscape ? "1792x1024" : "1024x1792";
    const [targetW, targetH] = fluxSize.split("x").map(Number) as [number, number];

    // Resize image to FLUX dimensions
    const resizedImage = await sharp(imageBuffer)
      .resize(targetW, targetH, { fit: "cover" })
      .png()
      .toBuffer();

    // Create a mask image: fully opaque (white) everywhere, transparent where
    // image regions are. The transparent areas tell FLUX what to regenerate.
    // OpenAI-compatible mask: transparent = edit, opaque = keep
    const maskRects = imageRegions
      .map((bbox) => {
        const x = Math.round((bbox.x / 100) * targetW);
        const y = Math.round((bbox.y / 100) * targetH);
        const w = Math.round((bbox.w / 100) * targetW);
        const h = Math.round((bbox.h / 100) * targetH);
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="black" />`;
      })
      .join("\n    ");

    // White background (keep) + black rects (will become transparent = edit)
    const maskSvg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${targetW}" height="${targetH}">
    <rect width="${targetW}" height="${targetH}" fill="white" />
    ${maskRects}
  </svg>`
    );

    // Create mask: white areas kept, black areas → transparent (FLUX edits these)
    const maskPng = await sharp(maskSvg)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Convert: where pixel is black (R=0), set alpha to 0 (transparent)
    const pixels = Buffer.from(maskPng.data);
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!;
      if (r < 128) {
        // Black pixel → make transparent (FLUX should edit here)
        pixels[i] = 0;
        pixels[i + 1] = 0;
        pixels[i + 2] = 0;
        pixels[i + 3] = 0;
      } else {
        // White pixel → keep opaque (FLUX should preserve)
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = 255;
      }
    }

    const maskBuffer = await sharp(pixels, {
      raw: { width: maskPng.info.width, height: maskPng.info.height, channels: 4 },
    })
      .png()
      .toBuffer();

    // Send to FLUX with mask for inpainting
    const endpoint = this.config.azureImageEndpoint;
    const url = `${endpoint}/images/edits?api-version=${FLUX_API_VERSION}`;

    const formData = new FormData();
    const imageBlob = new Blob([new Uint8Array(resizedImage)], { type: "image/png" });
    const maskBlob = new Blob([new Uint8Array(maskBuffer)], { type: "image/png" });

    formData.append("image", imageBlob, "slide.png");
    formData.append("mask", maskBlob, "mask.png");
    formData.append(
      "prompt",
      "Fill the masked areas seamlessly with the surrounding background color, gradient, " +
        "and pattern. Extend the existing background naturally. " +
        "Do NOT add any objects, people, faces, icons, illustrations, or text. " +
        "Only extend the background."
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
        `  FLUX inpainting failed (${response.status}): ${errorText}`
      );
      console.warn("  Falling back to blur-based fill...");
      return ImageService.blurFillRegions(imageBuffer, imageRegions, pageWidth, pageHeight);
    }

    const result = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = result.data?.[0];
    if (!imageData) {
      console.warn("  FLUX inpainting returned no data, falling back to blur fill");
      return ImageService.blurFillRegions(imageBuffer, imageRegions, pageWidth, pageHeight);
    }

    let editedBuffer: Buffer;
    if (imageData.b64_json) {
      editedBuffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      const imageResponse = await fetch(imageData.url);
      const arrayBuffer = await imageResponse.arrayBuffer();
      editedBuffer = Buffer.from(arrayBuffer);
    } else {
      console.warn("  FLUX inpainting returned neither b64_json nor url, falling back");
      return ImageService.blurFillRegions(imageBuffer, imageRegions, pageWidth, pageHeight);
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
   * Fallback: blur-based fill for image regions when FLUX inpainting is unavailable.
   * Creates a heavily blurred version and composites blurred patches over image regions.
   */
  private static async blurFillRegions(
    imageBuffer: Buffer,
    imageRegions: BoundingBox[],
    pageWidth: number,
    pageHeight: number
  ): Promise<Buffer> {
    const blurSigma = Math.max(30, Math.round(pageWidth / 40));
    const blurredImage = await sharp(imageBuffer)
      .blur(blurSigma)
      .png()
      .toBuffer();

    let result = imageBuffer;
    for (const bbox of imageRegions) {
      const x = Math.max(0, Math.round((bbox.x / 100) * pageWidth));
      const y = Math.max(0, Math.round((bbox.y / 100) * pageHeight));
      const w = Math.min(pageWidth - x, Math.round((bbox.w / 100) * pageWidth));
      const h = Math.min(pageHeight - y, Math.round((bbox.h / 100) * pageHeight));
      if (w <= 0 || h <= 0) continue;

      const blurredPatch = await sharp(blurredImage)
        .extract({ left: x, top: y, width: w, height: h })
        .png()
        .toBuffer();

      result = await sharp(result)
        .composite([{ input: blurredPatch, left: x, top: y }])
        .png()
        .toBuffer();
    }
    return result;
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
