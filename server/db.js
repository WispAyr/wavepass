const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');

// Ensure data directory exists — use DATA_DIR env var for Docker deployments
const dataDir = process.env.DATA_DIR || path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'access.db'));

const storeDb = new Database(path.join(dataDir, 'sessions.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT UNIQUE NOT NULL,
    password    TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vendors (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    email       TEXT,
    phone       TEXT,
    notes       TEXT,
    pin         TEXT,
    active      INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS access_packages (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id        INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 1440,
    quota_mb         INTEGER NOT NULL DEFAULT 0,
    max_uses         INTEGER NOT NULL DEFAULT 1,
    note             TEXT,
    created_at       TEXT DEFAULT (datetime('now')),
    expires_at       TEXT
  );

  CREATE TABLE IF NOT EXISTS vouchers (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id       INTEGER NOT NULL REFERENCES access_packages(id) ON DELETE CASCADE,
    vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
    unifi_voucher_id TEXT,
    code             TEXT NOT NULL,
    qr_token         TEXT UNIQUE NOT NULL,
    status           TEXT DEFAULT 'active',
    created_at       TEXT DEFAULT (datetime('now')),
    used_at          TEXT,
    revoked_at       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_vouchers_qr_token ON vouchers(qr_token);
  CREATE INDEX IF NOT EXISTS idx_vouchers_vendor ON vouchers(vendor_id);
`);

// ─── Seed admin account ───────────────────────────────────────────────────────
const adminExists = db.prepare('SELECT id FROM admins WHERE username = ?').get(
  process.env.ADMIN_USERNAME || 'admin'
);

if (!adminExists) {
  const hashed = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'changeme123', 10);
  db.prepare('INSERT INTO admins (username, password) VALUES (?, ?)').run(
    process.env.ADMIN_USERNAME || 'admin',
    hashed
  );
  console.log(`[DB] Admin account created: ${process.env.ADMIN_USERNAME || 'admin'}`);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const helpers = {
  // Vendors
  getVendors: () => db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM vouchers WHERE vendor_id = v.id AND status = 'active') as active_vouchers,
      (SELECT COUNT(*) FROM vouchers WHERE vendor_id = v.id) as total_vouchers
    FROM vendors v ORDER BY v.created_at DESC
  `).all(),

  getVendor: (id) => db.prepare(`
    SELECT v.*,
      (SELECT COUNT(*) FROM vouchers WHERE vendor_id = v.id AND status = 'active') as active_vouchers,
      (SELECT COUNT(*) FROM vouchers WHERE vendor_id = v.id) as total_vouchers
    FROM vendors v WHERE v.id = ?
  `).get(id),

  getVendorByPin: (pin) => db.prepare('SELECT * FROM vendors WHERE pin = ? AND active = 1').get(pin),

  createVendor: (name, email, phone, notes, pin) => {
    const hashedPin = pin ? bcrypt.hashSync(pin, 10) : null;
    return db.prepare(
      'INSERT INTO vendors (name, email, phone, notes, pin) VALUES (?, ?, ?, ?, ?)'
    ).run(name, email || null, phone || null, notes || null, hashedPin);
  },

  updateVendor: (id, name, email, phone, notes) =>
    db.prepare('UPDATE vendors SET name=?, email=?, phone=?, notes=? WHERE id=?')
      .run(name, email || null, phone || null, notes || null, id),

  toggleVendorActive: (id) =>
    db.prepare('UPDATE vendors SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?').run(id),

  // Vouchers
  getVouchersByVendor: (vendorId) => db.prepare(`
    SELECT v.*, p.name as package_name, p.duration_minutes, p.quota_mb, p.max_uses
    FROM vouchers v
    JOIN access_packages p ON v.package_id = p.id
    WHERE v.vendor_id = ?
    ORDER BY v.created_at DESC
  `).all(vendorId),

  getVoucherByToken: (token) => db.prepare(`
    SELECT v.*, p.name as package_name, p.duration_minutes, p.quota_mb, p.max_uses,
           vnd.name as vendor_name
    FROM vouchers v
    JOIN access_packages p ON v.package_id = p.id
    JOIN vendors vnd ON v.vendor_id = vnd.id
    WHERE v.qr_token = ?
  `).get(token),

  getVoucherById: (id) => db.prepare(`
    SELECT v.*, p.name as package_name, vnd.name as vendor_name
    FROM vouchers v
    JOIN access_packages p ON v.package_id = p.id
    JOIN vendors vnd ON v.vendor_id = vnd.id
    WHERE v.id = ?
  `).get(id),

  createVoucher: (packageId, vendorId, unifiId, code, qrToken) =>
    db.prepare(
      'INSERT INTO vouchers (package_id, vendor_id, unifi_voucher_id, code, qr_token) VALUES (?, ?, ?, ?, ?)'
    ).run(packageId, vendorId, unifiId || null, code, qrToken),

  revokeVoucher: (id) =>
    db.prepare("UPDATE vouchers SET status='revoked', revoked_at=datetime('now') WHERE id=?").run(id),

  // Packages
  getPackagesByVendor: (vendorId) =>
    db.prepare('SELECT * FROM access_packages WHERE vendor_id = ? ORDER BY created_at DESC').all(vendorId),

  createPackage: (vendorId, name, durationMinutes, quotaMb, maxUses, note) =>
    db.prepare(
      'INSERT INTO access_packages (vendor_id, name, duration_minutes, quota_mb, max_uses, note) VALUES (?,?,?,?,?,?)'
    ).run(vendorId, name, durationMinutes, quotaMb, maxUses, note || null),

  // Admin
  getAdmin: (username) => db.prepare('SELECT * FROM admins WHERE username = ?').get(username),

  // Dashboard stats
  getStats: () => db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM vendors WHERE active=1) as active_vendors,
      (SELECT COUNT(*) FROM vendors) as total_vendors,
      (SELECT COUNT(*) FROM vouchers WHERE status='active') as active_vouchers,
      (SELECT COUNT(*) FROM vouchers WHERE status='revoked') as revoked_vouchers,
      (SELECT COUNT(*) FROM vouchers WHERE status='used') as used_vouchers,
      (SELECT COUNT(*) FROM vouchers) as total_vouchers
  `).get(),

  getRecentVouchers: (limit = 10) => db.prepare(`
    SELECT v.*, p.name as package_name, vnd.name as vendor_name
    FROM vouchers v
    JOIN access_packages p ON v.package_id = p.id
    JOIN vendors vnd ON v.vendor_id = vnd.id
    ORDER BY v.created_at DESC LIMIT ?
  `).all(limit),
};

module.exports = { db, ...helpers };
