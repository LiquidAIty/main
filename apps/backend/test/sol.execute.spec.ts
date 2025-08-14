import request from 'supertest';
import { app } from '../../src/app';
import { TaskEnvelope } from '../../src/types/agent';

describe('POST /agents/sol/execute', () => {
  it('should return immediate acknowledgment', async () => {
    const task: TaskEnvelope = {
      task: 'mark_chart',
      userId: 'test-user',
      input: { symbol: 'AAPL', overlay: 'EMA(20,50)' }
    };
    
    const response = await request(app)
      .post('/agents/sol/execute')
      .send(task);
      
    expect(response.status).toBe(202);
    expect(response.body.status).toBe('started');
  });

  it('should handle invalid requests', async () => {
    const response = await request(app)
      .post('/agents/sol/execute')
      .send({ invalid: 'request' });
      
    expect(response.status).toBe(400);
  });
});
