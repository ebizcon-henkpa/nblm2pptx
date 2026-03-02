#!/usr/bin/env node

import { Command } from "commander";
import path from "path";
import fs from "fs";
import { loadConfig } from "./config.js";
import { PdfService } from "./services/pdf-service.js";
import { AiService } from "./services/ai-service.js";
import { ImageService } from "./services/image-service.js";
import { PptxService } from "./services/pptx-service.js";
import type { ProcessedSlide } from "./types/slide.js";

const program = new Command();

program
  .name("nblm2pptx")
  .description(
    "Convert NotebookLM PDF slides to editable PowerPoint presentations using AI"
  )
  .version("1.0.0")
  .argument("<input>", "Input PDF file path")
  .argument("[output]", "Output PPTX file path (default: input name with .pptx)")
  .option(
    "--vision-endpoint <url>",
    "Azure OpenAI deployment endpoint for vision model (e.g. https://ph-foundry.cognitiveservices.azure.com/openai/deployments/gpt-4o)"
  )
  .option("--vision-api-key <key>", "API key for vision model endpoint")
  .option(
    "--image-endpoint <url>",
    "Azure deployment endpoint for image model (e.g. https://ph-foundry.services.ai.azure.com/openai/deployments/FLUX.1-Kontext-pro)"
  )
  .option("--image-api-key <key>", "API key for image model endpoint")
  .option("--dpi <number>", "PDF render DPI", "200")
  .option("--max-slide <number>", "Only convert up to this slide number (e.g. 3 = slides 1-3)")
  .option(
    "--flux-text-removal",
    "Enable FLUX text removal from backgrounds (disabled by default to preserve visual fidelity)",
    false
  )
  .action(async (input: string, output: string | undefined, options: Record<string, string | boolean | undefined>) => {
    try {
      await convert(input, output, options);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`\nError: ${error.message}`);
        if (process.env["DEBUG"]) {
          console.error(error.stack);
        }
      } else {
        console.error("\nUnknown error:", error);
      }
      process.exit(1);
    }
  });

program.parse();

/**
 * Main conversion pipeline: PDF -> AI Analysis -> FLUX Text Removal -> PPTX
 */
