import { Router } from 'express';
import { AlertController } from '../controllers/AlertController.js';

const router = Router();

// Endpoint for frontend to send error logs
router.post('/client', AlertController.handleClientAlert);

// Endpoint to simulate a crash (for testing only)
router.get('/test-crash', AlertController.triggerBackendCrash);

export default router;
