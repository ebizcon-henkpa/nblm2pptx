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
    "--skip-text-removal",
    "Skip FLUX text removal (use original image as background)",
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

  // Load configuration
  const config = loadConfig({
    azureVisionEndpoint: options["visionEndpoint"] as string | undefined,
    azureVisionApiKey: options["visionApiKey"] as string | undefined,
    azureImageEndpoint: options["imageEndpoint"] as string | undefined,
    azureImageApiKey: options["imageApiKey"] as string | undefined,
    pdfDpi: options["dpi"] ? parseInt(options["dpi"] as string, 10) : undefined,
  });

  const skipTextRemoval = options["skipTextRemoval"] === true;
  const maxSlide = options["maxSlide"]
    ? parseInt(options["maxSlide"] as string, 10)
    : undefined;

  console.log(`\nConfig:`);
  console.log(`  Vision endpoint: ${config.azureVisionEndpoint}`);
  console.log(`  Image endpoint:  ${config.azureImageEndpoint}`);
  console.log(`  PDF DPI:         ${config.pdfDpi}`);
  console.log(`  Text removal:    ${skipTextRemoval ? "DISABLED" : "ENABLED"}`);
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

    // Step 3: Crop image elements from the original page (before any modifications)
    // We add padding to image bounding boxes so the crop/mask fully covers the icon,
    // even if the AI's bounding box is slightly too small.
    const IMAGE_PADDING_PCT = 3; // extra % on each side
    const croppedImages = new Map<number, Buffer>();
    const imageRegions: { x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < slideData.elements.length; i++) {
      const element = slideData.elements[i];
      if (element?.type === "image") {
        // Pad the bounding box and clamp to 0-100
        const padded = {
          x: Math.max(0, element.position.x - IMAGE_PADDING_PCT),
          y: Math.max(0, element.position.y - IMAGE_PADDING_PCT),
          w: Math.min(100 - Math.max(0, element.position.x - IMAGE_PADDING_PCT),
            element.position.w + IMAGE_PADDING_PCT * 2),
          h: Math.min(100 - Math.max(0, element.position.y - IMAGE_PADDING_PCT),
            element.position.h + IMAGE_PADDING_PCT * 2),
        };
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
    // Strategy: FLUX removes text only (from the original image with icons intact).
    // Then we mask out image regions AFTER, so the icons don't appear in the
    // background. This prevents FLUX from "hallucinating" new images in the
    // masked areas (e.g. generating faces where icons used to be).
    let cleanBackground: Buffer;

    if (skipTextRemoval) {
      cleanBackground = page.imageBuffer;
    } else {
      console.log(`  Sending to FLUX for text removal...`);
      cleanBackground = await imageService.removeTextFromImage(page.imageBuffer);
    }

    // Use FLUX inpainting to fill image regions with natural background.
    // This sends a second FLUX call with a mask so FLUX extends the
    // background seamlessly into the areas where images were.
    if (imageRegions.length > 0) {
      cleanBackground = await imageService.inpaintImageRegions(
        cleanBackground,
        imageRegions,
        page.width,
        page.height
      );
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
