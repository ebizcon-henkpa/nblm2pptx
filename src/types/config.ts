/**
 * Application configuration loaded from environment variables.
 */
export interface AppConfig {
  /** Azure AI Foundry project endpoint (e.g. https://xxx.services.ai.azure.com/api/projects/proj-default) */
  azureEndpoint: string;
  /** Azure AI API key */
  azureApiKey: string;
  /** Vision model deployment name for slide analysis (e.g. gpt-4o) */
  visionModel: string;
  /** Image editing model deployment name (e.g. FLUX.1-Kontext-pro) */
  imageModel: string;
  /** DPI for rendering PDF pages (default: 200) */
  pdfDpi: number;
  /** PPTX slide width in inches (default: 13.333, widescreen 16:9) */
  slideWidth: number;
  /** PPTX slide height in inches (default: 7.5, widescreen 16:9) */
  slideHeight: number;
}
