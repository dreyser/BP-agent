import { MongoClient } from 'mongodb';

let db = null;

export async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('⚠️  MONGODB_URI not set — persistence disabled, using in-memory fallback');
    return null;
  }
  try {
    const client = new MongoClient(uri);
    await client.connect();
    db = client.db(process.env.MONGODB_DB || 'AI_agent');

    // Ensure indexes for WhatsApp conversations
    await db.collection('whatsapp_conversations').createIndex(
      { contactPhone: 1 },
      { unique: true }
    );
    await db.collection('whatsapp_conversations').createIndex(
      { lastMessageAt: -1 }
    );

    console.log('✅ MongoDB connected:', db.databaseName);
    return db;
  } catch (e) {
    console.error('❌ MongoDB connection failed:', e.message);
    return null;
  }
}

export function getDb() {
  return db;
}

// ─── Settings loader with TTL cache ──────────────────────────────────────────

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_TTL_MS = 60_000; // 60 seconds

export async function loadSettings() {
  const now = Date.now();
  if (settingsCache && now - settingsCacheTime < SETTINGS_TTL_MS) {
    return settingsCache;
  }
  if (!db) return null;
  try {
    const doc = await db.collection('settings').findOne({ _id: 'main' });
    settingsCache = doc?.data || null;
    settingsCacheTime = now;
    return settingsCache;
  } catch (e) {
    console.error('Failed to load settings:', e.message);
    return settingsCache; // return stale cache on error
  }
}

// ─── Workflow loader ──────────────────────────────────────────────────────────

export async function loadLiveWhatsAppWorkflow() {
  if (!db) return null;
  try {
    // Look for a live workflow whose trigger node has channelType whatsapp_inbound
    // or channel === 'whatsapp'
    const workflows = await db
      .collection('workflows')
      .find({ status: 'live' })
      .toArray();

    // Prefer whatsapp_inbound trigger
    for (const wf of workflows) {
      if (wf.flowNodes && Array.isArray(wf.flowNodes)) {
        const trigger = wf.flowNodes.find(n => n.type === 'trigger');
        if (
          trigger?.config?.channelType === 'whatsapp_inbound' ||
          trigger?.config?.channelType === 'whatsapp_outbound'
        ) {
          return wf;
        }
      }
      if (wf.channel === 'whatsapp') return wf;
    }

    // Fallback: return any live workflow
    return workflows[0] || null;
  } catch (e) {
    console.error('Failed to load workflow:', e.message);
    return null;
  }
}
