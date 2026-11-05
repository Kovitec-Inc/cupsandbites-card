# Cups & Bites — business card landing page

The page behind the NFC chip and QR code on Elvis V. Koko's Cups & Bites business card.
Static HTML, no build step, deployed on Vercel.

## URLs to write on the card

- NFC chip: `https://go.cupsandbites.com/?src=nfc`
- QR code: `https://go.cupsandbites.com/?src=qr`

The page passes `src` through as `utm_medium` on both buttons, and tags each button with
`utm_content=diner` or `utm_content=owner`, so analytics can tell chip taps from QR scans
and diners from food-business owners.

## Brand card (no personal contact)

- NFC / QR: `https://go.cupsandbites.com/tap?src=nfc` (or `?src=qr`)
- Same page with the founder name and Save contact hidden; buttons tagged `utm_campaign=tap-card`.

## Share-back ("Let's stay in touch")

On the founder card only (not `/tap`): after a visitor taps **Save contact**, a short form invites
them to share their details back. A third button, **"Not in food? Let's connect"**, opens the same
form at any time for people outside food and hospitality (stored as `entry = 'connect-button'`). `POST /api/connect` (Vercel function):

1. Saves the contact via the `submit_card_connection` RPC into `public.card_connections`
   (Cups & Bites Supabase). Insert-only, validated, max 5 per visitor per hour; nobody can read
   the table from the browser.
2. Emails it to `k.elvix@cupsandbites.com` (sent through `inquiries@cupsandbites.com` via Titan
   SMTP) with a `.vcf` attached. Reply-To is the visitor's email.

Vercel environment variable required for the email: `TITAN_SMTP_PASSWORD` (the password of
`inquiries@cupsandbites.com`). Without it, contacts are still saved but not emailed.
Optional overrides: `NOTIFY_TO`, `SMTP_USER`, `SMTP_HOST`, `SMTP_PORT`.

## Files

- `index.html` — the page (two CTAs + save contact)
- `elvis-koko.vcf` — contact card (Cups & Bites line, (289) 402-5871)
- `vercel.json` — vCard headers, noindex
- `api/connect.js`, `api/_smtp.js` — share-back endpoint and dependency-free SMTP sender

## Domain

Add `go.cupsandbites.com` in the Vercel project's Domains settings, then create a
CNAME record in Cloudflare: `go` → `cname.vercel-dns.com` (DNS only, grey cloud).
