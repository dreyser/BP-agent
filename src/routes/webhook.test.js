import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import express from 'express';
import request from 'supertest';
import webhookRouter from './webhook.js';

const TEST_SECRET = 'test-fb-app-secret';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function buildApp() {
  const app = express();
  // Matches index.js's real body-parser config: rawBody is what
  // verifyMetaSignature checks the signature against, and what the relay
  // forwards downstream.
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use('/webhook', webhookRouter);
  return app;
}

function sign(rawBody, secret = TEST_SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// Sends a raw JSON string body with a controllable signature header —
// keeping the caller in charge of the exact string lets tests prove the
// relay forwards those exact bytes, not a re-serialization of them.
function postRaw(app, raw, { secret = TEST_SECRET, headerOverride } = {}) {
  const req = request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json');
  if (headerOverride !== undefined) {
    if (headerOverride !== null) req.set('x-hub-signature-256', headerOverride);
  } else {
    req.set('x-hub-signature-256', sign(raw, secret));
  }
  return req.send(raw);
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

describe('POST /webhook/whatsapp — signature verification + relay', () => {
  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = TEST_SECRET;
    process.env.WEBAPP_URL = 'https://test-webapp.example';
    // Ensure the mark-as-read branch is skipped so the only fetch call this
    // handler makes is the relay forward — keeps assertions unambiguous.
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });

  it('rejects a missing signature: zero downstream requests', async () => {
    const app = buildApp();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await postRaw(app, JSON.stringify({ entry: [] }), { headerOverride: null });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects an invalid signature: zero downstream requests', async () => {
    const app = buildApp();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await postRaw(app, JSON.stringify({ entry: [] }), { secret: 'wrong-secret' });

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('rejects a tampered body (signature computed over different bytes): zero downstream requests', async () => {
    const app = buildApp();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const originalRaw = JSON.stringify({ entry: [{ id: 'original' }] });
    const tamperedRaw = JSON.stringify({ entry: [{ id: 'tampered' }] });

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sign(originalRaw))
      .send(tamperedRaw);

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('accepts a validly-signed payload: exactly one downstream request, byte-identical body, preserved signature, correct content-type', async () => {
    const app = buildApp();
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const raw = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: 'wamid.1' }] } }] }] });
    const sig = sign(raw);

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(raw);

    expect(res.status).toBe(200);
    await wait(30); // let the fire-and-forget relay fetch() settle

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test-webapp.example/webhook/whatsapp');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
    expect(options.headers['x-hub-signature-256']).toBe(sig);
    expect(Buffer.isBuffer(options.body)).toBe(true);
    expect(options.body.toString()).toBe(raw);

    vi.unstubAllGlobals();
  });
});

// Regression guard: fails if the relay is ever changed back to forwarding
// JSON.stringify(req.body) instead of req.rawBody. The payload below uses
// deliberately irregular whitespace that JSON.parse/JSON.stringify would
// normalize away, so any re-serialization produces different bytes than
// what was actually signed and sent.
describe('POST /webhook/whatsapp — byte-identity regression', () => {
  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = TEST_SECRET;
    process.env.WEBAPP_URL = 'https://test-webapp.example';
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_ACCESS_TOKEN;
  });

  it('forwards the exact original bytes, not a reserialization of the parsed body', async () => {
    const app = buildApp();
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const raw = '{  "entry":  [ { "id" : "irregular-whitespace-test",   "changes":[{"value":{"messages":[{"id":"wamid.byte-test"}]}}] } ]  }';
    const sig = sign(raw);

    // Sanity check that this test would actually catch a regression —
    // if a naive reserialization produced identical bytes, the byte
    // comparison below would pass vacuously regardless of which body the
    // handler actually forwarded.
    const reserialized = JSON.stringify(JSON.parse(raw));
    expect(reserialized).not.toBe(raw);

    const res = await request(app)
      .post('/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', sig)
      .send(raw);

    expect(res.status).toBe(200);
    await wait(30);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0];
    expect(Buffer.compare(options.body, Buffer.from(raw))).toBe(0);
    expect(options.headers['x-hub-signature-256']).toBe(sig);

    vi.unstubAllGlobals();
  });
});
