import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import webhookRouter from './webhook.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', webhookRouter);
  return app;
}

describe('GET /webhook/whatsapp (Meta verification challenge)', () => {
  beforeEach(() => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
  });

  it('echoes the challenge when mode and token match', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'abc123' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  it('rejects when the verify token does not match', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'abc123' });

    expect(res.status).toBe(403);
  });

  it('rejects when mode is not "subscribe"', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/webhook/whatsapp')
      .query({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'abc123' });

    expect(res.status).toBe(403);
  });
});
