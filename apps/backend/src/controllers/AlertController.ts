import type { Request, Response } from 'express';
import { AlertService } from '../services/AlertService.js';

export class AlertController {
  /**
   * Endpoint for the frontend to submit unhandled exceptions.
   */
  static async handleClientAlert(req: Request, res: Response): Promise<void> {
    try {
      const { message, stack, url, userAgent, device, browser, os } = req.body;
      
      if (!message || !stack) {
        res.status(400).json({ error: "Missing required crash data" });
        return;
      }

      await AlertService.sendFrontendAlert({
        message,
        stack,
        url,
        userAgent,
        device,
        browser,
        os
      });

      res.status(200).json({ success: true, message: "Alert received" });
    } catch (error) {
      // Don't crash the server if the alert fails, just log it.
      console.error("Failed to process client alert:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }

  /**
   * Dummy endpoint to artificially trigger a backend crash for testing.
   */
  static triggerBackendCrash(req: Request, res: Response): void {
    // This will throw a synchronous error that the globalErrorHandler should catch
    throw new Error("This is a simulated backend crash to test the Alert System!");
  }
}
