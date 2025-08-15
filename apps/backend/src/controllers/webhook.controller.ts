import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

export const WebhookController = {
  execute(req: ExpressRequest, res: ExpressResponse) {
    try {
      const payload = req.body;
      res.status(200).json({
        status: 'received',
        message: 'Webhook processed (stub implementation)',
        payload
      });
    } catch (error: any) {
      res.status(500).json({ 
        error: error?.message || 'Webhook processing failed' 
      });
    }
  }
};
