const BASE_URL = 'https://graph.facebook.com/v21.0';

export class WhatsAppService {
  constructor(config) {
    // config: { phoneNumberId, accessToken }
    this.config = config;
  }

  /**
   * Send a text message via WhatsApp Business Cloud API
   */
  async sendMessage(to, text) {
    if (!this.config.accessToken || !this.config.phoneNumberId) {
      console.warn('⚠️  WhatsApp not configured — cannot send message');
      return false;
    }
    try {
      const url = `${BASE_URL}/${this.config.phoneNumberId}/messages`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: text },
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ WhatsApp API Error:', JSON.stringify(error));
        return false;
      }

      const data = await response.json();
      console.log('✅ WhatsApp message sent:', data.messages?.[0]?.id);
      return true;
    } catch (e) {
      console.error('WhatsApp send error:', e.message);
      return false;
    }
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId) {
    if (!this.config.accessToken || !this.config.phoneNumberId) return;
    try {
      const url = `${BASE_URL}/${this.config.phoneNumberId}/messages`;
      await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });
    } catch (e) {
      console.error('Mark as read error:', e.message);
    }
  }

  /**
   * Parse all messages from a webhook payload
   */
  parseAllMessages(webhookPayload) {
    try {
      const entry = webhookPayload.entry?.[0];
      const changes = entry?.changes?.[0];
      const messages = changes?.value?.messages;
      if (!messages || messages.length === 0) return [];

      return messages.map(message => ({
        id: message.id,
        from: message.from,
        to: changes.value.metadata?.display_phone_number,
        timestamp: new Date(parseInt(message.timestamp, 10) * 1000),
        type: message.type,
        text: message.text?.body,
        mediaUrl: message.image?.id || message.audio?.id || message.video?.id,
        caption: message.image?.caption || message.video?.caption,
      }));
    } catch (e) {
      console.error('Failed to parse webhook messages:', e.message);
      return [];
    }
  }
}
