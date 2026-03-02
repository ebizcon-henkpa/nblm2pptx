import dotenv from "dotenv";
import type { AppConfig } from "./types/config.js";

dotenv.config();

/**
 * Load application configuration from environment variables.
 * Throws if required variables are missing.
 *
 * Each model has its own deployment-specific endpoint URL and API key.
 * These are found in Azure AI Foundry under Models + Endpoints for each deployment.
 */
export function loadConfig(overrides?: Partial<AppConfig>, requireImageEndpoint = false): AppConfig {
  const azureVisionEndpoint =
    overrides?.azureVisionEndpoint ??
    process.env["AZURE_VISION_ENDPOINT"] ??
    "";
  const azureVisionApiKey =
    overrides?.azureVisionApiKey ??
    process.env["AZURE_VISION_API_KEY"] ??
    "";
  const azureImageEndpoint =
    overrides?.azureImageEndpoint ??
    process.env["AZURE_IMAGE_ENDPOINT"] ??
    "";
  const azureImageApiKey =
    overrides?.azureImageApiKey ??
    process.env["AZURE_IMAGE_API_KEY"] ??
    "";

  if (!azureVisionEndpoint) {
    throw new Error(
      "AZURE_VISION_ENDPOINT is required. Set it in .env or pass --vision-endpoint.\n" +
        "Example: https://ph-foundry.cognitiveservices.azure.com/openai/deployments/gpt-4o"
    );
  }
  if (!azureVisionApiKey) {
    throw new Error(
      "AZURE_VISION_API_KEY is required. Set it in .env or pass --vision-api-key."
    );
  }
  if (requireImageEndpoint) {
    if (!azureImageEndpoint) {
      throw new Error(
        "AZURE_IMAGE_ENDPOINT is required for FLUX text removal. Set it in .env or pass --image-endpoint.\n" +
          "Example: https://ph-foundry.services.ai.azure.com/openai/deployments/FLUX.1-Kontext-pro"
      );
    }
    if (!azureImageApiKey) {
      throw new Error(
        "AZURE_IMAGE_API_KEY is required for FLUX text removal. Set it in .env or pass --image-api-key."
      );
    }
  }

  return {
    azureVisionEndpoint: azureVisionEndpoint.replace(/\/$/, ""),
    azureVisionApiKey,
    azureImageEndpoint: azureImageEndpoint.replace(/\/$/, ""),
    azureImageApiKey,
    pdfDpi: overrides?.pdfDpi ?? parseInt(process.env["PDF_DPI"] ?? "200", 10),
    slideWidth:
      overrides?.slideWidth ??
      parseFloat(process.env["SLIDE_WIDTH"] ?? "13.333"),
    slideHeight:
      overrides?.slideHeight ??
      parseFloat(process.env["SLIDE_HEIGHT"] ?? "7.5"),
  };
}
