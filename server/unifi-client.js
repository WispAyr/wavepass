const axios = require('axios');
const https = require('https');

// Bypass self-signed cert on local UDM Pro
const agent = new https.Agent({ rejectUnauthorized: false });

const BASE = process.env.UNIFI_HOST || 'https://192.168.1.1';
const SITE = process.env.UNIFI_SITE || 'default';
const USERNAME = process.env.UNIFI_USERNAME || '';
const PASSWORD = process.env.UNIFI_PASSWORD || '';

let _cookie = null;
let _csrfToken = null;
let _loginExpiry = 0;

const client = axios.create({
  baseURL: BASE,
  httpsAgent: agent,
  withCredentials: true,
  timeout: 15000,
});

// ─── Authentication ───────────────────────────────────────────────────────────
async function login() {
  try {
    const res = await client.post('/api/auth/login', {
      username: USERNAME,
      password: PASSWORD,
    });

    // Extract cookie header
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      _cookie = setCookie.map(c => c.split(';')[0]).join('; ');
    }
    _csrfToken = res.headers['x-csrf-token'] || '';
    _loginExpiry = Date.now() + 1000 * 60 * 55; // re-login after 55 min
    console.log('[UniFi] Authenticated successfully');
    return true;
  } catch (err) {
    console.error('[UniFi] Login failed:', err.message);
    throw new Error('UniFi authentication failed. Check UNIFI_USERNAME / UNIFI_PASSWORD in .env');
  }
}

async function ensureAuth() {
  if (!_cookie || Date.now() > _loginExpiry) {
    await login();
  }
}

function authHeaders() {
  return {
    Cookie: _cookie,
    'X-CSRF-Token': _csrfToken,
    'Content-Type': 'application/json',
  };
}

// ─── Voucher API ──────────────────────────────────────────────────────────────

/**
 * Create a voucher on the UniFi controller.
 * @param {object} opts
 * @param {number} opts.durationMinutes - How long the voucher is valid once activated
 * @param {number} opts.quotaMb - Data cap in MB (0 = unlimited)
 * @param {number} opts.maxUses - How many devices can use this voucher (1 = single use)
 * @param {string} opts.note - Label shown in UniFi Hotspot Manager
 * @returns {Promise<{code: string, id: string}>}
 */
async function createVoucher({ durationMinutes = 1440, quotaMb = 0, maxUses = 1, note = '' }) {
  await ensureAuth();

  const body = {
    cmd: 'create-voucher',
    expire: durationMinutes,
    n: 1,
    quota: maxUses === 1 ? 1 : 0, // 1=single-use, 0=multi-use
    note: note.substring(0, 64),
  };

  // Add data cap if specified
  if (quotaMb > 0) {
    body.bytes = quotaMb * 1024 * 1024;
  }

  try {
    const res = await client.post(
      `/proxy/network/api/s/${SITE}/cmd/hotspot`,
      body,
      { headers: authHeaders() }
    );

    const created = res.data?.data?.[0];
    if (!created) throw new Error('No voucher data returned from UniFi');

    // Fetch the actual code — UniFi returns the voucher ID, need to query for code
    const code = await getVoucherCode(created['create-time']);
    return { id: created._id || created['create-time'], code };
  } catch (err) {
    if (err.response?.status === 401) {
      _cookie = null; // force re-login next time
    }
    console.error('[UniFi] createVoucher error:', err.message);
    throw err;
  }
}

/**
 * Fetch a voucher code by its creation timestamp (UniFi quirk)
 */
async function getVoucherCode(createTime) {
  await ensureAuth();
  const res = await client.get(
    `/proxy/network/api/s/${SITE}/stat/voucher`,
    { headers: authHeaders() }
  );
  const vouchers = res.data?.data || [];
  const match = vouchers.find(v => v['create-time'] === createTime);
  if (!match) throw new Error('Could not find newly created voucher');
  return match.code;
}

/**
 * List all vouchers from UniFi
 */
async function listVouchers() {
  await ensureAuth();
  try {
    const res = await client.get(
      `/proxy/network/api/s/${SITE}/stat/voucher`,
      { headers: authHeaders() }
    );
    return res.data?.data || [];
  } catch (err) {
    console.error('[UniFi] listVouchers error:', err.message);
    return [];
  }
}

/**
 * Revoke (delete) a voucher from UniFi
 */
async function revokeVoucher(unifiVoucherId) {
  await ensureAuth();
  try {
    await client.post(
      `/proxy/network/api/s/${SITE}/cmd/hotspot`,
      { cmd: 'delete-voucher', _id: unifiVoucherId },
      { headers: authHeaders() }
    );
    return true;
  } catch (err) {
    console.error('[UniFi] revokeVoucher error:', err.message);
    return false;
  }
}

/**
 * Test connectivity to UniFi controller (used by admin status check)
 */
async function testConnection() {
  try {
    await login();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { createVoucher, listVouchers, revokeVoucher, testConnection };
