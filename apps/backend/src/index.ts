import express, { type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import authRoutes from "./routes/auth.routes.js";
import esignRoutes from "./routes/esign.routes.js";
import alertRoutes from "./routes/alert.routes.js";
import { verifyToken } from "./middlewares/auth.middleware.js";
import { globalErrorHandler } from "./middlewares/error.middleware.js";
import { otpLimiter } from "./middlewares/rateLimiter.middleware.js";
import pinoHttp from "pino-http";
import { logger } from "./utils/logger.js";
import { env } from "./config/env.js";

const app = express();

// Global Middlewares
app.use(helmet());
app.use(cors({
  origin: env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Global Request Logger
// @ts-expect-error - Type definition mismatch for pino-http in ESM
app.use(pinoHttp({ logger }));

// Authentication Routes
app.use("/api/auth", authRoutes);

// Apply rate limiter specifically to eSign OTP sending and verification
app.use("/api/esign/otp", otpLimiter);

// eSign Routes
app.use("/api/esign", esignRoutes);

// Protected Dummy Route
app.get("/api/user/me", verifyToken, (req: Request, res: Response) => {
  res.json({ message: "You have accessed a protected route!", userId: (req as any).userId });
});

// Health Check Route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    status: 'success',
    message: 'Backend server is running.',
    timestamp: new Date().toISOString()
  });
});

// Alert Routes (Must be registered before the global error handler)
app.use("/api/alerts", alertRoutes);

// Global Error Handler (Must be the last middleware)
app.use(globalErrorHandler);

const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
});
