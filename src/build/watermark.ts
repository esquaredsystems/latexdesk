// Watermarked copy of a built PDF (OL-49). Bundled separately and loaded only when the command
// runs, because pdf-lib is large compared with the rest of the extension.
import { degrees, PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export type Placement = 'diagonal' | 'top' | 'bottom';

export interface WatermarkOptions {
  text: string;
  placement: Placement;
  /** 0 (invisible) to 1 (solid). */
  opacity: number;
}

/** Thrown when the standard PDF font cannot show a character of the watermark text. */
export class UnsupportedTextError extends Error {}

export async function watermarkPdf(input: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(input, { updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = options.text.trim();
  let unitWidth: number;
  try {
    unitWidth = font.widthOfTextAtSize(text, 1);
  } catch {
    throw new UnsupportedTextError('The watermark text can only use Latin characters.');
  }
  const color = rgb(0.5, 0.5, 0.5);
  const opacity = Math.min(1, Math.max(0.02, options.opacity));

  for (const page of pdf.getPages()) {
    const box = page.getMediaBox();
    const { width, height } = box;
    if (options.placement === 'diagonal') {
      // Corner to corner, filling about 70 % of the diagonal, centred on the page.
      const angle = Math.atan2(height, width);
      const size = (0.7 * Math.hypot(width, height)) / unitWidth;
      const textWidth = unitWidth * size;
      const capHeight = size * 0.72;
      const x = box.x + width / 2 - (Math.cos(angle) * textWidth) / 2 + (Math.sin(angle) * capHeight) / 2;
      const y = box.y + height / 2 - (Math.sin(angle) * textWidth) / 2 - (Math.cos(angle) * capHeight) / 2;
      page.drawText(text, { x, y, size, font, color, opacity, rotate: degrees((angle * 180) / Math.PI) });
    } else {
      // A line of text centred in the top or bottom margin, never wider than 90 % of the page.
      const size = Math.min(14, (0.9 * width) / unitWidth);
      const x = box.x + (width - unitWidth * size) / 2;
      const y = options.placement === 'top' ? box.y + height - 24 - size * 0.72 : box.y + 24;
      page.drawText(text, { x, y, size, font, color, opacity });
    }
  }
  return pdf.save();
}
