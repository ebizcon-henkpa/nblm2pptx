/**
 * Application configuration loaded from environment variables.
 */
export interface AppConfig {
  /**
   * Azure OpenAI endpoint for the vision model (GPT-4o).
   * This is the deployment-specific base URL, e.g.:
   * https://ph-foundry.cognitiveservices.azure.com/openai/deployments/gpt-4o
   */
  azureVisionEndpoint: string;
  /** API key for the vision model endpoint */
  azureVisionApiKey: string;
  /**
   * Azure endpoint for the image editing model (FLUX.1-Kontext-pro).
   * This is the deployment-specific base URL, e.g.:
   * https://ph-foundry.services.ai.azure.com/openai/deployments/FLUX.1-Kontext-pro
   */
  azureImageEndpoint: string;
  /** API key for the image model endpoint */
  azureImageApiKey: string;
  /** DPI for rendering PDF pages (default: 200) */
  pdfDpi: number;
  /** PPTX slide width in inches (default: 13.333, widescreen 16:9) */
  slideWidth: number;
  /** PPTX slide height in inches (default: 7.5, widescreen 16:9) */
  slideHeight: number;
}
