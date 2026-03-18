import { Router } from 'express';
import { loadSettings, loadLiveWhatsAppWorkflow } from '../services/mongodb.js';
import { WhatsAppService } from '../services/whatsapp.js';
import { ConversationManager } from '../services/conversation.js';
import { getDefaultWhatsAppPrompt } from '../utils/workflow-utils.js';

const router = Router();

// ─── Resolve config: env vars take priority over MongoDB settings ─────────────

async function resolveConfig() {
  const settings = await loadSettings();

  const phoneNumberId =
    process.env.WHATSAPP_PHONE_NUMBER_ID || settings?.whatsapp?.phoneNumberId || '';
  const accessToken =
    process.env.WHATSAPP_ACCESS_TOKEN || settings?.whatsapp?.accessToken || '';
  const verifyToken =
    process.env.WHATSAPP_VERIFY_TOKEN || settings?.whatsapp?.verifyToken || '';
  const geminiApiKey =
    process.env.GEMINI_API_KEY || settings?.geminiApiKey || '';
  const language =
    process.env.LANGUAGE || settings?.language || 'English';

  return { phoneNumberId, accessToken, verifyToken, geminiApiKey, language };
}

// ─── GET /webhook/whatsapp — Meta webhook verification ────────────────────────

router.get('/whatsapp', async (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const { verifyToken } = await resolveConfig();

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('✅ WhatsApp webhook verified');
    return res.status(200).send(challenge);
  }

  console.error('❌ WhatsApp webhook verification failed — token mismatch');
  res.sendStatus(403);
});

// ─── POST /webhook/whatsapp — Incoming messages ───────────────────────────────

router.post('/whatsapp', async (req, res) => {
  // Acknowledge immediately — Meta requires 200 within 20 seconds
  res.sendStatus(200);

  console.log(`[${new Date().toISOString()}] 📨 WhatsApp webhook received`);

  try {
    const { phoneNumberId, accessToken, geminiApiKey, language } = await resolveConfig();

    if (!geminiApiKey) {
      console.error('❌ GEMINI_API_KEY not configured — cannot process message');
      return;
    }

    if (!phoneNumberId || !accessToken) {
      console.error('❌ WhatsApp credentials not configured');
      return;
    }

    // Parse all messages from the payload
    const whatsapp = new WhatsAppService({ phoneNumberId, accessToken });
    const messages = whatsapp.parseAllMessages(req.body);

    if (messages.length === 0) {
      // Could be a status update (delivered/read) — ignore silently
      console.log('ℹ️  No messages in payload (possibly a status update)');
      return;
    }

    // Load the active workflow (or use a default prompt)
    const workflow = await loadLiveWhatsAppWorkflow();

    const manager = new ConversationManager(whatsapp, geminiApiKey);

    // Process each incoming message sequentially
    for (const message of messages) {
      if (message.type !== 'text' && message.type !== 'image' && message.type !== 'audio') {
        // Skip unsupported message types (stickers, reactions, etc.)
        console.log(`ℹ️  Skipping message type: ${message.type}`);
        continue;
      }

      console.log(`📱 Message from ${message.from}: ${message.text || `[${message.type}]`}`);

      // If no workflow found, inject a default one
      const activeWorkflow = workflow || {
        id: 'default',
        name: 'Default WhatsApp',
        channel: 'whatsapp',
        flowNodes: [],
        actions: [],
      };

      await manager.handleIncomingMessage(message, activeWorkflow, language);
    }
  } catch (e) {
    console.error('❌ Error processing WhatsApp webhook:', e.message);
  }
});

export default router;
