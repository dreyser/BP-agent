import crypto from 'crypto';

// Verifies Meta's X-Hub-Signature-256 header against the exact raw request
// bytes (req.rawBody, populated by the express.json({ verify }) config in
// index.js) using HMAC-SHA256 with FACEBOOK_APP_SECRET. Must run before any
// downstream side effect this relay triggers (marking messages read,
// forwarding to the main app).
//
// getSecret is a function (not a plain string) so the secret is read at
// request time, keeping "no secret configured" independently testable.
export function verifyMetaSignature(getSecret) {
  return function metaSignatureMiddleware(req, res, next) {
    const secret = getSecret();
    if (!secret) {
      console.warn('[MetaSignature] Rejected: app secret not configured', { path: req.path });
      return res.status(503).json({ error: 'Webhook verification not configured' });
    }

    const header = req.headers['x-hub-signature-256'];
    if (typeof header !== 'string' || !header.startsWith('sha256=')) {
      console.warn('[MetaSignature] Rejected: missing or malformed signature header', { path: req.path });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const rawBody = req.rawBody;
    if (!rawBody) {
      console.warn('[MetaSignature] Rejected: raw body unavailable', { path: req.path });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const receivedHex = header.slice('sha256='.length);
    const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

    // Buffer.from(str, 'hex') never throws on invalid/short hex — it just
    // stops parsing early, which naturally yields a length mismatch below,
    // so this is the only guard needed against timingSafeEqual's
    // length-mismatch throw.
    const received = Buffer.from(receivedHex, 'hex');
    const expected = Buffer.from(expectedHex, 'hex');
    const valid = received.length === expected.length && crypto.timingSafeEqual(received, expected);

    if (!valid) {
      console.warn('[MetaSignature] Rejected: signature mismatch', { path: req.path });
      return res.status(401).json({ error: 'Invalid signature' });
    }

    next();
  };
}
