/**
 * WavePass Bridge Agent
 * 
 * Run this on ANY machine on the same LAN as the UDM Pro.
 * It acts as a secure proxy between the remote WavePass server
 * and the UniFi controller's local-only API.
 * 
 * Start: node bridge/agent.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const https = require('https');

const app = express();
app.use(express.json());

const PORT       = process.env.BRIDGE_PORT   || 4000;
const SECRET     = process.env.BRIDGE_SECRET || '';
const UNIFI_HOST = process.env.UNIFI_HOST    || 'https://192.168.1.1';
const UNIFI_USER = process.env.UNIFI_USERNAME || '';
const UNIFI_PASS = process.env.UNIFI_PASSWORD || '';
const SITE       = process.env.UNIFI_SITE    || 'default';

if (!SECRET) console.warn('[BRIDGE] ⚠  BRIDGE_SECRET is not set — all requests will be accepted!');

// Bypass self-signed cert for local UDM Pro
const agent = new https.Agent({ rejectUnauthorized: false });
const unifi = axios.create({ baseURL: UNIFI_HOST, httpsAgent: agent, timeout: 15000 });

let _cookie = null;
let _csrf   = null;
let _expiry = 0;

async function login() {
  const res = await unifi.post('/api/auth/login', { username: UNIFI_USER, password: UNIFI_PASS });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) _cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  _csrf   = res.headers['x-csrf-token'] || '';
  _expiry = Date.now() + 55 * 60 * 1000;
  console.log('[Bridge] UniFi authenticated');
}

async function ensureAuth() {
  if (!_cookie || Date.now() > _expiry) await login();
}

function authHeaders() {
  return { Cookie: _cookie, 'X-CSRF-Token': _csrf, 'Content-Type': 'application/json' };
}

// ─── Auth middleware ──────────────────────────────────────────
function checkSecret(req, res, next) {
  if (!SECRET) return next();
  const provided = req.headers['x-bridge-secret'];
  if (provided !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// ─── Health ───────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// ─── Test UniFi connection ────────────────────────────────────
app.get('/test', checkSecret, async (req, res) => {
  try {
    await login();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── Create voucher ───────────────────────────────────────────
app.post('/voucher', checkSecret, async (req, res) => {
  const { durationMinutes = 1440, quotaMb = 0, maxUses = 1, note = '' } = req.body;
  try {
    await ensureAuth();

    const createRes = await unifi.post(
      `/proxy/network/api/s/${SITE}/cmd/hotspot`,
      { cmd: 'create-voucher', expire: durationMinutes, n: 1, quota: maxUses === 1 ? 1 : 0, note: note.substring(0, 64), ...(quotaMb > 0 ? { bytes: quotaMb * 1024 * 1024 } : {}) },
      { headers: authHeaders() }
    );

    const created = createRes.data?.data?.[0];
    if (!created) return res.status(500).json({ error: 'No voucher returned' });

    // Fetch the code by querying all vouchers and matching create-time
    const listRes = await unifi.get(`/proxy/network/api/s/${SITE}/stat/voucher`, { headers: authHeaders() });
    const match   = (listRes.data?.data || []).find(v => v['create-time'] === created['create-time']);
    if (!match) return res.status(500).json({ error: 'Could not find new voucher code' });

    res.json({ id: match._id, code: match.code });
  } catch (e) {
    if (e.response?.status === 401) _cookie = null;
    console.error('[Bridge] createVoucher error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── List vouchers ────────────────────────────────────────────
app.get('/vouchers', checkSecret, async (req, res) => {
  try {
    await ensureAuth();
    const r = await unifi.get(`/proxy/network/api/s/${SITE}/stat/voucher`, { headers: authHeaders() });
    res.json(r.data?.data || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Revoke voucher ───────────────────────────────────────────
app.delete('/voucher/:id', checkSecret, async (req, res) => {
  try {
    await ensureAuth();
    await unifi.post(
      `/proxy/network/api/s/${SITE}/cmd/hotspot`,
      { cmd: 'delete-voucher', _id: req.params.id },
      { headers: authHeaders() }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n⬡  WavePass Bridge Agent running on port ${PORT}`);
  console.log(`   Proxying to: ${UNIFI_HOST}`);
  console.log(`   Auth:        ${SECRET ? 'secret key set ✓' : 'NO SECRET SET ⚠'}\n`);
});