async function convert(
  inputPath: string,
  outputPath: string | undefined,
  options: Record<string, string | boolean | undefined>
): Promise<void> {
  // Resolve paths
  const resolvedInput = path.resolve(inputPath);
  if (!fs.existsSync(resolvedInput)) {
    throw new Error(`Input file not found: ${resolvedInput}`);
  }

  const resolvedOutput =
    outputPath !== undefined
      ? path.resolve(outputPath)
      : resolvedInput.replace(/\.pdf$/i, ".pptx");

  console.log(`\nnblm2pptx - NotebookLM PDF to PowerPoint Converter`);
  console.log(`${"=".repeat(52)}`);
  console.log(`Input:  ${resolvedInput}`);
  console.log(`Output: ${resolvedOutput}`);

  const skipTextRemoval = options["fluxTextRemoval"] !== true;

  // Load configuration (image endpoint only required when FLUX is enabled)
  const config = loadConfig({
    azureVisionEndpoint: options["visionEndpoint"] as string | undefined,
    azureVisionApiKey: options["visionApiKey"] as string | undefined,
    azureImageEndpoint: options["imageEndpoint"] as string | undefined,
    azureImageApiKey: options["imageApiKey"] as string | undefined,
    pdfDpi: options["dpi"] ? parseInt(options["dpi"] as string, 10) : undefined,
  }, !skipTextRemoval);
  const maxSlide = options["maxSlide"]
    ? parseInt(options["maxSlide"] as string, 10)
    : undefined;

  console.log(`\nConfig:`);
  console.log(`  Vision endpoint: ${config.azureVisionEndpoint}`);
  console.log(`  Image endpoint:  ${config.azureImageEndpoint}`);
  console.log(`  PDF DPI:         ${config.pdfDpi}`);
  console.log(`  FLUX text removal: ${skipTextRemoval ? "DISABLED (using original background)" : "ENABLED"}`);
  console.log(`  Max slide:       ${maxSlide ?? "all"}`);
  console.log(`  Slide size:      ${config.slideWidth}" x ${config.slideHeight}"`);

  // Initialize services
  const aiService = new AiService(config);
  const imageService = new ImageService(config);
  const pptxService = new PptxService(config);

  // Step 1: Convert PDF pages to images
  console.log(`\n[1/4] Converting PDF to images...`);
  let pages = await PdfService.convertToImages(resolvedInput, config.pdfDpi);

  // Filter pages if --max-slide is set
  if (maxSlide !== undefined && maxSlide > 0) {
    pages = pages.filter((p) => p.pageNumber <= maxSlide);
    console.log(`  Limited to slides 1-${maxSlide} (${pages.length} pages)`);
  }

  // Step 2: Analyze each slide with AI vision model
  console.log(`\n[2/4] Analyzing slides with AI...`);
  const processedSlides: ProcessedSlide[] = [];

  for (const page of pages) {
    const base64Image = page.imageBuffer.toString("base64");

    // Analyze slide structure
    const slideData = await aiService.analyzeSlide(base64Image, page.pageNumber);
    console.log(
      `  Slide ${page.pageNumber}: ${slideData.elements.length} elements detected`
    );

    // Log all detected elements for debugging
    for (let i = 0; i < slideData.elements.length; i++) {
      const el = slideData.elements[i];
      if (!el) continue;
      const p = el.position;
      const desc = el.type === "image" ? ` "${el.description}"` : el.type === "title" || el.type === "text" ? ` "${el.text.substring(0, 30)}..."` : "";
      console.log(`    [${i}] ${el.type} at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.w.toFixed(1)}x${p.h.toFixed(1)})${desc}`);
    }

    // Step 3: Crop image elements from the original page (before any modifications)
    // We add padding to image bounding boxes so the crop fully covers the icon,
    // but we must avoid overlapping text regions (otherwise the cropped "image"
    // may include text and cause visible duplication).
    const IMAGE_PADDING_PCT = 5; // try this first, may be reduced to avoid text overlap

    const textRegions = slideData.elements
      .filter((el) => el?.type === "title" || el?.type === "text" || el?.type === "bulletList")
      .map((el) => el.position);

    const boxesOverlap = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number }
    ): boolean => {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    };

    const padAndClamp = (
      box: { x: number; y: number; w: number; h: number },
      pad: number
    ): { x: number; y: number; w: number; h: number } => {
      const x = Math.max(0, box.x - pad);
      const y = Math.max(0, box.y - pad);
      const w = Math.min(100 - x, box.w + pad * 2);
      const h = Math.min(100 - y, box.h + pad * 2);
      return { x, y, w, h };
    };

    const croppedImages = new Map<number, Buffer>();
    const imageRegions: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < slideData.elements.length; i++) {
      const element = slideData.elements[i];
      if (element?.type === "image") {
        let pad = IMAGE_PADDING_PCT;
        let padded = padAndClamp(element.position, pad);

        // Reduce padding if we intersect any text regions
        while (pad > 0 && textRegions.some((t) => boxesOverlap(padded, t))) {
          pad = Math.max(0, pad - 0.5);
          padded = padAndClamp(element.position, pad);
        }

        console.log(
          `    Image [${i}]: original (${element.position.x.toFixed(1)}, ${element.position.y.toFixed(1)}, ${element.position.w.toFixed(1)}x${element.position.h.toFixed(1)}) → padded (pad=${pad.toFixed(1)}%) (${padded.x.toFixed(1)}, ${padded.y.toFixed(1)}, ${padded.w.toFixed(1)}x${padded.h.toFixed(1)})`
        );

        imageRegions.push(padded);
        // Also update the element position so PPTX placement matches the padded crop
        element.position = padded;
        try {
          const cropped = await ImageService.cropRegion(
            page.imageBuffer,
            padded,
            page.width,
            page.height
          );
          croppedImages.set(i, cropped);
        } catch (err) {
          console.warn(
            `  Warning: Could not crop image element ${i}: ${err instanceof Error ? err.message : "Unknown error"}`
          );
        }
      }
    }

    // Step 4: Create clean background
    // By default, use the original PDF page as the background. This preserves
    // all decorative elements (circuit patterns, gradients, shapes, etc.) exactly.
    // FLUX text removal is available but off by default since it tends to destroy
    // complex backgrounds, producing results that look nothing like the original.
    let cleanBackground: Buffer;

    if (!skipTextRemoval) {
      console.log(`  Sending to FLUX for text removal...`);
      cleanBackground = await imageService.removeTextFromImage(page.imageBuffer);

      // Use FLUX inpainting to fill image regions with natural background.
      if (imageRegions.length > 0) {
        cleanBackground = await imageService.inpaintImageRegions(
          cleanBackground,
          imageRegions,
          page.width,
          page.height
        );
      }
    } else {
      cleanBackground = page.imageBuffer;
    }

    processedSlides.push({
      slideData,
      cleanBackground,
      croppedImages,
      pageWidth: page.width,
      pageHeight: page.height,
    });
  }

  // Step 4: Generate PPTX
  console.log(`\n[4/4] Generating PowerPoint presentation...`);
  await pptxService.generate(processedSlides, resolvedOutput);

  console.log(`\nDone! ${processedSlides.length} slides converted.`);
}
