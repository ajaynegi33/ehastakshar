import { PDFDocument, PDFFont, rgb } from 'pdf-lib';
import type { IVisualSignatureStrategy } from './IVisualSignatureStrategy.js';
import type { VisualSignatureDetails } from './types.js';
import { logger } from '../../utils/logger.js';

export class DigitalSignatureVisualStrategy implements IVisualSignatureStrategy {
  async applyVisuals(
    pdfDoc: PDFDocument,
    details: VisualSignatureDetails,
    font: PDFFont,
    boldFont: PDFFont
  ): Promise<void> {
    const pages = pdfDoc.getPages();
    if (pages.length === 0) return;

    const istFormatter = new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });
    const formattedDate = istFormatter.format(new Date());

    let embeddedSignatureImage: any = null;
    let signatureDims = { width: 0, height: 0 };

    const boxWidth = 120; // Changed from 140
    const innerPadding = 0; // Changed from 2
    const targetImgWidth = boxWidth - (innerPadding * 2);
    const maxImgHeight = 25; // Constrain image height to 25px

    if (details.signatureUrl) {
      try {
        const imageRes = await fetch(details.signatureUrl);
        const imageArrayBuffer = await imageRes.arrayBuffer();
        const firstByte = new Uint8Array(imageArrayBuffer)[0];
        if (firstByte === 0x89) {
          embeddedSignatureImage = await pdfDoc.embedPng(imageArrayBuffer);
        } else {
          embeddedSignatureImage = await pdfDoc.embedJpg(imageArrayBuffer);
        }
        
        // Scale to fit max width and max height
        signatureDims = embeddedSignatureImage.scaleToFit(targetImgWidth, maxImgHeight);
      } catch (err) {
        logger.error({ err }, "Failed to embed signature image in PDF for digital signing");
      }
    }

    const imgHeight = embeddedSignatureImage ? signatureDims.height : 0;
    const imgWidth = embeddedSignatureImage ? signatureDims.width : 0;

    // The user ONLY wants the Date string, removing name and txn ID
    const textLines = [
      `Date: ${formattedDate} IST`
    ];

    const lineHeight = 8; // Changed from 12
    const textHeight = textLines.length * lineHeight;
    const totalHeight = imgHeight + textHeight + (innerPadding * 3);

    const paddingX = 5; // right distance, changed from 20
    const paddingY = 5; // bottom distance, changed from 20

    pages.forEach(page => {
      const { width } = page.getSize();
      const boxX = width - boxWidth - paddingX;
      const boxY = paddingY; // Bottom right corner

      // Draw the visual border box
      page.drawRectangle({
        x: boxX,
        y: boxY,
        width: boxWidth,
        height: totalHeight,
        borderColor: rgb(0.2, 0.2, 0.2), // #333333
        borderWidth: 0.9, // Changed from 1
        color: rgb(0.98, 0.98, 0.98) // #FAFAFA
      });

      // Draw image if exists
      if (embeddedSignatureImage) {
        page.drawImage(embeddedSignatureImage, {
          x: boxX + (boxWidth - imgWidth) / 2, // center image horizontally
          y: boxY + textHeight + (innerPadding * 2), // place image above text
          width: imgWidth,
          height: imgHeight,
        });
      }

      // Draw the text lines
      let currentTextY = boxY + textHeight + innerPadding - lineHeight;
      textLines.forEach((line) => {
        page.drawText(line, {
          x: boxX + innerPadding + 2, // Slight indent for text (from HTML padding-left: 2px)
          y: currentTextY,
          size: 8,
          font: font, // Using regular font since there is no bold line anymore
          color: rgb(0, 0, 0),
        });
        currentTextY -= lineHeight;
      });
    });
  }
}
