const router = require('express').Router();
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const { nanoid } = require('nanoid');
const db = require('../db');
const unifi = require('../unifi-client');
const { requireAdmin, verifyAdmin } = require('../middleware/auth');

// ─── Login ────────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin');
  res.send(adminLoginPage({ error: null, venueName: process.env.VENUE_NAME || 'UniFi Access' }));
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const ok = await verifyAdmin(username, password, db);
  if (!ok) {
    return res.send(adminLoginPage({ error: 'Invalid username or password', venueName: process.env.VENUE_NAME || 'UniFi Access' }));
  }
  req.session.adminId = username;
  req.session.adminName = username;
  const dest = req.session.returnTo || '/admin';
  delete req.session.returnTo;
  res.redirect(dest);
});

router.post('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// ─── Dashboard ────────────────────────────────────────────────────────────────
router.get('/', requireAdmin, (req, res) => {
  const stats = db.getStats();
  const recentVouchers = db.getRecentVouchers(8);
  res.send(adminDashboard({ stats, recentVouchers, adminName: req.session.adminName }));
});

// ─── Vendors List ─────────────────────────────────────────────────────────────
router.get('/vendors', requireAdmin, (req, res) => {
  const vendors = db.getVendors();
  res.send(vendorListPage({ vendors, adminName: req.session.adminName }));
});

router.post('/vendors', requireAdmin, (req, res) => {
  const { name, email, phone, notes, pin } = req.body;
  if (!name) return res.redirect('/admin/vendors?error=Name+required');
  db.createVendor(name, email, phone, notes, pin || null);
  res.redirect('/admin/vendors?success=Vendor+created');
});

// ─── Vendor Detail ────────────────────────────────────────────────────────────
router.get('/vendors/:id', requireAdmin, (req, res) => {
  const vendor = db.getVendor(req.params.id);
  if (!vendor) return res.redirect('/admin/vendors?error=Vendor+not+found');
  const vouchers = db.getVouchersByVendor(vendor.id);
  res.send(vendorDetailPage({ vendor, vouchers, adminName: req.session.adminName }));
});

router.post('/vendors/:id/update', requireAdmin, (req, res) => {
  const { name, email, phone, notes } = req.body;
  db.updateVendor(req.params.id, name, email, phone, notes);
  res.redirect(`/admin/vendors/${req.params.id}?success=Updated`);
});

router.post('/vendors/:id/toggle', requireAdmin, (req, res) => {
  db.toggleVendorActive(req.params.id);
  res.redirect(`/admin/vendors/${req.params.id}`);
});

// ─── Issue Access Package (creates UniFi voucher) ─────────────────────────────
router.post('/vendors/:id/issue', requireAdmin, async (req, res) => {
  const vendorId = req.params.id;
  const vendor = db.getVendor(vendorId);
  if (!vendor) return res.redirect('/admin/vendors?error=Vendor+not+found');

  const { name, duration_minutes, quota_mb, max_uses, note } = req.body;
  const dur = parseInt(duration_minutes) || 1440;
  const quota = parseInt(quota_mb) || 0;
  const uses = parseInt(max_uses) || 1;

  try {
    // Create package record first
    const pkgResult = db.createPackage(vendorId, name || `${vendor.name} Pass`, dur, quota, uses, note);
    const packageId = pkgResult.lastInsertRowid;

    // Create UniFi voucher
    const unifiResult = await unifi.createVoucher({
      durationMinutes: dur,
      quotaMb: quota,
      maxUses: uses,
      note: `${vendor.name} — ${name || 'Pass'}`,
    });

    // Generate unique QR token
    const qrToken = nanoid(16);

    // Store voucher in DB
    db.createVoucher(packageId, vendorId, unifiResult.id, unifiResult.code, qrToken);

    res.redirect(`/admin/vendors/${vendorId}?success=Voucher+issued`);
  } catch (err) {
    console.error('[ISSUE]', err.message);
    res.redirect(`/admin/vendors/${vendorId}?error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Revoke Voucher ───────────────────────────────────────────────────────────
router.post('/vouchers/:id/revoke', requireAdmin, async (req, res) => {
  const voucher = db.getVoucherById(req.params.id);
  if (!voucher) return res.json({ ok: false, error: 'Not found' });

  if (voucher.unifi_voucher_id) {
    await unifi.revokeVoucher(voucher.unifi_voucher_id);
  }
  db.revokeVoucher(voucher.id);
  res.json({ ok: true });
});

// ─── QR Code PNG ─────────────────────────────────────────────────────────────
router.get('/qr/:token', requireAdmin, async (req, res) => {
  const voucher = db.getVoucherByToken(req.params.token);
  if (!voucher) return res.status(404).send('Not found');
  const url = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/redeem/${voucher.qr_token}`;
  res.setHeader('Content-Type', 'image/png');
  await QRCode.toFileStream(res, url, { width: 300, margin: 2, color: { dark: '#0f172a', light: '#ffffff' } });
});

// ─── QR Code PDF (printable) ──────────────────────────────────────────────────
router.get('/qr/:token/pdf', requireAdmin, async (req, res) => {
  const voucher = db.getVoucherByToken(req.params.token);
  if (!voucher) return res.status(404).send('Not found');

  const url = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/redeem/${voucher.qr_token}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1 });
  const base64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
  const imgBuffer = Buffer.from(base64, 'base64');

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="voucher-${voucher.code}.pdf"`);

  const doc = new PDFDocument({ size: 'A6', margin: 20 });
  doc.pipe(res);

  const venueName = process.env.VENUE_NAME || 'WiFi Access';
  const ssid = process.env.WIFI_SSID || 'Guest WiFi';

  // Header
  doc.fontSize(16).fillColor('#0f172a').font('Helvetica-Bold').text(venueName, { align: 'center' });
  doc.fontSize(10).fillColor('#64748b').font('Helvetica').text('WiFi Access Voucher', { align: 'center' });
  doc.moveDown(0.5);

  // QR Code
  doc.image(imgBuffer, { fit: [180, 180], align: 'center' });
  doc.moveDown(0.3);

  // Code
  doc.fontSize(22).fillColor('#0f172a').font('Helvetica-Bold').text(voucher.code, { align: 'center' });
  doc.moveDown(0.3);

  // Instructions
  doc.fontSize(9).fillColor('#475569').font('Helvetica');
  doc.text(`1. Connect to WiFi: "${ssid}"`, { align: 'center' });
  doc.text('2. Open your browser — a login page will appear', { align: 'center' });
  doc.text('3. Enter the code above or scan this QR code', { align: 'center' });
  doc.moveDown(0.3);

  // Details
  const dur = voucher.duration_minutes >= 1440 ? `${Math.round(voucher.duration_minutes / 1440)} day(s)` : `${voucher.duration_minutes} minutes`;
  doc.fontSize(8).fillColor('#94a3b8').text(`Valid for: ${dur}  ·  For: ${voucher.vendor_name}  ·  ${voucher.package_name}`, { align: 'center' });

  doc.end();
});

// ─── UniFi Status Check ───────────────────────────────────────────────────────
router.get('/api/unifi-status', requireAdmin, async (req, res) => {
  const result = await unifi.testConnection();
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════════
// HTML Renderers
// ═══════════════════════════════════════════════════════════════════════════════

function layout(title, content, opts = {}) {
  const { adminName = '', activePage = '' } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — ${process.env.VENUE_NAME || 'UniFi Access'}</title>
  <meta name="description" content="UniFi WiFi Access Control Admin Panel">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="admin-layout">
  <nav class="sidebar">
    <div class="sidebar-brand">
      <div class="brand-icon">⬡</div>
      <div>
        <div class="brand-name">${process.env.VENUE_NAME || 'UniFi Access'}</div>
        <div class="brand-sub">Admin Panel</div>
      </div>
    </div>
    <ul class="sidebar-nav">
      <li><a href="/admin" class="${activePage === 'dashboard' ? 'active' : ''}"><span class="nav-icon">◈</span>Dashboard</a></li>
      <li><a href="/admin/vendors" class="${activePage === 'vendors' ? 'active' : ''}"><span class="nav-icon">◉</span>Vendors</a></li>
    </ul>
    <div class="sidebar-footer">
      <div class="admin-badge">${adminName || 'Admin'}</div>
      <form action="/admin/logout" method="POST" style="margin:0">
        <button class="btn-logout" type="submit">Sign Out</button>
      </form>
    </div>
  </nav>
  <main class="admin-content">
    ${content}
  </main>
  <script src="/js/admin.js"></script>
</body>
</html>`;
}

function adminLoginPage({ error, venueName }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Admin Login — ${venueName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="center-page">
  <div class="login-card">
    <div class="login-brand">
      <div class="login-icon">⬡</div>
      <h1>${venueName}</h1>
      <p>WiFi Access Control</p>
    </div>
    ${error ? `<div class="alert alert-error">${error}</div>` : ''}
    <form action="/admin/login" method="POST" class="login-form">
      <div class="form-group">
        <label for="username">Username</label>
        <input id="username" type="text" name="username" placeholder="admin" required autocomplete="username">
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" type="password" name="password" placeholder="••••••••" required autocomplete="current-password">
      </div>
      <button type="submit" class="btn btn-primary btn-full">Sign In</button>
    </form>
  </div>
</body>
</html>`;
}

function statusBadge(status) {
  const map = { active: 'badge-success', used: 'badge-info', revoked: 'badge-danger', expired: 'badge-warning' };
  return `<span class="badge ${map[status] || ''}">${status}</span>`;
}

function formatDuration(minutes) {
  if (minutes >= 1440) return `${(minutes / 1440).toFixed(0)}d`;
  if (minutes >= 60) return `${(minutes / 60).toFixed(0)}h`;
  return `${minutes}m`;
}

function adminDashboard({ stats, recentVouchers, adminName }) {
  const voucherRows = recentVouchers.map(v => `
    <tr>
      <td><code class="code-pill">${v.code}</code></td>
      <td>${v.vendor_name}</td>
      <td>${v.package_name}</td>
      <td>${statusBadge(v.status)}</td>
      <td class="text-muted">${new Date(v.created_at).toLocaleDateString()}</td>
    </tr>
  `).join('');

  return layout('Dashboard', `
    <div class="page-header">
      <div>
        <h1 class="page-title">Dashboard</h1>
        <p class="page-subtitle">Overview of your WiFi access control system</p>
      </div>
      <div id="unifi-status" class="unifi-status" data-checking="true">
        <span class="status-dot"></span><span class="status-label">Checking UniFi…</span>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-icon stat-icon-green">◎</div>
        <div class="stat-value">${stats.active_vendors}</div>
        <div class="stat-label">Active Vendors</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-blue">◈</div>
        <div class="stat-value">${stats.active_vouchers}</div>
        <div class="stat-label">Active Vouchers</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-purple">◉</div>
        <div class="stat-value">${stats.used_vouchers}</div>
        <div class="stat-label">Used Vouchers</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon stat-icon-red">⊗</div>
        <div class="stat-value">${stats.revoked_vouchers}</div>
        <div class="stat-label">Revoked</div>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">Recent Vouchers</h2>
        <a href="/admin/vendors" class="btn btn-sm btn-secondary">Manage Vendors</a>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Code</th><th>Vendor</th><th>Package</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${voucherRows || '<tr><td colspan="5" class="text-muted text-center">No vouchers yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `, { adminName, activePage: 'dashboard' });
}

function vendorListPage({ vendors, adminName }) {
  const rows = vendors.map(v => `
    <tr class="${v.active ? '' : 'row-inactive'}">
      <td><a href="/admin/vendors/${v.id}" class="link-primary">${v.name}</a></td>
      <td class="text-muted">${v.email || '—'}</td>
      <td class="text-muted">${v.phone || '—'}</td>
      <td><span class="badge ${v.active ? 'badge-success' : 'badge-secondary'}">${v.active ? 'Active' : 'Inactive'}</span></td>
      <td><span class="badge badge-info">${v.active_vouchers} active</span></td>
      <td><a href="/admin/vendors/${v.id}" class="btn btn-sm btn-secondary">View</a></td>
    </tr>
  `).join('');

  return layout('Vendors', `
    <div class="page-header">
      <div>
        <h1 class="page-title">Vendors</h1>
        <p class="page-subtitle">Manage vendor accounts and issue access</p>
      </div>
      <button class="btn btn-primary" onclick="openModal('modal-create-vendor')">+ New Vendor</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Vouchers</th><th></th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" class="text-muted text-center">No vendors yet. Create one to get started.</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <!-- Create Vendor Modal -->
    <div id="modal-create-vendor" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <h3>New Vendor</h3>
          <button class="modal-close" onclick="closeModal('modal-create-vendor')">✕</button>
        </div>
        <form action="/admin/vendors" method="POST" class="modal-body">
          <div class="form-group">
            <label>Vendor Name *</label>
            <input type="text" name="name" placeholder="e.g. Java Junction" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Email</label>
              <input type="email" name="email" placeholder="vendor@example.com">
            </div>
            <div class="form-group">
              <label>Phone</label>
              <input type="tel" name="phone" placeholder="+44 7700 000000">
            </div>
          </div>
          <div class="form-group">
            <label>Portal PIN <span class="label-hint">(vendors use this to log in)</span></label>
            <input type="text" name="pin" placeholder="e.g. 4-8 digit PIN" maxlength="16">
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea name="notes" placeholder="Internal notes…" rows="2"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeModal('modal-create-vendor')">Cancel</button>
            <button type="submit" class="btn btn-primary">Create Vendor</button>
          </div>
        </form>
      </div>
    </div>
  `, { adminName, activePage: 'vendors' });
}

function vendorDetailPage({ vendor, vouchers, adminName }) {
  const voucherCards = vouchers.map(v => `
    <div class="voucher-card ${v.status !== 'active' ? 'voucher-inactive' : ''}">
      <div class="voucher-header">
        <div>
          <div class="voucher-name">${v.package_name}</div>
          <div class="voucher-meta">${formatDuration(v.duration_minutes)} · ${v.quota_mb ? v.quota_mb + 'MB' : 'Unlimited data'} · ${v.max_uses === 1 ? 'Single use' : `${v.max_uses} uses`}</div>
        </div>
        ${statusBadge(v.status)}
      </div>
      <div class="voucher-code-row">
        <code class="voucher-code">${v.code}</code>
        <div class="voucher-actions">
          ${v.status === 'active' ? `
            <a href="/admin/qr/${v.qr_token}" target="_blank" class="btn btn-sm btn-secondary">QR Image</a>
            <a href="/admin/qr/${v.qr_token}/pdf" class="btn btn-sm btn-secondary">PDF</a>
            <button class="btn btn-sm btn-danger" onclick="revokeVoucher(${v.id}, this)">Revoke</button>
          ` : `<span class="text-muted text-sm">${v.revoked_at ? 'Revoked ' + new Date(v.revoked_at).toLocaleDateString() : 'Inactive'}</span>`}
        </div>
      </div>
      <div class="voucher-qr-preview ${v.status === 'active' ? '' : 'hidden'}">
        <img src="/admin/qr/${v.qr_token}" alt="QR Code" class="qr-thumb" loading="lazy">
        <div class="qr-link-copy">
          <span class="text-muted text-sm">Redemption URL:</span>
          <input class="qr-url-input" value="${process.env.APP_BASE_URL || 'http://localhost:3000'}/redeem/${v.qr_token}" readonly onclick="this.select()">
        </div>
      </div>
    </div>
  `).join('');

  return layout(`Vendor — ${vendor.name}`, `
    <div class="page-header">
      <div>
        <a href="/admin/vendors" class="breadcrumb">← Vendors</a>
        <h1 class="page-title">${vendor.name}</h1>
        <p class="page-subtitle">${vendor.email || ''} ${vendor.phone ? '· ' + vendor.phone : ''}</p>
      </div>
      <div class="header-actions">
        <span class="badge ${vendor.active ? 'badge-success' : 'badge-secondary'} badge-lg">${vendor.active ? 'Active' : 'Inactive'}</span>
        <button class="btn btn-primary" onclick="openModal('modal-issue')">+ Issue Access</button>
      </div>
    </div>

    ${vendor.notes ? `<div class="alert alert-info"><strong>Notes:</strong> ${vendor.notes}</div>` : ''}

    <div class="section-header"><h2>Access Vouchers</h2></div>
    <div class="voucher-list">
      ${voucherCards || '<div class="empty-state"><p>No vouchers issued yet.<br>Click "Issue Access" to create one.</p></div>'}
    </div>

    <!-- Issue Access Modal -->
    <div id="modal-issue" class="modal-overlay" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <h3>Issue Access — ${vendor.name}</h3>
          <button class="modal-close" onclick="closeModal('modal-issue')">✕</button>
        </div>
        <form action="/admin/vendors/${vendor.id}/issue" method="POST" class="modal-body">
          <div class="form-group">
            <label>Package Name</label>
            <input type="text" name="name" placeholder="e.g. 1-Day Pass" value="1-Day Pass">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Duration</label>
              <select name="duration_minutes">
                <option value="60">1 Hour</option>
                <option value="240">4 Hours</option>
                <option value="480">8 Hours</option>
                <option value="1440" selected>1 Day</option>
                <option value="4320">3 Days</option>
                <option value="10080">1 Week</option>
                <option value="43200">30 Days</option>
              </select>
            </div>
            <div class="form-group">
              <label>Device Uses</label>
              <select name="max_uses">
                <option value="1">Single device</option>
                <option value="3">3 devices</option>
                <option value="5">5 devices</option>
                <option value="10">10 devices</option>
                <option value="0">Unlimited</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Data Cap <span class="label-hint">(MB, 0 = unlimited)</span></label>
            <input type="number" name="quota_mb" placeholder="0" value="0" min="0">
          </div>
          <div class="form-group">
            <label>Note <span class="label-hint">(shown in UniFi manager)</span></label>
            <input type="text" name="note" placeholder="Optional note">
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" onclick="closeModal('modal-issue')">Cancel</button>
            <button type="submit" class="btn btn-primary">Issue &amp; Generate QR</button>
          </div>
        </form>
      </div>
    </div>
  `, { adminName, activePage: 'vendors' });
}

module.exports = router;
