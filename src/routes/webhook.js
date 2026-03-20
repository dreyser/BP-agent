import { Router } from 'express';
import { WhatsAppService } from '../services/whatsapp.js';

const router = Router();

// ─── GET /webhook/whatsapp — Meta webhook verification ────────────────────────

router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || '';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  console.error('❌ WhatsApp webhook verification failed — token mismatch');
  res.sendStatus(403);
});

// ─── POST /webhook/whatsapp — Receive from Meta, relay to web app ─────────────
//
// BP-Agent is a thin relay. All AI reasoning and workflow execution happens
// in the web app. This handler:
//   1. Acknowledges Meta immediately (required within 20s)
//   2. Marks incoming messages as "read" (good UX)
//   3. Forwards the raw webhook payload to the web app

router.post('/whatsapp', async (req, res) => {
  // Acknowledge immediately — Meta requires 200 within 20 seconds
  res.sendStatus(200);

  console.log(`[${new Date().toISOString()}] 📨 WhatsApp webhook received — relaying to web app`);

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  const webappUrl = process.env.WEBAPP_URL || '';

  // Mark messages as read so the user sees the double-blue-tick
  if (phoneNumberId && accessToken) {
    try {
      const whatsapp = new WhatsAppService({ phoneNumberId, accessToken });
      const messages = req.body.entry?.[0]?.changes?.[0]?.value?.messages || [];
      for (const message of messages) {
        await whatsapp.markAsRead(message.id);
      }
    } catch (e) {
      console.error('Mark as read error:', e.message);
    }
  }

  // Forward raw payload to web app for AI processing
  if (!webappUrl) {
    console.error('❌ WEBAPP_URL not configured — cannot forward message to web app');
    return;
  }

  try {
    const response = await fetch(`${webappUrl}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    console.log(`✅ Forwarded to web app — HTTP ${response.status}`);
  } catch (e) {
    console.error('❌ Failed to forward webhook to web app:', e.message);
  }
});

export default router;
