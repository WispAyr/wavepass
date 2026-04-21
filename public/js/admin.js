// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; document.body.style.overflow = ''; }
}
// Close modal on overlay click
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) closeModal(e.target.id);
});
// Close modal on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-overlay[style*="flex"]').forEach(m => closeModal(m.id));
});

// ─── URL param alerts ─────────────────────────────────────────────────────────
(function () {
  const p = new URLSearchParams(window.location.search);
  const msg = p.get('success') || p.get('error');
  if (!msg) return;
  const div = document.createElement('div');
  div.className = 'alert ' + (p.get('success') ? 'alert-info' : 'alert-error');
  div.textContent = decodeURIComponent(msg.replace(/\+/g, ' '));
  div.style.cssText = 'position:fixed;top:1rem;right:1rem;z-index:200;min-width:260px;max-width:400px;';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 4000);
  // Clean URL
  const url = new URL(window.location.href);
  url.searchParams.delete('success'); url.searchParams.delete('error');
  window.history.replaceState({}, '', url);
})();

// ─── Revoke voucher ───────────────────────────────────────────────────────────
async function revokeVoucher(id, btn) {
  if (!confirm('Revoke this voucher? The guest will lose access immediately.')) return;
  btn.disabled = true; btn.textContent = 'Revoking…';
  try {
    const res = await fetch(`/admin/vouchers/${id}/revoke`, { method: 'POST' });
    const data = await res.json();
    if (data.ok) { location.reload(); }
    else { alert('Error: ' + (data.error || 'Unknown')); btn.disabled = false; btn.textContent = 'Revoke'; }
  } catch (e) { alert('Request failed'); btn.disabled = false; btn.textContent = 'Revoke'; }
}

// ─── UniFi status check ───────────────────────────────────────────────────────
const statusEl = document.getElementById('unifi-status');
if (statusEl) {
  fetch('/admin/api/unifi-status')
    .then(r => r.json())
    .then(d => {
      statusEl.classList.add(d.ok ? 'online' : 'offline');
      statusEl.querySelector('.status-label').textContent = d.ok ? 'UniFi Connected' : 'UniFi Offline';
      statusEl.removeAttribute('data-checking');
    })
    .catch(() => {
      statusEl.classList.add('offline');
      statusEl.querySelector('.status-label').textContent = 'UniFi Offline';
    });
}
