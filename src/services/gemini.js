import { GoogleGenAI } from '@google/genai';

export class GeminiService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.genAI = new GoogleGenAI({ apiKey });
  }

  /**
   * Generate an AI response given a system prompt and conversation history.
   * conversationHistory: Array of { role: 'user'|'model', parts: [{ text }] }
   */
  async generateResponse(systemPrompt, conversationHistory) {
    try {
      // System prompt injected as the first user turn (Gemini pattern)
      const contents = [
        { role: 'user', parts: [{ text: systemPrompt }] },
        ...conversationHistory,
      ];

      const response = await this.genAI.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
      });

      return response.text || null;
    } catch (e) {
      console.error('❌ Gemini generation error:', e.message);
      return null;
    }
  }
}
