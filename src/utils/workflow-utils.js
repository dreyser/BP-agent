// Ported from Salesworkflow/utils/workflow-utils.ts

// ─── FlowNode-based prompt generation ─────────────────────────────────────────

function walkFlowTree(nodeMap, nodeId, lead, depth = 0) {
  if (!nodeId) return '';
  const node = nodeMap.get(nodeId);
  if (!node) return '';

  const indent = '  '.repeat(depth);
  const parts = [];

  const replace = s =>
    s
      .replace(/\{\{name\}\}/g, lead.name || '')
      .replace(/\{\{company\}\}/g, lead.company || '');

  switch (node.type) {
    case 'trigger':
      // Skip trigger node — channel context is in the header
      break;

    case 'message':
      parts.push(`${indent}SAY: ${replace(node.config.script || 'Greet the contact professionally.')}`);
      break;

    case 'question':
      parts.push(`${indent}ASK: ${replace(node.config.question || 'Ask a relevant question.')}`);
      parts.push(`${indent}  (Listen to the answer and then continue to the next step.)`);
      break;

    case 'decision': {
      const question = replace(
        node.config.question || "Determine the contact's intent from their response."
      );
      parts.push(`${indent}DECISION: ${question}`);

      if (node.yesId) {
        parts.push(`${indent}  → IF YES / POSITIVE:`);
        parts.push(walkFlowTree(nodeMap, node.yesId, lead, depth + 2));
      }
      if (node.noId) {
        parts.push(`${indent}  → IF NO / NEGATIVE:`);
        parts.push(walkFlowTree(nodeMap, node.noId, lead, depth + 2));
      }
      // Decision nodes end their own branch — do NOT fall through to nextId
      return parts.filter(Boolean).join('\n');
    }

    case 'action': {
      const at = node.config.actionType;
      if (at === 'check_calendar') {
        parts.push(
          `${indent}ACTION: Use the 'check_availability' tool to check calendar availability before booking.`
        );
      } else if (at === 'book_meeting') {
        parts.push(
          `${indent}ACTION: Use the 'book_meeting' tool to schedule the meeting once a time is agreed.`
        );
      } else if (at === 'log_to_sheets') {
        parts.push(
          `${indent}ACTION: Log the outcome to Google Sheets (this happens automatically after the conversation).`
        );
      } else if (at === 'send_email') {
        parts.push(
          `${indent}ACTION: Send a follow-up email (this happens automatically after the conversation).`
        );
      } else {
        parts.push(`${indent}ACTION: ${node.label}`);
      }
      break;
    }

    case 'end':
      parts.push(
        `${indent}END CONVERSATION: ${replace(
          node.config.message || 'Thank the contact and close the conversation politely.'
        )}`
      );
      return parts.filter(Boolean).join('\n');
  }

  // Continue to next node in sequence
  if (node.nextId) {
    parts.push(walkFlowTree(nodeMap, node.nextId, lead, depth));
  }

  return parts.filter(Boolean).join('\n');
}

function generatePromptFromFlowNodes(flowNodes, lead, language) {
  const languageInstruction =
    language && language !== 'English' ? `IMPORTANT: Respond in ${language}.` : '';
  const nodeMap = new Map(flowNodes.map(n => [n.id, n]));
  const trigger = flowNodes.find(n => n.type === 'trigger');
  if (!trigger) return '';

  const ct = trigger.config?.channelType ?? 'voice_outbound';

  let header = '';
  if (ct === 'voice_outbound') {
    header = `You are a professional sales representative making an outbound phone call.
${languageInstruction}
- Be polite and concise — 1-2 sentences per turn
- Ask ONE question at a time and wait for the answer
- Let the contact speak; do not interrupt

CONTACT: ${lead.name} | ${lead.company} | ${lead.phone}
`;
  } else if (ct === 'voice_inbound') {
    header = `You are a professional AI assistant answering an incoming phone call.
${languageInstruction}
- The customer called YOU — be immediately welcoming and helpful
- Ask how you can assist before pitching anything
- Keep responses SHORT and conversational (1-2 sentences max)

CALLER: ${lead.name} | ${lead.phone}
`;
  } else if (ct === 'whatsapp_outbound') {
    header = `You are a professional AI assistant sending outbound WhatsApp messages.
${languageInstruction}
- You sent the first message — be friendly and non-intrusive
- Keep each message under 300 characters when possible
- Use emojis sparingly

CONTACT: ${lead.name} | ${lead.company} | ${lead.phone}
`;
  } else {
    // whatsapp_inbound (default for this webhook)
    header = `You are a professional AI assistant replying to an incoming WhatsApp message.
${languageInstruction}
- The contact messaged you first — respond promptly and helpfully
- Keep messages concise and conversational

CONTACT: ${lead.name} | ${lead.phone}
`;
  }

  const flowInstructions = walkFlowTree(nodeMap, trigger.nextId, lead, 0);

  return `${header}
CONVERSATION FLOW:
${flowInstructions || "(Follow the conversation naturally based on the contact's needs.)"}

Be professional, empathetic, and natural throughout the conversation.`;
}

