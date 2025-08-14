import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import type { StreamEvent } from '../types/agent';

const activeConnections = new Map<string, ExpressResponse>();

export const StreamService = {
  attach(userId: string, req: ExpressRequest, res: ExpressResponse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.write('\n');
    
    activeConnections.set(userId, res);
    
    req.on('close', () => {
      activeConnections.delete(userId);
    });
  },
  
  sendEvent(userId: string, event: StreamEvent) {
    const res = activeConnections.get(userId);
    if (res) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }
};
