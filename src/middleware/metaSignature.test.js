import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { verifyMetaSignature } from './metaSignature.js';

const SECRET = 'test-app-secret';

function sign(rawBody, secret = SECRET) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('verifyMetaSignature', () => {
  const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));

  it('accepts a valid signature and calls next()', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = { headers: { 'x-hub-signature-256': sign(rawBody) }, rawBody, path: '/whatsapp' };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a tampered body', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = {
      headers: { 'x-hub-signature-256': sign(rawBody) },
      rawBody: Buffer.from(JSON.stringify({ hello: 'tampered' })),
      path: '/whatsapp',
    };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a missing signature header', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = { headers: {}, rawBody, path: '/whatsapp' };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a malformed header with no sha256= prefix', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = { headers: { 'x-hub-signature-256': 'not-a-valid-format' }, rawBody, path: '/whatsapp' };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a wrong-length signature without throwing', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = { headers: { 'x-hub-signature-256': 'sha256=abcd' }, rawBody, path: '/whatsapp' };
    const res = mockRes();
    const next = vi.fn();

    expect(() => middleware(req, res, next)).not.toThrow();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a signature computed with the wrong app secret', () => {
    const middleware = verifyMetaSignature(() => SECRET);
    const req = {
      headers: { 'x-hub-signature-256': sign(rawBody, 'a-different-secret') },
      rawBody,
      path: '/whatsapp',
    };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('fails closed when no app secret is configured', () => {
    const middleware = verifyMetaSignature(() => undefined);
    const req = { headers: { 'x-hub-signature-256': sign(rawBody) }, rawBody, path: '/whatsapp' };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
