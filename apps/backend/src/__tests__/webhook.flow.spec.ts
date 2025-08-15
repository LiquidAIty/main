import request from 'supertest';
import { app } from '../../main';
import { AgentOrchestrator } from '@agents-core/orchestrator';

describe('Webhook Flow Integration', () => {
  it('should process webhook request and return success', async () => {
    const testPayload = { foo: 'bar' };
    const mockResponse = { success: true, echo: testPayload };
    
    jest.spyOn(AgentOrchestrator, 'processRequest')
      .mockImplementation(async () => mockResponse);

    const response = await request(app)
      .post('/webhooks/execute')
      .send(testPayload)
      .expect(200);

    expect(response.body).toEqual(mockResponse);
    expect(AgentOrchestrator.processRequest).toHaveBeenCalledWith(testPayload);
  });

  it('should return 400 for empty request body', async () => {
    await request(app)
      .post('/webhooks/execute')
      .send({})
      .expect(400);
  });
});
