import * as mupdf from "mupdf";
import type { PageImage } from "../types/slide.js";

/**
 * Service for converting PDF pages to high-resolution images using MuPDF.
 */
export class PdfService {
  /**
   * Convert each page of a PDF file to a PNG image buffer.
   * @param pdfPath - Path to the input PDF file
   * @param dpi - Resolution for rendering (default: 200)
   * @returns Array of PageImage objects with image buffers
   */
  static async convertToImages(
    pdfPath: string,
    dpi: number = 200
  ): Promise<PageImage[]> {
    const document = mupdf.Document.openDocument(pdfPath, "application/pdf");
    const pageCount = document.countPages();
    const pages: PageImage[] = [];

    console.log(`PDF loaded: ${pageCount} pages`);

    const scaleFactor = dpi / 72; // MuPDF uses 72 DPI internally

    for (let i = 0; i < pageCount; i++) {
      const page = document.loadPage(i);
      const bounds = page.getBounds();
      const pageWidth = bounds[2] - bounds[0];
      const pageHeight = bounds[3] - bounds[1];

      // Create a pixmap at the desired DPI
      const matrix = mupdf.Matrix.scale(scaleFactor, scaleFactor);
      const pixmap = page.toPixmap(
        matrix,
        mupdf.ColorSpace.DeviceRGB,
        false, // no alpha
        true   // annots
      );

      // Convert pixmap to PNG buffer
      const pngBuffer = pixmap.asPNG();

      const renderedWidth = Math.round(pageWidth * scaleFactor);
      const renderedHeight = Math.round(pageHeight * scaleFactor);

      pages.push({
        pageNumber: i + 1,
        imageBuffer: Buffer.from(pngBuffer),
        width: renderedWidth,
        height: renderedHeight,
      });

      console.log(
        `  Page ${i + 1}/${pageCount}: ${renderedWidth}x${renderedHeight}px`
      );
    }

    return pages;
  }
}
