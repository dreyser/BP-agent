import { getDb } from './mongodb.js';
import { GeminiService } from './gemini.js';
import { generateSystemPromptFromWorkflow } from '../utils/workflow-utils.js';

const COLLECTION = 'whatsapp_conversations';
const MAX_HISTORY = 50; // keep last 50 messages per conversation

export class ConversationManager {
  constructor(whatsappService, geminiApiKey) {
    this.whatsappService = whatsappService;
    this.gemini = new GeminiService(geminiApiKey);
    // In-memory fallback if MongoDB is unavailable
    this.memoryStore = new Map();
  }

  // ─── Persistence ───────────────────────────────────────────────────────────

  async getConversation(contactPhone) {
    const db = getDb();
    if (db) {
      return db.collection(COLLECTION).findOne({ contactPhone });
    }
    return this.memoryStore.get(contactPhone) || null;
  }

  async saveConversation(conversation) {
    const db = getDb();
    if (db) {
      // Exclude createdAt from $set — it's handled by $setOnInsert on first write only
      const { createdAt: _createdAt, ...fields } = conversation;
      await db.collection(COLLECTION).updateOne(
        { contactPhone: conversation.contactPhone },
        {
          $set: { ...fields, updatedAt: new Date() },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    } else {
      this.memoryStore.set(conversation.contactPhone, conversation);
    }
  }

  // ─── Main handler ──────────────────────────────────────────────────────────

  async handleIncomingMessage(message, workflow, language) {
    // Get or create conversation
    let conversation = await this.getConversation(message.from);
    if (!conversation) {
      conversation = {
        contactPhone: message.from,
        messages: [],
        status: 'active',
        lastMessageAt: message.timestamp,
        assignedLead: {
          id: `whatsapp_${message.from}`,
          name: message.from,
          company: 'WhatsApp Contact',
          phone: message.from,
          status: 'calling',
          history: [],
        },
      };
    }

    // Add incoming message
    conversation.messages.push(message);
    conversation.lastMessageAt = message.timestamp;
    conversation.status = 'active';

    // Trim history
    if (conversation.messages.length > MAX_HISTORY) {
      conversation.messages = conversation.messages.slice(-MAX_HISTORY);
    }

    // Save immediately (marks message received)
    await this.saveConversation(conversation);

    // Mark as read on WhatsApp side
    await this.whatsappService.markAsRead(message.id);

    // Generate AI response
    const aiText = await this.generateAIResponse(conversation, workflow, language);

    if (aiText) {
      const sent = await this.whatsappService.sendMessage(message.from, aiText);
      if (sent) {
        conversation.messages.push({
          id: `ai_${Date.now()}`,
          from: 'AI',
          to: message.from,
          timestamp: new Date(),
          type: 'text',
          text: aiText,
        });

        if (conversation.messages.length > MAX_HISTORY) {
          conversation.messages = conversation.messages.slice(-MAX_HISTORY);
        }

        await this.saveConversation(conversation);
      }
    }

    return aiText;
  }

  // ─── AI response generation ────────────────────────────────────────────────

  async generateAIResponse(conversation, workflow, language) {
    // Build Gemini conversation history (skip the latest user message — it's in the prompt)
    const conversationHistory = conversation.messages.map(msg => ({
      role: msg.from === 'AI' ? 'model' : 'user',
      parts: [{ text: msg.text || '[media message]' }],
    }));

    // Generate system prompt from the active workflow
    const systemPrompt = generateSystemPromptFromWorkflow(
      workflow,
      conversation.assignedLead,
      language || 'English'
    );

    const enhancedPrompt = `${systemPrompt}

IMPORTANT: You are responding via WhatsApp text messages. Keep responses:
- Concise (under 300 characters when possible)
- Use emojis sparingly and naturally
- Use WhatsApp formatting: *bold*, _italic_, ~strikethrough~
- Be conversational and friendly

Current conversation has ${conversation.messages.length} messages.`;

    return this.gemini.generateResponse(enhancedPrompt, conversationHistory);
  }
}
