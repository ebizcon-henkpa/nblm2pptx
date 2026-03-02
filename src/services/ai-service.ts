import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import type { AppConfig } from "../types/config.js";
import type { SlideData, SlideElement } from "../types/slide.js";
import {
  SLIDE_ANALYSIS_SYSTEM_PROMPT,
  getSlideAnalysisUserPrompt,
} from "../prompts/slide-analysis.js";

/**
 * Service for AI-powered slide analysis using Azure AI Foundry vision models.
 */
export class AiService {
  private readonly config: AppConfig;
  private readonly client: ReturnType<typeof ModelClient>;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = ModelClient(
      this.config.azureEndpoint,
      new AzureKeyCredential(this.config.azureApiKey)
    );
  }

  /**
   * Analyze a slide image using the vision model and return structured slide data.
   * @param imageBase64 - Base64-encoded PNG image of the slide
   * @param pageNumber - The page number for logging/context
   * @returns Structured SlideData with all detected elements
   */
  async analyzeSlide(
    imageBase64: string,
    pageNumber: number
  ): Promise<SlideData> {
    console.log(`  Analyzing slide ${pageNumber} with ${this.config.visionModel}...`);

    const response = await this.client.path("/chat/completions").post({
      body: {
        model: this.config.visionModel,
        messages: [
          {
            role: "system",
            content: SLIDE_ANALYSIS_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: getSlideAnalysisUserPrompt(pageNumber),
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${imageBase64}`,
                  detail: "high",
                },
              },
            ],
          },
        ],
        max_tokens: 4096,
        temperature: 0.1,
        response_format: { type: "json_object" },
      },
    });

    if (response.status !== "200") {
      const errorBody = response.body as unknown as Record<string, unknown>;
      throw new Error(
        `Vision API error (${response.status}): ${JSON.stringify(errorBody)}`
      );
    }

    const body = response.body as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = body.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Vision API returned empty response");
    }

    const parsed = JSON.parse(content) as {
      backgroundColor?: string;
      elements?: unknown[];
    };

    const elements = this.validateElements(parsed.elements ?? []);

    return {
      pageNumber,
      backgroundColor: parsed.backgroundColor ?? "#FFFFFF",
      elements,
    };
  }

  /**
   * Validate and type-check parsed elements from AI response.
   */
  private validateElements(rawElements: unknown[]): SlideElement[] {
    const elements: SlideElement[] = [];

    for (const raw of rawElements) {
      if (typeof raw !== "object" || raw === null) continue;
      const el = raw as Record<string, unknown>;
      const type = el["type"] as string | undefined;

      if (!type) continue;

      const position = el["position"] as
        | { x: number; y: number; w: number; h: number }
        | undefined;
      if (
        !position ||
        typeof position.x !== "number" ||
        typeof position.y !== "number" ||
        typeof position.w !== "number" ||
        typeof position.h !== "number"
      ) {
        continue;
      }

      switch (type) {
        case "title":
        case "text": {
          const text = el["text"] as string | undefined;
          const style = this.parseTextStyle(el["style"]);
          if (text && style) {
            elements.push({ type, position, text, style });
          }
          break;
        }
        case "bulletList": {
          const items = this.parseBulletItems(el["items"]);
          const style = this.parseTextStyle(el["style"]);
          if (items.length > 0 && style) {
            elements.push({ type: "bulletList", position, items, style });
          }
          break;
        }
        case "image": {
          const description =
            (el["description"] as string | undefined) ?? "Image";
          elements.push({ type: "image", position, description });
          break;
        }
        case "shape": {
          const shapeType = (el["shapeType"] as string) ?? "rectangle";
          const validShapeTypes = [
            "rectangle",
            "circle",
            "line",
            "arrow",
            "rounded_rectangle",
          ] as const;
          const validatedShapeType = validShapeTypes.includes(
            shapeType as (typeof validShapeTypes)[number]
          )
            ? (shapeType as (typeof validShapeTypes)[number])
            : "rectangle";

          elements.push({
            type: "shape",
            position,
            shapeType: validatedShapeType,
            fillColor: (el["fillColor"] as string) ?? undefined,
            borderColor: (el["borderColor"] as string) ?? undefined,
            borderWidth: (el["borderWidth"] as number) ?? undefined,
            text: (el["text"] as string) ?? undefined,
            textStyle: this.parseTextStyle(el["textStyle"]) ?? undefined,
          });
          break;
        }
      }
    }

    return elements;
  }

  /**
   * Parse and validate a text style object from the AI response.
   */
  private parseTextStyle(raw: unknown): {
    fontSize: number;
    bold: boolean;
    italic: boolean;
    color: string;
    align: "left" | "center" | "right";
  } | null {
    if (typeof raw !== "object" || raw === null) return null;
    const style = raw as Record<string, unknown>;

    const fontSize =
      typeof style["fontSize"] === "number" ? style["fontSize"] : 16;
    const bold = typeof style["bold"] === "boolean" ? style["bold"] : false;
    const italic =
      typeof style["italic"] === "boolean" ? style["italic"] : false;
    const color =
      typeof style["color"] === "string" ? style["color"] : "#333333";
    const alignRaw = style["align"] as string | undefined;
    const align =
      alignRaw === "left" || alignRaw === "center" || alignRaw === "right"
        ? alignRaw
        : "left";

    return { fontSize, bold, italic, color, align };
  }

  /**
   * Parse bullet items from the AI response.
   */
  private parseBulletItems(
    raw: unknown
  ): Array<{ text: string; level: number; bold: boolean }> {
    if (!Array.isArray(raw)) return [];

    return raw
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item) => ({
        text: typeof item["text"] === "string" ? item["text"] : "",
        level: typeof item["level"] === "number" ? item["level"] : 0,
        bold: typeof item["bold"] === "boolean" ? item["bold"] : false,
      }))
      .filter((item) => item.text.length > 0);
  }
}
