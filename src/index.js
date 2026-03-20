import express from 'express';
import dotenv from 'dotenv';
import webhookRouter from './routes/webhook.js';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// Request logger (skip high-frequency health checks)
app.use((req, res, next) => {
  if (req.path !== '/health') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check — used by Azure to determine if the app is healthy
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    service: 'BP-agent WhatsApp Webhook Relay',
    timestamp: new Date().toISOString(),
  });
});

// WhatsApp webhook (GET = verification, POST = relay to web app)
app.use('/webhook', webhookRouter);

// ─── 404 handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const webappUrl = process.env.WEBAPP_URL || '';

app.listen(port, () => {
  console.log('');
  console.log('========================================');
  console.log('🐼 BP-Agent WhatsApp Webhook Relay');
  console.log('========================================');
  console.log(`📍 Port: ${port}`);
  console.log('');
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  GET  /webhook/whatsapp  (Meta verification)');
  console.log('  POST /webhook/whatsapp  (Relay to web app)');
  console.log('');
  console.log('Config:');
  console.log(`  WHATSAPP_PHONE_NUMBER_ID : ${process.env.WHATSAPP_PHONE_NUMBER_ID ? '✅ set' : '❌ not set'}`);
  console.log(`  WHATSAPP_ACCESS_TOKEN    : ${process.env.WHATSAPP_ACCESS_TOKEN ? '✅ set' : '❌ not set'}`);
  console.log(`  WHATSAPP_VERIFY_TOKEN    : ${process.env.WHATSAPP_VERIFY_TOKEN ? '✅ set' : '❌ not set'}`);
  console.log(`  WEBAPP_URL               : ${webappUrl || '❌ not set — messages will NOT be forwarded'}`);
  console.log('========================================');
  console.log('');
});
