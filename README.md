# nblm2pptx

Convert NotebookLM PDF slides to editable PowerPoint (.pptx) presentations using AI models from Azure AI Foundry.

## Features

- Extracts slide structure using AI vision models (GPT-4o)
- Optional: removes text from slide images using FLUX.1-Kontext-pro (disabled by default to preserve the original look)
- Generates fully editable PowerPoint files with:
  - Native text boxes (editable text)
  - Cropped images/icons as separate objects
  - Shapes and decorative elements
  - Clean background images (text removed)

## Prerequisites

- Node.js 18+
- Azure AI Foundry account with deployed models:
  - A vision model (e.g. GPT-4o) for slide analysis
  - FLUX.1-Kontext-pro for image text removal

## Installation

```bash
npm install
npm run build
```

## Configuration

Copy `.env.example` to `.env` and set your Azure credentials:

```bash
cp .env.example .env
```

Required environment variables (find these in Azure AI Foundry → Models + Endpoints → select deployment):

- `AZURE_VISION_ENDPOINT` - GPT-4o deployment endpoint URL (e.g. `https://ph-foundry.cognitiveservices.azure.com/openai/deployments/gpt-4o`)
- `AZURE_VISION_API_KEY` - API key for the vision model endpoint
- `AZURE_IMAGE_ENDPOINT` - (only if using `--flux-text-removal`) FLUX deployment endpoint URL (e.g. `https://ph-foundry.services.ai.azure.com/openai/deployments/FLUX.1-Kontext-pro`)
- `AZURE_IMAGE_API_KEY` - (only if using `--flux-text-removal`) API key for the image model endpoint

Optional:
- `PDF_DPI` - PDF render resolution (default: `200`)

## Usage

```bash
# Basic usage
node dist/index.js input.pdf output.pptx

# Default behavior uses the original slide image as background (no FLUX)
node dist/index.js input.pdf

# Enable FLUX text removal from backgrounds (requires AZURE_IMAGE_* env vars)
node dist/index.js input.pdf --flux-text-removal

# With explicit endpoints (instead of .env)
node dist/index.js input.pdf \
  --vision-endpoint https://ph-foundry.cognitiveservices.azure.com/openai/deployments/gpt-4o \
  --vision-api-key YOUR_KEY \
  --image-endpoint https://ph-foundry.services.ai.azure.com/openai/deployments/FLUX.1-Kontext-pro \
  --image-api-key YOUR_KEY

# Higher DPI for better quality
node dist/index.js input.pdf --dpi 300
```

## How It Works

1. **PDF to Images** - Each PDF page is rendered as a high-resolution PNG using MuPDF
2. **AI Analysis** - A vision model (GPT-4o) analyzes each slide image and returns structured JSON with text content, positions, formatting, image regions, and shapes
3. **(Optional) Text Removal** - With `--flux-text-removal`, FLUX.1-Kontext-pro removes text from the slide image to create a clean background. By default, the original slide image is used as background to preserve visual fidelity.
4. **Image Cropping** - Detected image/icon regions are cropped from the original page
5. **PPTX Generation** - pptxgenjs assembles the final PowerPoint with clean backgrounds, editable text boxes, and image objects

## Project Structure

```
src/
  index.ts              - CLI entry point (commander)
  config.ts             - Configuration loader (.env / CLI args)
  types/
    slide.ts            - Type definitions for slide elements
    config.ts           - Configuration type
  services/
    pdf-service.ts      - PDF to PNG conversion (MuPDF)
    ai-service.ts       - Azure AI vision model integration
    image-service.ts    - FLUX text removal + image cropping
    pptx-service.ts     - PowerPoint generation (pptxgenjs)
  prompts/
    slide-analysis.ts   - AI prompt for structured slide analysis
```
