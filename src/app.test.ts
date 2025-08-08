import request from 'supertest';
import app from './app';

describe('API Endpoints', () => {
  test('/db-health returns 200', async () => {
    const res = await request(app).get('/db-health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'connect OK');
  });

  test('/cache-ping returns PONG', async () => {
    const res = await request(app).get('/cache-ping');
    expect(res.statusCode).toBe(200);
    expect(res.text).toBe('PONG');
  });
});
