import dotenv from "dotenv";
import type { AppConfig } from "./types/config.js";

dotenv.config();

/**
 * Load application configuration from environment variables.
 * Throws if required variables are missing.
 */
export function loadConfig(overrides?: Partial<AppConfig>): AppConfig {
  const azureEndpoint =
    overrides?.azureEndpoint ??
    process.env["AZURE_ENDPOINT"] ??
    "";
  const azureApiKey =
    overrides?.azureApiKey ??
    process.env["AZURE_API_KEY"] ??
    "";

  if (!azureEndpoint) {
    throw new Error(
      "AZURE_ENDPOINT is required. Set it in .env or pass --endpoint.\n" +
        "Example: https://ph-foundry.services.ai.azure.com/api/projects/proj-default"
    );
  }
  if (!azureApiKey) {
    throw new Error(
      "AZURE_API_KEY is required. Set it in .env or pass --api-key."
    );
  }

  return {
    azureEndpoint,
    azureApiKey,
    visionModel:
      overrides?.visionModel ??
      process.env["AZURE_VISION_MODEL"] ??
      "gpt-4o",
    imageModel:
      overrides?.imageModel ??
      process.env["AZURE_IMAGE_MODEL"] ??
      "FLUX.1-Kontext-pro",
    pdfDpi: overrides?.pdfDpi ?? parseInt(process.env["PDF_DPI"] ?? "200", 10),
    slideWidth:
      overrides?.slideWidth ??
      parseFloat(process.env["SLIDE_WIDTH"] ?? "13.333"),
    slideHeight:
      overrides?.slideHeight ??
      parseFloat(process.env["SLIDE_HEIGHT"] ?? "7.5"),
  };
}
