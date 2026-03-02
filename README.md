# nblm2pptx

Convert NotebookLM PDF slides to editable PowerPoint (.pptx) presentations using AI models from Azure AI Foundry.

## Features

- Extracts slide structure using AI vision models (GPT-4o)
- Removes text from slide images using FLUX.1-Kontext-pro for clean backgrounds
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

Required environment variables:
- `AZURE_ENDPOINT` - Your Azure AI Foundry project endpoint
- `AZURE_API_KEY` - Your Azure AI API key

Optional:
- `AZURE_VISION_MODEL` - Vision model name (default: `gpt-4o`)
- `AZURE_IMAGE_MODEL` - Image model name (default: `FLUX.1-Kontext-pro`)
- `PDF_DPI` - PDF render resolution (default: `200`)

## Usage

```bash
# Basic usage
npx nblm2pptx input.pdf output.pptx

# With CLI options
npx nblm2pptx input.pdf output.pptx --vision-model gpt-4o --dpi 300

# Skip text removal (use original images as backgrounds)
npx nblm2pptx input.pdf --skip-text-removal

# With explicit endpoint
npx nblm2pptx input.pdf --endpoint https://ph-foundry.services.ai.azure.com/api/projects/proj-default --api-key YOUR_KEY
```

## How It Works

1. **PDF to Images** - Each PDF page is rendered as a high-resolution PNG using MuPDF
2. **AI Analysis** - A vision model (GPT-4o) analyzes each slide image and returns structured JSON with text content, positions, formatting, image regions, and shapes
3. **Text Removal** - FLUX.1-Kontext-pro removes all text from the slide image, creating a clean background
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
