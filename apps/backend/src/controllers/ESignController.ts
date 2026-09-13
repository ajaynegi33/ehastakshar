import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { DocumentRepository } from "../repositories/DocumentRepository.js";
import { DocumentRecipientRepository } from "../repositories/DocumentRecipientRepository.js";
import { AuditLogRepository } from "../repositories/AuditLogRepository.js";
import { db } from "../db/index.js";
import { AuthService } from "../services/AuthService.js";
import { UAParser } from "ua-parser-js";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { getStorageProvider } from "../services/storage.service.js";
import { OtpRepository } from "../repositories/OtpRepository.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { DigitalSignatureService } from "../services/DigitalSignatureService.js";
import PDFDocumentKit from "pdfkit";
import { UserRepository } from "../repositories/UserRepository.js";

// Assume user is attached to req by auth middleware
interface AuthenticatedRequest extends Request {
  userId?: string;
}

export class ESignController {
  
  /**
   * Handle the single request submission to send a document for eSign.
   * Expects multipart/form-data. The PDF is streamed to storage by the middleware.
   */
  static async sendForESign(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uploaderId = req.userId;
      if (!uploaderId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const sender = await UserRepository.findById(uploaderId);
      const senderName = sender ? `${sender.firstName} ${sender.lastName}` : "Ehastakshar User";

      const { title, fileUrl, originalHash, recipients } = req.body;

      if (!fileUrl || !title || !recipients || !Array.isArray(recipients) || recipients.length === 0) {
        res.status(400).json({ error: "Missing required fields or invalid recipients format" });
        return;
      }

      const transactionId = uuidv4().replace(/-/g, "").substring(0, 24); // 24 char hex
      
      // Calculate Expiry Date (7 days from now)
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      // We use a transaction to ensure document and recipients are created together
      await db.transaction(async (tx) => {
        // 1. Create Document
        const newDocument = await DocumentRepository.create({
          uploaderId,
          title,
          fileUrl,
          originalHash,
          transactionId,
          status: "PENDING",
          signType: "DIGITAL",
          expiresAt,
        });

        // 2. Create Recipients
        const newRecipientsData = recipients.map((r: { name: string; email: string; requireGps?: boolean; requirePhoto?: boolean }) => ({
          documentId: newDocument.id,
          name: r.name,
          email: r.email,
          status: "PENDING" as const,
          secureToken: crypto.randomBytes(32).toString("hex"),
          requireGps: r.requireGps || false,
          requirePhoto: r.requirePhoto || false,
        }));
        
        const createdRecipients = await DocumentRecipientRepository.createMany(newRecipientsData);

        // 3. Log Audit Event for Upload
        await AuditLogRepository.logEvent({
          documentId: newDocument.id,
          action: "UPLOADED",
          ipAddress: req.ip || req.socket.remoteAddress || "",
          userAgent: req.headers["user-agent"] || "",
        });

        // 4. Send Emails & Log Invite Sent
        for (const recipient of createdRecipients) {
          const signingLink = `http://localhost:3000/sign/${recipient.secureToken}`;
          // Send email using Resend
          await AuthService.sendInviteEmail({
            email: recipient.email,
            link: signingLink,
            recipientName: recipient.name,
            senderName,
            documentName: newDocument.title,
          });

          await AuditLogRepository.logEvent({
            documentId: newDocument.id,
            recipientId: recipient.id,
            action: "INVITE_SENT",
            ipAddress: req.ip || req.socket.remoteAddress || "",
            userAgent: req.headers["user-agent"] || "",
          });
        }
      });

      res.status(200).json({ message: "Document sent for eSign successfully", transactionId });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error sending for eSign");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Get document info for a signer via their secure token.
   */
  static async getDocumentByToken(req: Request, res: Response): Promise<void> {
    try {
      const token = req.params.token as string;
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      
      if (!recipient) {
        res.status(404).json({ error: "Invalid or expired link" });
        return;
      }

      const document = await DocumentRepository.findById(recipient.documentId);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Log action
      await AuditLogRepository.logEvent({
        documentId: document.id,
        recipientId: recipient.id,
        action: "LINK_CLICKED",
        ipAddress: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });

      res.status(200).json({ 
        documentTitle: document.title, 
        transactionId: document.transactionId,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        status: recipient.status,
        requireGps: recipient.requireGps,
        requirePhoto: recipient.requirePhoto
      });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error getting document by token");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Resend the invite email to a specific signer.
   */
  static async remindSigner(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uploaderId = req.userId;
      const { recipientId } = req.body;
      
      if (!uploaderId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      
      const recipient = await DocumentRecipientRepository.findById(recipientId);
      if (!recipient) {
        res.status(404).json({ error: "Recipient not found" });
        return;
      }

      const sender = await UserRepository.findById(uploaderId);
      const senderName = sender ? `${sender.firstName} ${sender.lastName}` : "Ehastakshar User";
      
      const document = await DocumentRepository.findById(recipient.documentId);
      if (!document || document.uploaderId !== uploaderId) {
        res.status(404).json({ error: "Document not found or unauthorized" });
        return;
      }
      
      if (recipient.status === "SIGNED") {
        res.status(400).json({ error: "Recipient has already signed" });
        return;
      }

      const signingLink = `${env.FRONTEND_URL}/sign/${recipient.secureToken}`;
      await AuthService.sendInviteEmail({
        email: recipient.email,
        link: signingLink,
        recipientName: recipient.name,
        senderName,
        documentName: document.title,
      });

      await AuditLogRepository.logEvent({
        documentId: document.id,
        recipientId: recipient.id,
        action: "REMINDER_SENT",
        ipAddress: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });

      res.status(200).json({ message: "Reminder sent successfully" });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error sending reminder");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Stream PDF by secure token for the signer
   */
  static async downloadDocumentByToken(req: Request, res: Response): Promise<void> {
    try {
      const token = req.params.token as string;
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      
      if (!recipient) {
        res.status(404).json({ error: "Invalid or expired token" });
        return;
      }

      const document = await DocumentRepository.findById(recipient.documentId);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const storageProvider = getStorageProvider();
      const fileStream = await storageProvider.download(document.fileUrl);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${document.title}.pdf"`);

      fileStream.pipe(res);
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error downloading document by token");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Send OTP to signer's email for verification.
   */
  static async sendOtp(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.body;
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      if (!recipient) {
        res.status(400).json({ error: "Invalid token" });
        return;
      }

      // Generate OTP and Hash
      const otp = AuthService.generateOtp();
      const otpHash = await AuthService.hashString(otp);
      
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      // Save to OTP repo
      await OtpRepository.upsert({
        email: recipient.email,
        otpHash,
        expiresAt,
      });

      // Send OTP email using Resend
      await AuthService.sendOtpEmail(recipient.email, otp);

      await AuditLogRepository.logEvent({
        documentId: recipient.documentId,
        recipientId: recipient.id,
        action: "OTP_REQUESTED",
        ipAddress: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });

      res.status(200).json({ message: "OTP sent successfully" });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error sending OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Verify the OTP provided by the signer.
   */
  static async verifyOtp(req: Request, res: Response): Promise<void> {
    try {
      const { token, otp } = req.body;
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      
      if (!recipient) {
        res.status(400).json({ error: "Invalid token" });
        return;
      }

      const otpRequest = await OtpRepository.findByEmail(recipient.email);
      if (!otpRequest || otpRequest.expiresAt < new Date()) {
        res.status(400).json({ error: "OTP expired or not requested" });
        return;
      }

      const isValid = await AuthService.verifyHash(otpRequest.otpHash, otp);
      if (!isValid) {
        res.status(400).json({ error: "Invalid OTP" });
        return;
      }

      // Clear the OTP
      await OtpRepository.deleteByEmail(recipient.email);

      await AuditLogRepository.logEvent({
        documentId: recipient.documentId,
        recipientId: recipient.id,
        action: "OTP_VERIFIED",
        ipAddress: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });

      // Generate a temporary JWT token specifically for the signing step to prevent replay attacks
      const ipAddress = (req.ip || req.socket.remoteAddress || "").toString();
      const signToken = AuthService.generateToken(recipient.id, ipAddress);

      res.status(200).json({ message: "OTP verified", signToken });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error verifying OTP");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Apply visual signature to the PDF using pdf-lib.
   */
  static async signDocument(req: Request, res: Response): Promise<void> {
    try {
      const { token, signatureText, signToken, consentGranted, consentTimestamp } = req.body;
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      
      if (consentGranted !== "true") {
        res.status(400).json({ error: "Explicit consent is required to sign the document." });
        return;
      }
      
      if (!recipient || recipient.status === "SIGNED") {
        res.status(400).json({ error: "Invalid token or already signed" });
        return;
      }

      // Verify OTP signToken to prevent bypass
      if (!signToken) {
        res.status(401).json({ error: "Missing signing token. Please verify OTP first." });
        return;
      }
      
      const payload = AuthService.verifyToken(signToken);
      if (!payload || payload.userId !== recipient.id) {
        res.status(401).json({ error: "Invalid or expired signing token" });
        return;
      }
      
      // Verify IP Address binding
      const currentIp = (req.ip || req.socket.remoteAddress || "").toString();
      if (payload.ipAddress && payload.ipAddress !== currentIp) {
        logger.warn({ expectedIp: payload.ipAddress, actualIp: currentIp }, "IP Address mismatch during signing");
        res.status(401).json({ error: "Session hijacked. IP Address changed since OTP verification." });
        return;
      }

      const document = await DocumentRepository.findById(recipient.documentId);
      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // 1. Download current document
      const storageProvider = getStorageProvider();
      const fileStream = await storageProvider.download(document.fileUrl);
      
      const chunks: Buffer[] = [];
      for await (const chunk of fileStream) {
        chunks.push(Buffer.from(chunk));
      }
      const fileBuffer = Buffer.concat(chunks);

      // 2. Manipulate PDF - Cryptographic Sealing
      const ipAddress = (req.ip || req.socket.remoteAddress || "").toString();
      const pdfWithPlaceholder = await DigitalSignatureService.addSignaturePlaceholder(fileBuffer, {
        transactionId: document.transactionId,
        recipientName: recipient.name,
        signatureUrl: req.body.signatureUrl,
        ipAddress: ipAddress
      });

      const signedPdfBuffer = await DigitalSignatureService.sealDocument(pdfWithPlaceholder);

      // 3. Upload signed document back
      // Using a temporary stream to upload the Buffer
      const { Readable } = await import("stream");
      const signedStream = Readable.from(signedPdfBuffer);
      
      // Upload replacing or creating a new version
      const newFileUrl = await storageProvider.upload(`signed_${document.id}.pdf`, "application/pdf", signedStream);

      // 4. Update Database inside a transaction
      await db.transaction(async (tx) => {
        await DocumentRecipientRepository.markAsSigned(recipient.id, signatureText);
        await DocumentRepository.updateFileUrl(document.id, newFileUrl);

        const userAgentStr = req.headers["user-agent"] || "";
        const uap = new UAParser(userAgentStr);
        const browser = uap.getBrowser().name || "Unknown";
        const deviceType = uap.getDevice().type || "Desktop";
        
        let city = undefined, state = undefined, country = undefined;
        if (req.body.latitude && req.body.longitude) {
          try {
            const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${req.body.latitude}&lon=${req.body.longitude}&format=json`, {
              headers: { 'User-Agent': 'EhastaksharApp/1.0' }
            });
            const geoData = await geoRes.json();
            if (geoData && geoData.address) {
              city = geoData.address.city || geoData.address.town || geoData.address.village;
              state = geoData.address.state;
              country = geoData.address.country;
            }
          } catch (e) {
            logger.error({ err: e }, "Geocoding error");
          }
        }

        // Log explicit consent
        await AuditLogRepository.logEvent({
          documentId: document.id,
          recipientId: recipient.id,
          action: "CONSENT_GRANTED",
          ipAddress: req.ip || req.socket.remoteAddress || "",
          userAgent: userAgentStr,
          timestamp: consentTimestamp ? new Date(consentTimestamp) : new Date(),
        });

        await AuditLogRepository.logEvent({
          documentId: document.id,
          recipientId: recipient.id,
          action: "SIGNED",
          ipAddress: req.ip || req.socket.remoteAddress || "",
          userAgent: userAgentStr,
          latitude: req.body.latitude || null,
          longitude: req.body.longitude || null,
          photoUrl: req.body.photoUrl || null,
          city,
          state,
          country,
          browser,
          deviceType
        });

        // Check if all recipients have signed
        const allRecipients = await DocumentRecipientRepository.findByDocumentId(document.id);
        const allSigned = allRecipients.every(r => r.status === "SIGNED");
        
        if (allSigned) {
          await DocumentRepository.updateStatus(document.id, "COMPLETED");
          await AuditLogRepository.logEvent({
            documentId: document.id,
            action: "COMPLETED",
            ipAddress: "System",
            userAgent: "Backend Worker",
          });

          // Send completion email
          const sender = await UserRepository.findById(document.uploaderId);
          if (sender && sender.email) {
            const ccEmails = allRecipients.map(r => r.email).filter(Boolean);
            
            // Fire and forget email notification
            AuthService.sendCompletionEmail({
              toEmail: sender.email,
              ccEmails,
              documentName: document.title,
              downloadLink: document.fileUrl,
            }).catch(err => logger.error({ err }, "Failed to send completion email"));
          }
        }
      });

      res.status(200).json({ message: "Document Signed Successfully", transactionId: document.transactionId });
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error signing document");
      res.status(500).json({ error: "Internal server error" });
    }
  }
  /**
   * Securely proxy the download of the original document.
   */
  static async downloadDocument(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uploaderId = req.userId;
      const documentId = req.params.id as string;

      if (!uploaderId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const document = await DocumentRepository.findById(documentId);
      
      if (!document || document.uploaderId !== uploaderId) {
        res.status(404).json({ error: "Document not found or unauthorized" });
        return;
      }

      const storageProvider = getStorageProvider();
      const fileStream = await storageProvider.download(document.fileUrl);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${document.title}.pdf"`);

      fileStream.pipe(res);
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error downloading document");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Log client events like allowing/denying location, capturing photo, etc.
   */
  static async logClientEvent(req: Request, res: Response): Promise<void> {
    try {
      const token = req.params.token as string;
      const { action } = req.body;
      
      const recipient = await DocumentRecipientRepository.findBySecureToken(token);
      if (!recipient) {
        res.status(404).json({ error: "Invalid token" });
        return;
      }
      
      await AuditLogRepository.logEvent({
        documentId: recipient.documentId,
        recipientId: recipient.id,
        action,
        ipAddress: req.ip || req.socket.remoteAddress || "",
        userAgent: req.headers["user-agent"] || "",
      });

      res.status(200).json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Error logging client event");
      res.status(500).json({ error: "Internal server error" });
    }
  }

  /**
   * Generate and download the Audit Report PDF for a document.
   */
  static async downloadAuditReport(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const uploaderId = req.userId;
      const documentId = req.params.id as string;
      if (!uploaderId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      
      const document = await DocumentRepository.findById(documentId);
      if (!document || document.uploaderId !== uploaderId) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const uploader = await UserRepository.findById(uploaderId);
      const recipients = await DocumentRecipientRepository.findByDocumentId(documentId);
      const events = await AuditLogRepository.getEventsForDocument(documentId);

      // Create a new PDF document using PDFKit
      const doc = new PDFDocumentKit({ margin: 40, size: "A4" });
      
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="AuditReport_${document.transactionId}.pdf"`);
      doc.pipe(res);

      if (document.status === "COMPLETED") {
        // Header Banner
        doc.rect(0, 0, doc.page.width, 100).fill("#e2e4e8");
        doc.fillColor("#6b7280").fontSize(24).font("Helvetica-Bold").text("DOCUMENT AUDIT REPORT", 50, 40);

        // Metadata (below header)
        doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold");
        doc.text(`Order ID: `, 50, 130, { continued: true }).font("Helvetica").text(document.transactionId);
        
        const generatedOn = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        const generatedTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        
        doc.font("Helvetica-Bold").text(`Generated On: `, doc.page.width / 2 - 50, 130, { continued: true }).font("Helvetica").text(generatedOn);
        doc.font("Helvetica-Bold").text(`Time: `, doc.page.width - 150, 130, { continued: true }).font("Helvetica").text(generatedTime);

        // ORDER DETAILS BOX
        doc.moveDown(3);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#9ca3af").text("ORDER DETAILS", 50, doc.y);
        
        const boxY = doc.y + 10;
        const boxWidth = doc.page.width - 100;

        doc.roundedRect(50, boxY, boxWidth, 80, 5).fillAndStroke("#f3f4f6", "#111827");

        doc.fillColor("#111827").fontSize(10);

        // --------------------------------------------------
        // COLUMN POSITIONS
        // --------------------------------------------------
        const leftLabelX = 70;
        const leftValueX = 180;
        const rightLabelX = 335;
        const rightValueX = 415;

        // --------------------------------------------------
        // ROW 1
        // --------------------------------------------------
        // Left
        doc.font("Helvetica").text("Order ID", leftLabelX, boxY + 20);
        doc.font("Helvetica-Bold").text(`: ${document.transactionId}`, leftValueX, boxY + 20);
        // Right
        doc.font("Helvetica").text("Order Status", rightLabelX, boxY + 20);
        doc.font("Helvetica-Bold").text(`: ${document.status}`, rightValueX, boxY + 20);

        // --------------------------------------------------
        // ROW 2
        // --------------------------------------------------
        const uploaderName = uploader ? `${uploader.firstName} ${uploader.lastName}`: "Unknown";

        doc.font("Helvetica").text("Order Placed By", leftLabelX, boxY + 50);
        doc.font("Helvetica-Bold").text(`: ${uploaderName}`, leftValueX, boxY + 50);

        const orderDate = new Date(document.createdAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });

        doc.font("Helvetica").text("Order Date", rightLabelX, boxY + 50);
        doc.font("Helvetica-Bold").text(`: ${orderDate}`, rightValueX, boxY + 50);

        // ESIGNATURE DETAILS
        doc.moveDown(5);
        doc.font("Helvetica-Bold").fontSize(14).fillColor("#9ca3af").text("ESIGNATURE DETAILS", 50, doc.y);
        
        for (const r of recipients) {
          if (r.status !== "SIGNED") continue;
          
          const signEvent = events.find(e => e.recipientId === r.id && e.action === "SIGNED");
          if (!signEvent) continue;

          doc.moveDown(2);
          let currentY = doc.y;

          doc.fillColor("#111827").fontSize(10).font("Helvetica");

          // Row 1
          doc.font("Helvetica").text("Signatory Name", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${r.name}`, leftValueX, currentY);
          doc.font("Helvetica").text("City", rightLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.city || "NA"}`, rightValueX, currentY);

          currentY += 25;
          // Row 2
          doc.font("Helvetica").text("Email", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${r.email}`, leftValueX, currentY);
          doc.font("Helvetica").text("State", rightLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.state || "NA"}`, rightValueX, currentY);

          currentY += 25;
          // Row 3
          doc.font("Helvetica").text("Signature Type", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: DIGITAL`, leftValueX, currentY);
          doc.font("Helvetica").text("Country", rightLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.country || "NA"}`, rightValueX, currentY);

          currentY += 25;
          // Row 4
          doc.font("Helvetica").text("Browser", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.browser || "NA"}`, leftValueX, currentY);
          const dateSigned = new Date(r.signedAt!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          const timeSigned = new Date(r.signedAt!).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          doc.font("Helvetica").text("Date & Time", rightLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${dateSigned} ${timeSigned}`, rightValueX, currentY);

          currentY += 25;
          // Row 5
          doc.font("Helvetica").text("Device Type", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.deviceType || "NA"}`, leftValueX, currentY);
          doc.font("Helvetica").text("Lat Long", rightLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.latitude ? `(${signEvent.latitude},${signEvent.longitude})` : "NA"}`, rightValueX, currentY);

          currentY += 25;
          // Row 6
          doc.font("Helvetica").text("IP Address", leftLabelX, currentY);
          doc.font("Helvetica-Bold").text(`: ${signEvent.ipAddress || "NA"}`, leftValueX, currentY);
          
          doc.y = currentY + 30;

          if (signEvent.photoUrl) {
            doc.font("Helvetica").text("Image", leftLabelX, doc.y);
            doc.font("Helvetica-Bold").text(":", leftValueX - 5, doc.y);
            try {
              const photoRes = await fetch(signEvent.photoUrl);
              const arrayBuffer = await photoRes.arrayBuffer();
              const photoBuffer = Buffer.from(arrayBuffer);
              doc.image(photoBuffer, leftValueX + 5, doc.y, { fit: [100, 100] });
              doc.y += 115;
            } catch (e) {
              logger.error({ err: e }, "Failed to fetch and embed photo into PDF");
              doc.y += 20;
            }
          }
          
          doc.moveDown(1);
          doc.lineWidth(1);
          doc.dash(5, { space: 5 });
          doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
          doc.undash();
          doc.moveDown(2);
        }

        const oldBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const stripHeight = 35;
        const stripY = doc.page.height - stripHeight;
        doc.rect(0, stripY, doc.page.width, stripHeight).fill("#002045");
        doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold").text("Signed Securely with Ehastakshar", 0, stripY + 11, { width: doc.page.width, align: "center", lineBreak: false });
        doc.page.margins.bottom = oldBottom;

      } else {
        // --------------------------------------------------
        // PENDING STATE DESIGN
        // --------------------------------------------------
        
        // Title
        doc.fillColor("#111827").fontSize(14).font("Helvetica").text(`Audit Trail for `, 50, 50, { continued: true }).font("Helvetica-Bold").text(document.title);
        doc.moveDown(1);
        doc.lineWidth(1).strokeColor("#e2e8f0").moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke();
        doc.moveDown(2);

        // RECIPIENTS SECTION
        doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text("RECIPIENTS", 50, doc.y);
        doc.moveDown(1);
        
        let currentRY = doc.y;
        for (const r of recipients) {
          doc.roundedRect(50, currentRY, 250, 75, 5).lineWidth(1).strokeColor("#d97706").stroke();
          doc.fillColor("#fef3c7").fillOpacity(0.3).roundedRect(51, currentRY + 1, 248, 73, 5).fill().fillOpacity(1);

          doc.fillColor("#94a3b8").fontSize(8).font("Helvetica-Bold").text("SIGNER", 60, currentRY + 10);
          doc.fillColor("#111827").fontSize(10).font("Helvetica-Bold").text(r.name, 60, currentRY + 22);
          doc.fillColor("#64748b").fontSize(9).font("Helvetica").text(r.email, 60, currentRY + 36);

          // Divider inside recipient box
          doc.lineWidth(0.5).strokeColor("#e2e8f0").moveTo(60, currentRY + 52).lineTo(290, currentRY + 52).stroke();

          // Badges
          // Pending Badge
          doc.circle(65, currentRY + 63, 5).fill("#d97706");
          doc.fillColor("#ffffff").fontSize(8).font("Helvetica-Bold").text("!", 63.5, currentRY + 60);
          doc.fillColor("#d97706").fontSize(8).font("Helvetica-Bold").text(r.status, 74, currentRY + 60);

          // Digital Badge
          const statusWidth = doc.widthOfString(r.status);
          const badgeX = 74 + statusWidth + 10;
          
          doc.fontSize(7).font("Helvetica");
          const badgeText = "Digital";
          const badgeTextWidth = doc.widthOfString(badgeText);
          const badgeWidth = badgeTextWidth + 12; // 6px padding on each side
          
          doc.roundedRect(badgeX, currentRY + 58, badgeWidth, 12, 2).fill("#1e3a8a");
          doc.fillColor("#ffffff").text(badgeText, badgeX + 6, currentRY + 61.5);

          currentRY += 85;
        }

        doc.y = currentRY + 10;

        // AUDIT TRAIL LIST SECTION
        doc.fillColor("#94a3b8").fontSize(10).font("Helvetica").text("AUDIT TRAIL LIST", 50, doc.y);
        doc.moveDown(1);
        
        // Draw big grey background for events
        const bgStartY = doc.y;
        doc.rect(40, bgStartY, doc.page.width - 80, doc.page.height - bgStartY - 40).fill("#f8f9fa");

        doc.fillColor("#111827").fontSize(11).font("Helvetica").text("", 90, doc.y + 15); // removed 'older' text
        
        let currentEY = doc.y + 15;
        
        for (let i = 0; i < events.length; i++) {
          const event = events[i];
          if (!event) continue;
          
          if (currentEY > doc.page.height - 100) {
            doc.addPage();
            doc.rect(40, 40, doc.page.width - 80, doc.page.height - 80).fill("#f8f9fa");
            currentEY = 60;
          }

          const boxY = currentEY + 20;
          const boxHeight = 45;
          const iconX = 90;
          const iconY = boxY + 22.5;

          if (i > 0) {
            doc.lineWidth(1.5).strokeColor("#cbd5e1").moveTo(iconX, currentEY).lineTo(iconX, boxY + 5).stroke();
          }

          // White box
          doc.roundedRect(70, boxY, doc.page.width - 140, boxHeight, 5).fill("#ffffff");

          // Determine colors based on frontend getActionDetails
          let circleColor = "#94a3b8"; // bg-slate-400
          if (event.action === 'UPLOADED') circleColor = "#64748b"; // bg-slate-500
          else if (event.action === 'INVITE_SENT' || event.action === 'REMINDER_SENT') circleColor = "#3b82f6"; // bg-blue-500
          else if (event.action === 'LINK_CLICKED') circleColor = "#a855f7"; // bg-purple-500
          else if (event.action === 'OTP_REQUESTED') circleColor = "#f59e0b"; // bg-amber-500
          else if (event.action === 'OTP_VERIFIED') circleColor = "#22c55e"; // bg-green-500
          else if (event.action === 'SIGNED') circleColor = "#14b8a6"; // bg-teal-500
          else if (event.action === 'COMPLETED') circleColor = "#0d9488"; // bg-teal-600
          
          doc.circle(iconX, iconY, 12).fill(circleColor);

          // Render exact Lucide SVG paths perfectly centered
          const SVG_PATHS: Record<string, string> = {
            'UPLOADED': "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z M14 2v4a2 2 0 0 0 2 2h4 M10 9H8 M16 13H8 M16 17H8",
            'INVITE_SENT': "M4 4 h16 a2 2 0 0 1 2 2 v12 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 v-12 a2 2 0 0 1 2 -2 z M22 7 l-8.97 5.7 a1.94 1.94 0 0 1 -2.06 0 L2 7",
            'REMINDER_SENT': "M4 4 h16 a2 2 0 0 1 2 2 v12 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 v-12 a2 2 0 0 1 2 -2 z M22 7 l-8.97 5.7 a1.94 1.94 0 0 1 -2.06 0 L2 7",
            'LINK_CLICKED': "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z M12 9a3 3 0 1 1 0 6 3 3 0 1 1 0-6",
            'OTP_REQUESTED': "m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4 m21 2-9.6 9.6 M7.5 10a5.5 5.5 0 1 1 0 11 5.5 5.5 0 1 1 0-11",
            'OTP_VERIFIED': "M20 6 9 17l-5-5",
            'SIGNED': "m12 19 7-7 3 3-7 7-3-3z m18 13-1.5-7.5L2 2l3.5 14.5L13 18l5-5z m2 2 7.586 7.586 M11 9a2 2 0 1 1 0 4 2 2 0 1 1 0-4",
            'COMPLETED': "M22 11.08V12a10 10 0 1 1-5.93-9.14 M9 11l3 3L22 4"
          };
          
          let svgPath = SVG_PATHS[event.action];
          if (!svgPath) {
            // Default Activity icon if action doesn't match
            svgPath = "M22 12h-4l-3 9L9 3l-3 9H2";
          }
          
          doc.save();
          // Scale down the 24x24 SVG to 13x13 and translate to center
          doc.translate(iconX - 6.5, iconY - 6.5).scale(13 / 24);
          doc.path(svgPath).lineWidth(2.5).strokeColor("#ffffff").lineCap('round').lineJoin('round').stroke();
          doc.restore();

          // Lookup real recipient details from the recipients array since AuditLogRepository doesn't join it
          let actualName = "System";
          let actualEmail = null;
          if (event.recipientId) {
            const matchedR = recipients.find(r => r.id === event.recipientId);
            if (matchedR) {
              actualName = matchedR.name;
              actualEmail = matchedR.email;
            }
          } else if ((event as any).recipientName) {
            actualName = (event as any).recipientName;
          }

          // Event text interpretation mapping exactly to frontend getActionDetails
          let eventText = event.action;
          let subtitle = actualName;

          if (event.action === 'UPLOADED') {
            eventText = "Document uploaded and initialized";
            subtitle = actualName;
          } else if (event.action === 'INVITE_SENT' || event.action === 'REMINDER_SENT') {
            eventText = "Invitation sent for signing";
            subtitle = actualEmail ? `${actualName} (${actualEmail})` : actualName;
          } else if (event.action === 'LINK_CLICKED') {
            eventText = `${actualName} has opened the document link`;
            subtitle = actualEmail ? `${actualName} (${actualEmail})` : actualName;
          } else if (event.action === 'OTP_REQUESTED') {
            eventText = `OTP requested by ${actualName} for verification`;
            subtitle = actualEmail ? `${actualName} (${actualEmail})` : actualName;
          } else if (event.action === 'OTP_VERIFIED') {
            eventText = `${actualName} identity verified successfully via OTP`;
            subtitle = actualEmail ? `${actualName} (${actualEmail})` : actualName;
          } else if (event.action === 'SIGNED') {
            eventText = `${actualName} has successfully signed the document`;
            subtitle = actualEmail ? `${actualName} (${actualEmail})` : actualName;
          } else if (event.action === 'COMPLETED') {
            eventText = "All parties have signed the document";
            subtitle = "System";
          }

          if (event.ipAddress && event.ipAddress !== "System" && subtitle !== "System") {
            subtitle += ` | IP: ${event.ipAddress}`;
          }

          doc.fillColor("#111827").fontSize(9).font("Helvetica-Bold").text(eventText, iconX + 25, boxY + 12);
          doc.fillColor("#64748b").fontSize(8).font("Helvetica").text(subtitle, iconX + 25, boxY + 26);

          // Timestamp format DD-MM-YYYY | hh:mm A
          const dateObj = new Date(event.timestamp);
          const dd = String(dateObj.getDate()).padStart(2, '0');
          const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
          const yyyy = dateObj.getFullYear();
          let hours = dateObj.getHours();
          const minutes = String(dateObj.getMinutes()).padStart(2, '0');
          const ampm = hours >= 12 ? 'PM' : 'AM';
          hours = hours % 12;
          hours = hours ? hours : 12;
          const strTime = `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
          const formattedDateTime = `${dd}-${mm}-${yyyy} | ${strTime}`;

          doc.fillColor("#94a3b8").fontSize(8).font("Helvetica").text(formattedDateTime, doc.page.width - 180, boxY + 18, { width: 100, align: 'right' });

          currentEY = boxY + boxHeight;
          
          if (i !== events.length - 1) {
            doc.lineWidth(1.5).strokeColor("#cbd5e1").moveTo(iconX, currentEY).lineTo(iconX, currentEY + 20).stroke();
          }
        }
      }
      doc.end();
    } catch (error) {
      logger.error({ err: error, path: req.originalUrl }, "Error downloading audit report");
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
}
