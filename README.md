# Gaid WiFi Billing system 

Build me a WiFi Billing System for Kenyan WISP like AMAZONS, called BRADY WIFI.



My setup:

- I have Safaricom fibre router (source of internet)

- I have Outdoor Access Point TP-Link CPE210 / Tenda O3 mounted outside (AP mode)

- Customers connect to WiFi name "BRADY WIFI" open (no password)

- When they connect, they should see captive portal popup: "Sign in to BRADY WIFI"



I need 3 pages:



1. CAPTIVE PORTAL (customer page) - must be mobile first:

- Big title: BRADY WIFI - FAST & AFFORDABLE

- Show 4 packages: 1 Hour @20 KES, 6 Hours @50 KES, 24 Hours @100 KES, 7 Days @500 KES

- Customer enters phone number (Safaricom) and clicks LIPA NA MPESA

- Button triggers M-Pesa STK Push to their phone

- Show "Enter M-Pesa PIN on your phone" loading

- After payment, automatically allow internet and show "You are online! Time left: 23:59:00"

- Also have option: "I have voucher" -> enter code



2. ADMIN DASHBOARD - /admin

- Login: admin / admin123

- Show total active users now, today collection (KES), total users today

- Table: Phone | MAC Address | Package | Time Left | Status | Action (Disconnect)

- Allow manually adding user by MAC

- Generate voucher codes (e.g., 100 codes for 1 hour)

- See all M-Pesa transactions with status

- Block / unblock MAC



3. BACKEND LOGIC:

- Use MAC address to control access (simulate MikroTik API)

- When user pays, add their MAC to "allowed list" with expiry time

- Cron job that checks every minute and disconnects expired users

- M-Pesa Integration: Use Safaricom Daraja API Sandbox (Lipa Na M-Pesa Online)

- For now mock STK push if no keys, but write code ready for real Till - I will put my Consumer Key, Consumer Secret, Shortcode, Passkey in .env

- Use Supabase for database: tables: users (phone, mac, package, expiry, status), transactions (phone, amount, mpesa_code, status), vouchers (code, package, used)

- Make it work without domain for testing: allow testing via phone MAC manually

- Design like AMAZONS portal - orange/black theme, fast loading, no heavy images



Extra:

- Landing page must work as captive portal - auto popup on Android/iOS

- Add instructions: "Safaricom router LAN -> to CPE210 PoE -> broadcasts BRADY WIFI"

- Deploy ready on Vercel, no domain needed for test.



Tech: Next.js + Tailwind + Supabase. Make it simple, works on phone.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://gaid-mpesa-wifi-voucher-hub.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/0737531c-cfd9-492a-8e4a-9a87e50b04c2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
