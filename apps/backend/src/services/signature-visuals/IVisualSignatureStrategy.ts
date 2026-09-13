import type { PDFDocument, PDFFont } from 'pdf-lib';
import type { VisualSignatureDetails } from './types.js';

export interface IVisualSignatureStrategy {
  applyVisuals(
    pdfDoc: PDFDocument, 
    details: VisualSignatureDetails, 
    font: PDFFont, 
    boldFont: PDFFont
  ): Promise<void>;
}
