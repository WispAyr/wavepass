# WavePass

Web-based WiFi access control system for vendors using QR codes, backed by a UniFi UDM Pro.

## Features
- **Admin Panel** — create vendors, issue access packages, view/revoke vouchers
- **Vendor Portal** — PIN login, view QR codes, share with customers
- **Guest Redemption** — mobile-friendly page with voucher code + step-by-step instructions
- **UniFi Integration** — creates real hotspot vouchers on your UDM Pro
- **PDF Export** — printable QR code sheets per voucher

---

## Network Connectivity

WavePass needs to reach the UDM Pro's management API. Since the UDM Pro is LAN-local, you have two options:

### Option A — WireGuard Tunnel ✅ Recommended

This is the cleanest approach for a cloud-hosted WavePass deployment. The UDM Pro and the WavePass VPS become WireGuard peers, giving the server direct access to the UDM Pro's local API over an encrypted private tunnel.

#### 1. Enable WireGuard on the UDM Pro
UniFi OS supports WireGuard natively:
- In **UniFi Network → VPN → WireGuard**, create a new WireGuard VPN server
- Note the UDM Pro's WireGuard IP (e.g. `10.10.0.1`)
- Generate a peer config for the WavePass VPS

#### 2. Configure the WavePass VPS as a WireGuard peer
Install WireGuard on your VPS (Debian/Ubuntu):
```bash
sudo apt install wireguard
```

Create `/etc/wireguard/wg0.conf` using the peer config from UniFi:
```ini
[Interface]
PrivateKey = <vps-private-key>
Address = 10.10.0.2/24

[Peer]
PublicKey = <udm-pro-public-key>
Endpoint = <your-home-or-office-public-ip>:51820
AllowedIPs = 10.10.0.0/24
PersistentKeepalive = 25
```

Start and enable the tunnel:
```bash
sudo wg-quick up wg0
sudo systemctl enable wg-quick@wg0
```

#### 3. Configure WavePass `.env`
```env
UNIFI_HOST=https://10.10.0.1   # UDM Pro's WireGuard IP
UNIFI_USERNAME=api-admin
UNIFI_PASSWORD=your-password
UNIFI_SITE=default
```

That's it — WavePass talks directly to the UDM Pro over the tunnel.

---

### Option B — Bridge Agent (no WireGuard)

Run the included `bridge/agent.js` on any machine on the same LAN as the UDM Pro.

```bash
# On the LAN machine (Pi, NUC, etc.)
node bridge/agent.js
```

Then in WavePass `.env`:
```env
UNIFI_MODE=bridge
BRIDGE_URL=http://your-bridge-host:4000
BRIDGE_SECRET=a-long-random-shared-secret
```

---

## Prerequisites (both options)

1. UniFi UDM Pro with a **Hotspot/Guest Network** configured:
   - **UniFi Network → Settings → WiFi** → create a Guest SSID
   - Enable **Hotspot**, set auth method to **Voucher**
2. A **local admin account** on the UDM Pro — do NOT use your Ubiquiti cloud account (MFA breaks API access)
3. Node.js 18+

---

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — set UNIFI_HOST to WireGuard peer IP, fill credentials
npm start
# Dev: npm run dev
```

## Routes

| Path | Audience |
|---|---|
| `/admin` | Admin only |
| `/vendor` | Vendors (PIN login) |
| `/redeem/:token` | Public — guests scan QR here |

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SESSION_SECRET` | Random string for session signing |
| `ADMIN_USERNAME` | Initial admin username |
| `ADMIN_PASSWORD` | Initial admin password |
| `UNIFI_MODE` | `direct` (default, WireGuard or LAN) or `bridge` |
| `UNIFI_HOST` | UDM Pro IP — WireGuard peer IP for remote deployments |
| `UNIFI_USERNAME` | Local UDM admin username |
| `UNIFI_PASSWORD` | Local UDM admin password |
| `UNIFI_SITE` | UniFi site ID (usually `default`) |
| `BRIDGE_URL` | Bridge agent URL (bridge mode only) |
| `BRIDGE_SECRET` | Shared secret for bridge auth (bridge mode only) |
| `APP_BASE_URL` | Public URL of WavePass (used in QR codes) |
| `WIFI_SSID` | Guest WiFi network name shown to guests |
| `VENUE_NAME` | Display name in the UI |
