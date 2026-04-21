const router = require('express').Router();
const db = require('../db');

router.get('/:token', (req, res) => {
  const voucher = db.getVoucherByToken(req.params.token);
  const venueName = process.env.VENUE_NAME || 'WiFi Access';
  const ssid = process.env.WIFI_SSID || 'Guest WiFi';

  if (!voucher) {
    return res.status(404).send(redeemPage({ voucher: null, venueName, ssid, error: 'This QR code is not valid or has expired.' }));
  }

  res.send(redeemPage({ voucher, venueName, ssid }));
});

function formatDuration(minutes) {
  if (minutes >= 10080) return `${Math.round(minutes / 10080)} week(s)`;
  if (minutes >= 1440) return `${Math.round(minutes / 1440)} day(s)`;
  if (minutes >= 60) return `${Math.round(minutes / 60)} hour(s)`;
  return `${minutes} minute(s)`;
}

function redeemPage({ voucher, venueName, ssid, error }) {
  const statusColor = {
    active: '#10b981',
    used: '#f59e0b',
    revoked: '#ef4444',
    expired: '#6b7280',
  };

  const content = error || !voucher ? `
    <div class="redeem-error">
      <div class="redeem-error-icon">⚠</div>
      <h2>Code Not Found</h2>
      <p>${error || 'This QR code is invalid.'}</p>
    </div>
  ` : `
    <div class="redeem-status" style="--status-color:${statusColor[voucher.status] || '#6b7280'}">
      <div class="status-pill">${voucher.status.toUpperCase()}</div>
    </div>

    <div class="redeem-code-block">
      <p class="redeem-code-label">Your WiFi Access Code</p>
      <div class="redeem-code" id="wifi-code" onclick="copyCode()">${voucher.code}</div>
      <button class="copy-btn" onclick="copyCode()" id="copy-btn">Tap to copy</button>
    </div>

    <div class="redeem-steps">
      <h3>How to connect</h3>
      <ol class="steps-list">
        <li>
          <div class="step-num">1</div>
          <div class="step-text">Connect to WiFi network:<br><strong>"${ssid}"</strong></div>
        </li>
        <li>
          <div class="step-num">2</div>
          <div class="step-text">Open your browser — a login page will appear automatically<br><span class="step-hint">(If it doesn't, visit <code>http://neverssl.com</code>)</span></div>
        </li>
        <li>
          <div class="step-num">3</div>
          <div class="step-text">Enter the code above when prompted</div>
        </li>
      </ol>
    </div>

    <div class="redeem-details">
      <div class="detail-chip">⏱ ${formatDuration(voucher.duration_minutes)} access</div>
      ${voucher.quota_mb > 0 ? `<div class="detail-chip">📊 ${voucher.quota_mb}MB data cap</div>` : '<div class="detail-chip">∞ Unlimited data</div>'}
      ${voucher.max_uses === 1 ? '<div class="detail-chip">📱 Single device</div>' : `<div class="detail-chip">📱 Up to ${voucher.max_uses} devices</div>`}
    </div>

    ${voucher.status !== 'active' ? `
      <div class="redeem-warning">
        This voucher is <strong>${voucher.status}</strong> and may no longer work.
        Please contact the vendor or organiser.
      </div>
    ` : ''}

    <p class="redeem-vendor">Provided by <strong>${voucher.vendor_name}</strong> via ${venueName}</p>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>WiFi Access — ${venueName}</title>
  <meta name="description" content="Your WiFi access code for ${venueName}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/css/style.css">
</head>
<body class="redeem-body">
  <div class="redeem-card">
    <div class="redeem-header">
      <div class="redeem-logo">⬡</div>
      <h1 class="redeem-title">${venueName}</h1>
      <p class="redeem-subtitle">WiFi Access</p>
    </div>
    <div class="redeem-content">
      ${content}
    </div>
  </div>
  <script>
    function copyCode() {
      const code = document.getElementById('wifi-code').textContent.trim();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(code).then(() => {
          const btn = document.getElementById('copy-btn');
          btn.textContent = '✓ Copied!';
          btn.classList.add('copy-success');
          setTimeout(() => { btn.textContent = 'Tap to copy'; btn.classList.remove('copy-success'); }, 2000);
        });
      }
    }
  </script>
</body>
</html>`;
}

module.exports = router;
