# Cups & Bites — business card landing page

The page behind the NFC chip and QR code on Elvis V. Koko's Cups & Bites business card.
Static HTML, no build step, deployed on Vercel.

## URLs to write on the card

- NFC chip: `https://go.cupsandbites.com/?src=nfc`
- QR code: `https://go.cupsandbites.com/?src=qr`

The page passes `src` through as `utm_medium` on both buttons, and tags each button with
`utm_content=diner` or `utm_content=owner`, so analytics can tell chip taps from QR scans
and diners from food-business owners.

## Files

- `index.html` — the page (two CTAs + save contact)
- `elvis-koko.vcf` — contact card (Cups & Bites line, (289) 402-5871)
- `vercel.json` — vCard headers, noindex

## Domain

Add `go.cupsandbites.com` in the Vercel project's Domains settings, then create a
CNAME record in Cloudflare: `go` → `cname.vercel-dns.com` (DNS only, grey cloud).
