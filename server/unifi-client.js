const axios = require('axios');
const https = require('https');

const MODE     = process.env.UNIFI_MODE || 'direct'; // 'direct' | 'bridge'
const BASE     = process.env.UNIFI_HOST || 'https://192.168.1.1';
const SITE     = process.env.UNIFI_SITE || 'default';
const USERNAME = process.env.UNIFI_USERNAME || '';
const PASSWORD = process.env.UNIFI_PASSWORD || '';

const BRIDGE_URL    = process.env.BRIDGE_URL    || '';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || '';

// Bypass self-signed cert on UDM Pro (local or via WireGuard tunnel)
const agent = new https.Agent({ rejectUnauthorized: false });

// ─── Direct client (same-LAN or WireGuard tunnel) ─────────────────────────────
const directClient = axios.create({ baseURL: BASE, httpsAgent: agent, timeout: 15000 });

let _cookie = null, _csrf = null, _loginExpiry = 0;

async function login() {
  const res = await directClient.post('/api/auth/login', { username: USERNAME, password: PASSWORD });
  const setCookie = res.headers['set-cookie'];
  if (setCookie) _cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  _csrf        = res.headers['x-csrf-token'] || '';
  _loginExpiry = Date.now() + 55 * 60 * 1000;
  console.log('[UniFi] Authenticated via', MODE === 'bridge' ? 'bridge agent' : `direct (${BASE})`);
}

async function ensureAuth() {
  if (MODE === 'bridge') return; // bridge handles its own auth
  if (!_cookie || Date.now() > _loginExpiry) await login();
}

function authHeaders() {
  return { Cookie: _cookie, 'X-CSRF-Token': _csrf, 'Content-Type': 'application/json' };
}

// ─── Bridge client ─────────────────────────────────────────────────────────────
const bridgeClient = axios.create({
  baseURL: BRIDGE_URL,
  timeout: 20000,
  headers: { 'x-bridge-secret': BRIDGE_SECRET },
});

// ─── Public API ────────────────────────────────────────────────────────────────

async function createVoucher({ durationMinutes = 1440, quotaMb = 0, maxUses = 1, note = '' }) {
  if (MODE === 'bridge') {
    const res = await bridgeClient.post('/voucher', { durationMinutes, quotaMb, maxUses, note });
    return res.data; // { id, code }
  }

  await ensureAuth();
  const body = {
    cmd: 'create-voucher', expire: durationMinutes, n: 1,
    quota: maxUses === 1 ? 1 : 0,
    note: note.substring(0, 64),
    ...(quotaMb > 0 ? { bytes: quotaMb * 1024 * 1024 } : {}),
  };

  const res = await directClient.post(
    `/proxy/network/api/s/${SITE}/cmd/hotspot`, body, { headers: authHeaders() }
  );
  const created = res.data?.data?.[0];
  if (!created) throw new Error('No voucher data returned from UniFi');

  const code = await getVoucherCode(created['create-time']);
  return { id: created._id || created['create-time'], code };
}

async function getVoucherCode(createTime) {
  await ensureAuth();
  const res = await directClient.get(
    `/proxy/network/api/s/${SITE}/stat/voucher`, { headers: authHeaders() }
  );
  const match = (res.data?.data || []).find(v => v['create-time'] === createTime);
  if (!match) throw new Error('Could not find newly created voucher');
  return match.code;
}

async function listVouchers() {
  if (MODE === 'bridge') {
    const res = await bridgeClient.get('/vouchers');
    return res.data;
  }
  await ensureAuth();
  const res = await directClient.get(
    `/proxy/network/api/s/${SITE}/stat/voucher`, { headers: authHeaders() }
  );
  return res.data?.data || [];
}

async function revokeVoucher(unifiVoucherId) {
  if (MODE === 'bridge') {
    await bridgeClient.delete(`/voucher/${unifiVoucherId}`);
    return true;
  }
  await ensureAuth();
  try {
    await directClient.post(
      `/proxy/network/api/s/${SITE}/cmd/hotspot`,
      { cmd: 'delete-voucher', _id: unifiVoucherId },
      { headers: authHeaders() }
    );
    return true;
  } catch (e) {
    console.error('[UniFi] revokeVoucher error:', e.message);
    return false;
  }
}

async function testConnection() {
  try {
    if (MODE === 'bridge') {
      const res = await bridgeClient.get('/test');
      return res.data;
    }
    await login();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { createVoucher, listVouchers, revokeVoucher, testConnection };
