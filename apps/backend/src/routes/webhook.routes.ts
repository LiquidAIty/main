import { Router } from 'express';
import { WebhookController } from '../controllers/webhook.controller';

export const webhookRouter = Router();

webhookRouter.post('/execute', WebhookController.execute);
