import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export const sendEmail = async ({ toEmail, ccEmail, subject, htmlContent }: { toEmail: string; ccEmail?: string[]; subject: string; htmlContent: string; }): Promise<boolean> => {
  const apiKey = env.EMAIL_SERVICE_API_KEY;
  const domain = env.EMAIL_SERVICE_DOMAIN;

  try {
    logger.info(`[EMAIL-SERVICE] Attempting to send email to: ${toEmail}`);
    const response = await fetch(domain, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        to: toEmail,
        ...(ccEmail && ccEmail.length > 0 && { cc: ccEmail }),
        subject,
        html: htmlContent,
        fromName: "Ehastakshar"
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Email Service Error: ${response.status} - ${errorText}`);
    }

    logger.info(`[EMAIL-SERVICE] Email sent successfully to ${toEmail}`);
    return true;
  } catch (error: any) {
    logger.error({ err: error, toEmail }, '[EMAIL-SERVICE] Failed to send email');
    throw new Error(error.message);
  }
};
