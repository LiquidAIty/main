import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { TaskEnvelope } from '../types/agent';

export const solController = {
  async execute(req: ExpressRequest, res: ExpressResponse) {
    try {
      const task = req.body as TaskEnvelope;
      res.status(202).json({ status: 'started', message: `On it—starting ${task.task}.` });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Internal server error' });
    }
  }
};
