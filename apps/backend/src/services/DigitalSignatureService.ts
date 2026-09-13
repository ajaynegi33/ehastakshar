import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { plainAddPlaceholder } from '@signpdf/placeholder-plain';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { SignatureVisualFactory } from './signature-visuals/SignatureVisualFactory.js';
import type { VisualSignatureDetails } from './signature-visuals/types.js';

export type { VisualSignatureDetails }; // Re-export for backwards compatibility

export class DigitalSignatureService {
  /**
   * Adds the visual signature elements using pdf-lib and allocates a placeholder
   * for the PKCS#7 cryptographic signature using @signpdf/utils.
   */
  static async addSignaturePlaceholder(pdfBuffer: Buffer, details: VisualSignatureDetails): Promise<Buffer> {
    // 1. First, manipulate the PDF visually using pdf-lib
    // We ignore encryption to allow modifying PDFs that have owner passwords or prior signatures.
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const strategy = SignatureVisualFactory.getStrategy(details.signatureType);
    await strategy.applyVisuals(pdfDoc, details, font, boldFont);

    // Save the PDF visually
    // We strictly disable Object Streams because @signpdf/placeholder-plain cannot parse compressed xref tables.
    const visuallyModifiedPdfBytes = await pdfDoc.save({ useObjectStreams: false });
    const initialBuffer = Buffer.from(visuallyModifiedPdfBytes);

    // 2. Add the cryptographic placeholder using @signpdf/utils
    // This adds the /ByteRange dictionary and allocates 8192 bytes for the PKCS#7 signature
    const pdfWithPlaceholder = plainAddPlaceholder({
      pdfBuffer: initialBuffer as Buffer<ArrayBuffer>,
      reason: 'Document e-Signature',
      contactInfo: details.ipAddress || '0.0.0.0',
      name: details.recipientName,
      location: 'India',
      signatureLength: 8192,
    });

    return Buffer.from(pdfWithPlaceholder);
  }

  /**
   * Reads the P12 certificate and applies a cryptographic PKCS#7 signature
   * to the allocated placeholder in the PDF.
   */
  static async sealDocument(pdfWithPlaceholderBuffer: Buffer): Promise<Buffer> {
    try {
      const p12Path = path.join(__dirname, '../assets/dev-cert.p12');
      
      if (!fs.existsSync(p12Path)) {
        throw new Error('Development certificate (dev-cert.p12) not found in assets folder.');
      }
      
      const p12Buffer = fs.readFileSync(p12Path);
      
      // Sign the PDF
      const signer = new P12Signer(p12Buffer, { passphrase: 'password' });
      const signpdf = new SignPdf();
      
      const signedPdf = await signpdf.sign(pdfWithPlaceholderBuffer, signer);
      
      return signedPdf;
    } catch (error) {
      logger.error({ err: error }, 'Cryptographic PDF sealing failed');
      throw error;
    }
  }
}
