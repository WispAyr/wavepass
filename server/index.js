require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const SQLiteStore = require('connect-sqlite3')(session);

const db = require('./db');
const REDIRECT_URL = process.env.REDIRECT_URL || '/';
const adminRoutes = require('./routes/admin');
const vendorRoutes = require('./routes/vendor');
const redeemRoutes = require('./routes/redeem');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── View Engine ──────────────────────────────────────────────────────────────
app.set('view engine', 'html');
app.use(express.static(path.join(__dirname, '../public')));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Sessions ─────────────────────────────────────────────────────────────────
app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, '../data') }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// ─── Inject session data into all responses ───────────────────────────────────
app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.venueName = process.env.VENUE_NAME || 'UniFi Access';
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/admin', adminRoutes);
app.use('/vendor', vendorRoutes);
app.use('/redeem', redeemRoutes);

// Health check (used by Docker)
app.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Success page — shown after guest connects via captive portal
app.get('/success', (req, res) => {
  const venueName = process.env.VENUE_NAME || 'WiFi Access';
  const ssid = process.env.WIFI_SSID || 'Guest WiFi';
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Connected — ${venueName}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head><body class="redeem-body">
  <div class="redeem-card">
    <div class="redeem-header">
      <div class="redeem-logo">✓</div>
      <h1 class="redeem-title">You're online!</h1>
      <p class="redeem-subtitle">${venueName} · ${ssid}</p>
    </div>
    <div class="redeem-content" style="text-align:center;padding:2rem 1.5rem">
      <p style="color:var(--green);font-size:3rem;margin-bottom:1rem">🎉</p>
      <p style="color:var(--text2);font-size:0.95rem">Your device is now connected to the internet.</p>
      <p style="color:var(--text3);font-size:0.8rem;margin-top:1rem">You can close this page.</p>
    </div>
  </div>
</body></html>`);
});

// Root redirect
app.get('/', (req, res) => res.redirect('/admin'));

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send(`
    <!DOCTYPE html><html><head><title>Not Found</title>
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <link rel="stylesheet" href="/css/style.css"></head>
    <body class="center-page">
    <div class="error-card">
      <div class="error-icon">404</div>
      <h2>Page Not Found</h2>
      <p>The page you're looking for doesn't exist.</p>
      <a href="/" class="btn btn-primary">Go Home</a>
    </div></body></html>
  `);
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).send(`
    <!DOCTYPE html><html><head><title>Error</title>
    <link rel="stylesheet" href="/css/style.css"></head>
    <body class="center-page">
    <div class="error-card">
      <div class="error-icon">!</div>
      <h2>Something went wrong</h2>
      <p>${process.env.NODE_ENV === 'development' ? err.message : 'An internal error occurred.'}</p>
      <a href="/" class="btn btn-primary">Go Home</a>
    </div></body></html>
  `);
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🌐  UniFi QR Access Control running at http://localhost:${PORT}`);
  console.log(`🔑  Admin panel: http://localhost:${PORT}/admin\n`);
});

module.exports = app;
