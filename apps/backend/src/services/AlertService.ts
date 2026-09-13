import { sendEmail } from "./EmailService.js";
import { logger } from "../utils/logger.js";

const ALERT_EMAIL = "ajaynegi3345@gmail.com";

export interface BackendAlertPayload {
  error: Error;
  method: string;
  url: string;
  ip: string;
  userAgent: string;
  body: string;
}

export interface FrontendAlertPayload {
  message: string;
  stack: string;
  url: string;
  userAgent: string;
  device: string;
  browser: string;
  os: string;
}

export class AlertService {
  /**
   * Parses an Error stack trace to extract the exact file and line number.
   */
  private static parseStackTrace(stack?: string): string {
    if (!stack) return "No stack trace available";
    
    // Look for the first line that contains '/src/' or '/apps/' to pinpoint the user code crash, ignoring node_modules if possible
    const lines = stack.split('\n');
    let culpritLine = lines.find(line => line.includes('/src/') && !line.includes('node_modules'));
    
    if (!culpritLine) {
      culpritLine = lines[1] || "Unknown location";
    }

    return culpritLine.trim();
  }

  /**
   * Generates a styled HTML email template for backend alerts.
   */
  private static generateBackendHtml(payload: BackendAlertPayload, culpritInfo: string): string {
    const timestamp = new Date().toISOString();
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #ef4444; color: white; padding: 16px;">
          <h2 style="margin: 0;">🚨 Critical Backend Crash</h2>
        </div>
        <div style="padding: 24px;">
          <p><strong>Time (UTC):</strong> ${timestamp}</p>
          <p><strong>Error Message:</strong> <span style="color: #ef4444; font-weight: bold;">${payload.error.message}</span></p>
          <p><strong>Crash Location:</strong> <code style="background: #f1f5f9; padding: 4px; border-radius: 4px; color: #b91c1c;">${culpritInfo}</code></p>
          
          <hr style="border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          
          <h3>Request Context</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Method:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.method}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Endpoint:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.url}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>IP Address:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.ip}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>User Agent:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.userAgent}</td></tr>
          </table>

          <div style="margin-top: 16px;">
            <strong>Sanitized Body:</strong>
            <pre style="background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto;">${payload.body}</pre>
          </div>

          <div style="margin-top: 16px;">
            <strong>Full Stack Trace:</strong>
            <pre style="background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; font-size: 12px;">${payload.error.stack}</pre>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Generates a styled HTML email template for frontend alerts.
   */
  private static generateFrontendHtml(payload: FrontendAlertPayload): string {
    const timestamp = new Date().toISOString();
    return `
      <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">
        <div style="background-color: #f59e0b; color: white; padding: 16px;">
          <h2 style="margin: 0;">⚠️ Frontend Client Crash</h2>
        </div>
        <div style="padding: 24px;">
          <p><strong>Time (UTC):</strong> ${timestamp}</p>
          <p><strong>Error Message:</strong> <span style="color: #b45309; font-weight: bold;">${payload.message}</span></p>
          <p><strong>Frontend URL:</strong> <a href="${payload.url}">${payload.url}</a></p>
          
          <hr style="border-top: 1px solid #e2e8f0; margin: 24px 0;" />
          
          <h3>Client Context</h3>
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>OS:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.os}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Browser:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.browser}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Device:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.device}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #e2e8f0;"><strong>Raw User Agent:</strong></td><td style="padding: 8px; border: 1px solid #e2e8f0;">${payload.userAgent}</td></tr>
          </table>

          <div style="margin-top: 16px;">
            <strong>Stack Trace:</strong>
            <pre style="background: #1e293b; color: #f8fafc; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; font-size: 12px;">${payload.stack}</pre>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Dispatches a backend error alert.
   */
  static async sendBackendAlert(payload: BackendAlertPayload): Promise<void> {
    try {
      const culpritInfo = this.parseStackTrace(payload.error.stack);
      const htmlContent = this.generateBackendHtml(payload, culpritInfo);
      
      const subject = `[🚨 PROD Backend Crash] ${payload.error.name}: ${payload.error.message.substring(0, 50)}...`;

      await sendEmail({
        toEmail: ALERT_EMAIL,
        subject,
        htmlContent
      });
      logger.info(`Backend alert dispatched to ${ALERT_EMAIL} for error: ${payload.error.message}`);
    } catch (err) {
      logger.error({ err }, "Failed to send Backend Alert Email");
    }
  }

  /**
   * Dispatches a frontend client error alert.
   */
  static async sendFrontendAlert(payload: FrontendAlertPayload): Promise<void> {
    try {
      const htmlContent = this.generateFrontendHtml(payload);
      const subject = `[⚠️ PROD Frontend Crash] ${payload.message.substring(0, 50)}...`;

      await sendEmail({
        toEmail: ALERT_EMAIL,
        subject,
        htmlContent
      });
      logger.info(`Frontend alert dispatched to ${ALERT_EMAIL} for error: ${payload.message}`);
    } catch (err) {
      logger.error({ err }, "Failed to send Frontend Alert Email");
    }
  }
}