// ─── Legacy flat-actions prompt generation ────────────────────────────────────

function getActionInstruction(action) {
  switch (action.type) {
    case 'introduce':
      return (
        action.config.script ||
        'Introduce yourself politely as a sales representative from your company.'
      );
    case 'ask_question':
      return action.config.question || 'Ask the configured question.';
    case 'conditional_branch': {
      const condition = action.config.condition || 'condition';
      const ifTrue = action.config.ifTrueInstruction || 'proceed with next steps';
      const ifFalse = action.config.ifFalseInstruction || 'politely end the conversation';
      const continueNote = action.config.alwaysContinue ? ' Then continue to the next step.' : '';
      return `Assess if the prospect ${condition.replace('_', ' ')}.
- IF YES: ${ifTrue}${continueNote}
- IF NO: ${ifFalse}${continueNote}`;
    }
    case 'check_calendar':
      return "If the prospect wants to schedule, USE the 'check_availability' tool to check their calendar.";
    case 'book_meeting':
      return "Once a time is agreed, USE the 'book_meeting' tool to schedule the demo.";
    case 'log_to_sheets':
      return 'Log the call outcome (this happens automatically after the call).';
    case 'send_email':
      return 'Send a follow-up email (this happens automatically after the call).';
    case 'custom_script':
      return action.config.script || 'Execute custom instruction.';
    default:
      return `Execute: ${action.label}`;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function generateSystemPromptFromWorkflow(workflow, lead, language) {
  // Prefer visual FlowNode tree if available
  if (workflow?.flowNodes && workflow.flowNodes.length > 0) {
    return generatePromptFromFlowNodes(workflow.flowNodes, lead, language);
  }

  // Legacy: flat actions array
  const languageInstruction =
    language && language !== 'English' ? `IMPORTANT: Speak in ${language}.` : '';
  const isWhatsApp = workflow?.channel === 'whatsapp';

  let prompt = '';

  if (isWhatsApp) {
    prompt = `You are a professional AI assistant communicating via WhatsApp text messages.
${languageInstruction}

COMMUNICATION CHANNEL: WhatsApp
- Keep responses concise (under 300 characters when possible)
- Use natural, conversational tone
- Use emojis sparingly (1-2 per message max)
- Format text with *bold* for emphasis when needed
- Be patient — the user may respond slowly

CONTACT INFORMATION:
- Phone: ${lead.phone}
- Name: ${lead.name || 'Unknown'}
- Company: ${lead.company || 'Not provided'}

CONVERSATION FLOW:\n`;
  } else {
    prompt = `You are a professional AI assistant replying to an incoming WhatsApp message.
${languageInstruction}

- The contact messaged you first — respond promptly and helpfully
- Keep messages concise and conversational

CONTACT: ${lead.name} | ${lead.phone}

CONVERSATION FLOW:\n`;
  }

  if (workflow?.actions) {
    const enabledActions = workflow.actions
      .filter(a => a.enabled)
      .sort((a, b) => a.order - b.order);

    enabledActions.forEach((action, index) => {
      let instruction = getActionInstruction(action);
      instruction = instruction
        .replace(/\{\{name\}\}/g, lead.name || '')
        .replace(/\{\{company\}\}/g, lead.company || '');
      prompt += `${index + 1}. ${instruction}\n`;
    });
  }

  prompt += '\nBe professional, concise, and natural.';
  return prompt;
}

// ─── Fallback default prompt (no workflow configured) ─────────────────────────

export function getDefaultWhatsAppPrompt(lead, language) {
  const languageInstruction =
    language && language !== 'English' ? `IMPORTANT: Respond in ${language}.` : '';
  return `You are a professional AI sales assistant replying to an incoming WhatsApp message.
${languageInstruction}

- The contact messaged you first — respond promptly and helpfully
- Keep messages concise (under 300 characters when possible)
- Be friendly, professional, and conversational
- Help answer questions and guide the conversation towards a meeting or demo if appropriate
- Use emojis sparingly

CONTACT: ${lead.name || lead.phone} | ${lead.phone}

Be professional, empathetic, and natural throughout the conversation.`;
}
