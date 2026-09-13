import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { AlertService } from '../services/AlertService.js';

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error({ 
    err,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  }, 'Unhandled Exception Caught by Middleware');

  // We only want to fire alerts for 500-level crashes, not standard 4xx validations or client errors
  if (statusCode >= 500) {
    // Sanitize body (e.g. remove passwords, tokens)
    const sanitizedBody = { ...req.body };
    if (sanitizedBody.password) sanitizedBody.password = '[REDACTED]';
    if (sanitizedBody.token) sanitizedBody.token = '[REDACTED]';

    AlertService.sendBackendAlert({
      error: err,
      method: req.method,
      url: req.originalUrl,
      ip: (req.ip || req.socket.remoteAddress || '').toString(),
      userAgent: req.headers['user-agent'] || 'Unknown',
      body: JSON.stringify(sanitizedBody, null, 2)
    });
  }

  res.status(statusCode).json({
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};
