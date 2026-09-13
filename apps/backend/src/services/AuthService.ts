import * as argon2 from "argon2";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { generateInviteEmailHtml, generateCompletionEmailHtml } from "../utils/emailTemplates.js";

import { sendEmail } from "./EmailService.js";
// JWT Expiration for short-lived access
const JWT_EXPIRES_IN = "15m";

export class AuthService {
  /**
   * Hashes a password or OTP using Argon2.
   */
  static async hashString(plaintext: string): Promise<string> {
    return await argon2.hash(plaintext);
  }

  /**
   * Verifies an Argon2 hash against a plaintext string.
   */
  static async verifyHash(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch (err) {
      return false;
    }
  }

  /**
   * Generates a 6-character OTP.
   * Uses uppercase letters and numbers, explicitly excluding confusing characters:
   * 'I', '1', 'L', 'O', '0'.
   */
  static generateOtp(): string {
    const charset = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let otp = "";
    // crypto.randomBytes is secure against predictability
    const randomBytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) {
      const byte = randomBytes[i];
      if (byte === undefined) {
        throw new Error("Failed to generate OTP");
      }
      otp += charset.charAt(byte % charset.length);
    }
    return otp;
  }

  /**
   * Generates a JWT token for the user, bound to an IP address.
   */
  static generateToken(userId: string, ipAddress?: string): string {
    const secret = env.JWT_SECRET;
    return jwt.sign({ userId, ipAddress }, secret, { expiresIn: JWT_EXPIRES_IN });
  }

  /**
   * Verifies a JWT token and returns the payload.
   */
  static verifyToken(token: string): any {
    try {
      const secret = env.JWT_SECRET;
      return jwt.verify(token, secret);
    } catch (err) {
      return null;
    }
  }

  /**
   * Sends the OTP via Resend.
   */
  static async sendOtpEmail(email: string, otp: string): Promise<void> {
    const html = `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #0D9488;">Verify your email</h2>
        <p>Your verification code is:</p>
        <h1 style="letter-spacing: 4px; font-size: 32px; color: #111;">${otp}</h1>
        <p>This code expires in 10 minutes.</p>
      </div>
    `;
    await sendEmail({ toEmail: email, subject: "Your Ehastakshar Verification Code", htmlContent: html });
  }

  /**
   * Sends the document signing invite via Resend.
   */
  static async sendInviteEmail({
    email,
    link,
    recipientName,
    senderName,
    documentName,
  }: {
    email: string;
    link: string;
    recipientName: string;
    senderName: string;
    documentName: string;
  }): Promise<void> {
    const html = generateInviteEmailHtml({ recipientName, senderName, documentName, link });
    await sendEmail({ toEmail: email, subject: "Action Required: Sign Document", htmlContent: html });
  }

  /**
   * Sends the document completion notification via Resend.
   */
  static async sendCompletionEmail({
    toEmail,
    ccEmails,
    documentName,
    downloadLink,
  }: {
    toEmail: string;
    ccEmails: string[];
    documentName: string;
    downloadLink: string;
  }): Promise<void> {
    const html = generateCompletionEmailHtml({ documentName, link: downloadLink });
    await sendEmail({ toEmail, ccEmail: ccEmails, subject: "Document Completely Signed", htmlContent: html });
  }
}
