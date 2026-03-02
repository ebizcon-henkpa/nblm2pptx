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
    azureVisionEndpoint: options["vision-endpoint"] as string | undefined,
    azureVisionApiKey: options["vision-api-key"] as string | undefined,
    azureImageEndpoint: options["image-endpoint"] as string | undefined,
    azureImageApiKey: options["image-api-key"] as string | undefined,
    pdfDpi: options["dpi"] ? parseInt(options["dpi"] as string, 10) : undefined,
  });

  const skipTextRemoval = options["skip-text-removal"] === true;

  console.log(`\nConfig:`);
  console.log(`  Vision endpoint: ${config.azureVisionEndpoint}`);
  console.log(`  Image endpoint:  ${config.azureImageEndpoint}`);
  console.log(`  PDF DPI:         ${config.pdfDpi}`);
  console.log(`  Text removal:    ${skipTextRemoval ? "DISABLED" : "ENABLED"}`);
  console.log(`  Slide size:      ${config.slideWidth}" x ${config.slideHeight}"`);

  // Initialize services
  const aiService = new AiService(config);
  const imageService = new ImageService(config);
  const pptxService = new PptxService(config);

  // Step 1: Convert PDF pages to images
  console.log(`\n[1/4] Converting PDF to images...`);
  const pages = await PdfService.convertToImages(resolvedInput, config.pdfDpi);

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

    // Step 3: Process images - text removal and cropping
    let cleanBackground: Buffer;

    if (skipTextRemoval) {
      cleanBackground = page.imageBuffer;
    } else {
      console.log(`\n[3/4] Removing text from slide ${page.pageNumber}...`);
      cleanBackground = await imageService.removeTextFromImage(
        page.imageBuffer
      );
    }

    // Crop image elements from the original page
    const croppedImages = new Map<number, Buffer>();
    for (let i = 0; i < slideData.elements.length; i++) {
      const element = slideData.elements[i];
      if (element?.type === "image") {
        try {
          const cropped = await ImageService.cropRegion(
            page.imageBuffer,
            element.position,
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
