# UniFi QR Access Control

Web-based WiFi access control system for vendors using QR codes, backed by a UniFi UDM Pro.

## Features
- **Admin Panel** — create vendors, issue access packages, view/revoke vouchers
- **Vendor Portal** — PIN login, view QR codes, share with customers
- **Guest Redemption** — mobile-friendly page with voucher code + connection instructions
- **UniFi Integration** — creates real hotspot vouchers on your UDM Pro via the local API
- **PDF Export** — printable QR code sheets for each voucher

## Prerequisites

1. A UniFi UDM Pro with **Hotspot/Guest Network** configured:
   - Go to **UniFi Network → Settings → WiFi** → create a Guest SSID
   - Enable **Hotspot** on the network, set auth method to **Voucher**
2. A **local admin account** on the UDM Pro (NOT your Ubiquiti cloud account — MFA breaks API access)
3. Node.js 18+

## Setup

```bash
# 1. Clone / copy this project
cd "ticketing system"

# 2. Install dependencies
npm install

# 3. Copy and configure environment
cp .env.example .env
# Edit .env with your UDM Pro IP, credentials, and preferences

# 4. Start the server
npm start
# Dev mode (auto-restart): npm run dev
```

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `SESSION_SECRET` | Random string for session signing |
| `ADMIN_USERNAME` | Initial admin username |
| `ADMIN_PASSWORD` | Initial admin password |
| `UNIFI_HOST` | UDM Pro local IP, e.g. `https://192.168.1.1` |
| `UNIFI_USERNAME` | Local UDM admin username |
| `UNIFI_PASSWORD` | Local UDM admin password |
| `UNIFI_SITE` | UniFi site ID (usually `default`) |
| `APP_BASE_URL` | Public URL of this server (used in QR codes) |
| `WIFI_SSID` | Your guest WiFi network name |
| `VENUE_NAME` | Display name shown in the UI |

## Usage

1. Navigate to `http://localhost:3000/admin` and log in
2. Create a **Vendor** (add a PIN if they need self-service portal access)
3. Open the vendor, click **Issue Access** — choose duration, device limit, data cap
4. The system creates a real voucher on your UDM Pro and generates a QR code
5. **Download the QR PNG or PDF** and give it to the vendor
6. Vendor shares QR with their customers — guests scan → get WiFi code → connect

## Network Requirements

This server must run on a machine with **direct LAN access to the UDM Pro**. It cannot reach the UDM Pro over the public internet. Options:
- A Raspberry Pi / NUC on the same LAN
- A VM or Docker container on the network
- Your laptop (for testing)

## Ports

| Path | Who uses it |
|---|---|
| `/admin` | Admin only |
| `/vendor` | Vendors (PIN login) |
| `/redeem/:token` | Public — guests scan QR here |
