const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db');
const { requireVendor, verifyVendorPin } = require('../middleware/auth');

// ─── Login ────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.vendorId) return res.redirect('/vendor');
  res.send(vendorLoginPage({ error: null }));
});

router.post('/login', async (req, res) => {
  const { pin } = req.body;
  if (!pin) return res.send(vendorLoginPage({ error: 'Please enter your PIN' }));

  // Find vendor with matching PIN
  const vendors = db.getVendors();
  let matchedVendor = null;
  for (const v of vendors) {
    if (v.pin) {
      const ok = await verifyVendorPin(pin, v);
      if (ok) { matchedVendor = v; break; }
    }
  }

  if (!matchedVendor) return res.send(vendorLoginPage({ error: 'Invalid PIN. Please contact the organiser.' }));
  if (!matchedVendor.active) return res.send(vendorLoginPage({ error: 'Your account is currently inactive.' }));

  req.session.vendorId = matchedVendor.id;
  req.session.vendorName = matchedVendor.name;
  const dest = req.session.returnTo || '/vendor';
  delete req.session.returnTo;
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/vendor/login');
});

// ─── Vendor Portal ────────────────────────────────────────────────────────────
router.get('/', requireVendor, (req, res) => {
  const vendor = db.getVendor(req.session.vendorId);
  if (!vendor) { req.session.destroy(); return res.redirect('/vendor/login'); }
  const vouchers = db.getVouchersByVendor(vendor.id);
  res.send(vendorPortalPage({ vendor, vouchers }));
});

// QR PNG (vendor-accessible)
router.get('/qr/:token', requireVendor, async (req, res) => {
  const voucher = db.getVoucherByToken(req.params.token);
  if (!voucher || voucher.vendor_id !== req.session.vendorId) return res.status(404).send('Not found');
  const url = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/redeem/${voucher.qr_token}`;
  res.setHeader('Content-Type', 'image/png');
  await QRCode.toFileStream(res, url, { width: 300, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
});

// ─── HTML Renderers ───────────────────────────────────────────────────────────
function vendorLoginPage({ error }) {
  const venueName = process.env.VENUE_NAME || 'WiFi Access';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Vendor Portal — ${venueName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="center-page">
  <div class="login-card">
    <div class="login-brand">
      <div class="login-icon vendor-icon">◉</div>
      <h1>${venueName}</h1>
      <p>Vendor Portal</p>
    </div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form action="/vendor/login" method="POST" class="login-form">
      <div class="form-group">
        <label for="pin">Your Vendor PIN</label>
        <input id="pin" type="text" name="pin" placeholder="Enter your PIN" required
          autocomplete="off" inputmode="numeric" maxlength="16"
          style="text-align:center;font-size:1.5rem;letter-spacing:0.3em">
      </div>
      <button type="submit" class="btn btn-primary btn-full">Access My Portal</button>
    </form>
    <p class="login-help">Need help? Contact the venue organiser for your PIN.</p>
  </div>
</body>
</html>`;
}

function formatDuration(minutes) {
  if (minutes >= 1440) return `${(minutes / 1440).toFixed(0)} day(s)`;
  if (minutes >= 60) return `${(minutes / 60).toFixed(0)} hour(s)`;
  return `${minutes} minute(s)`;
}

function vendorPortalPage({ vendor, vouchers }) {
  const venueName = process.env.VENUE_NAME || 'WiFi Access';
  const ssid = process.env.WIFI_SSID || 'Guest WiFi';
  const baseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';

  const activeVouchers = vouchers.filter(v => v.status === 'active');
  const inactiveVouchers = vouchers.filter(v => v.status !== 'active');

  const voucherCard = (v, inactive = false) => `
    <div class="voucher-card ${inactive ? 'voucher-inactive' : ''}">
      <div class="voucher-header">
        <div>
          <div class="voucher-name">${v.package_name}</div>
          <div class="voucher-meta">${formatDuration(v.duration_minutes)} · ${v.quota_mb ? v.quota_mb + 'MB cap' : 'Unlimited data'} · ${v.max_uses === 1 ? 'Single use' : `${v.max_uses} device uses`}</div>
        </div>
        <span class="badge ${inactive ? 'badge-secondary' : 'badge-success'}">${v.status}</span>
      </div>
      ${!inactive ? `
        <div class="vendor-qr-wrap">
          <img src="/vendor/qr/${v.qr_token}" alt="QR Code for ${v.package_name}" class="vendor-qr">
          <div class="vendor-qr-info">
            <p class="qr-instruction">📱 Guests scan this QR code to get online</p>
            <div class="code-display">${v.code}</div>
            <p class="text-muted text-sm">Or connect to "<strong>${ssid}</strong>" and enter the code above</p>
            <a href="/vendor/qr/${v.qr_token}" download="wifi-access-${v.code}.png" class="btn btn-secondary btn-sm">Download QR</a>
          </div>
        </div>
      ` : `<div class="voucher-code-row"><code class="voucher-code">${v.code}</code><span class="text-muted text-sm">${v.revoked_at ? 'Revoked' : 'Inactive'}</span></div>`}
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>My WiFi Access — ${venueName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="vendor-layout">
  <header class="vendor-header">
    <div class="vendor-brand">
      <div class="brand-icon">⬡</div>
      <div>
        <div class="brand-name">${venueName}</div>
        <div class="brand-sub">Vendor Portal</div>
      </div>
    </div>
    <div class="vendor-header-right">
      <span class="vendor-name-badge">👤 ${vendor.name}</span>
      <form action="/vendor/logout" method="POST" style="margin:0">
        <button class="btn-logout" type="submit">Sign Out</button>
      </form>
    </div>
  </header>

  <div class="vendor-content">
    <div class="page-header">
      <div>
        <h1 class="page-title">Your WiFi Access</h1>
        <p class="page-subtitle">Share the QR code with your customers so they can get online</p>
      </div>
    </div>

    ${activeVouchers.length === 0 ? `
      <div class="empty-state">
        <div class="empty-icon">📡</div>
        <h3>No active access vouchers</h3>
        <p>Contact the venue organiser to issue your WiFi access package.</p>
      </div>
    ` : activeVouchers.map(v => voucherCard(v, false)).join('')}

    ${inactiveVouchers.length > 0 ? `
      <div class="section-header"><h2>Past Vouchers</h2></div>
      ${inactiveVouchers.map(v => voucherCard(v, true)).join('')}
    ` : ''}
  </div>
</body>
</html>`;
}

module.exports = router;
