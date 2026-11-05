// POST /api/connect — a visitor shares their contact back after saving Elvis's card.
// 1) Saves it via the submit_card_connection RPC (validated, rate-limited, insert-only).
// 2) Emails it to the founder's personal inbox with a .vcf attached, via Titan SMTP.
// Required Vercel env var: TITAN_SMTP_PASSWORD (password of the SMTP_USER mailbox).
const crypto = require("node:crypto");
const { sendMail } = require("./_smtp");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://zrrenemtbeirxsqwuagg.supabase.co";
// Public publishable key (legacy anon JWT keys are disabled on this project) — safe to ship; table access is limited to the RPC.
const SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_xJCt3xcuy8aMTE-KqH132A_LSY-31da";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.titan.email";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = process.env.SMTP_SECURE !== "false";
const SMTP_USER = process.env.SMTP_USER || "inquiries@cupsandbites.com";
const NOTIFY_TO = process.env.NOTIFY_TO || "k.elvix@cupsandbites.com";
const ALLOWED_ORIGINS = [/^https:\/\/go\.cupsandbites\.com$/, /^https:\/\/cupsandbites-card[a-z0-9-]*\.vercel\.app$/];

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
const oneLine = (v) => String(v || "").replace(/[\r\n]+/g, " ").trim();
const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`);
const vEsc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/([,;])/g, "\\$1");

function buildVCard(c) {
  const parts = c.name.split(/\s+/);
  const last = parts.length > 1 ? parts.pop() : "";
  const first = parts.join(" ");
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(last)};${vEsc(first)};;;`, `FN:${vEsc(c.name)}`];
  if (c.is_food_business && c.business_name) lines.push(`ORG:${vEsc(c.business_name)}`);
  if (c.what_they_do) lines.push(`TITLE:${vEsc(c.what_they_do)}`);
  if (c.phone) lines.push(`TEL;TYPE=CELL,VOICE:${vEsc(c.phone)}`);
  if (c.email) lines.push(`EMAIL;TYPE=INTERNET:${vEsc(c.email)}`);
  const met = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  lines.push(`NOTE:${vEsc(`Met via Cups & Bites card on ${met}.${c.is_food_business ? " Food business owner." : ""}${c.wants_updates ? " Opted in to Cups & Bites updates." : ""}`)}`);
  lines.push("END:VCARD");
  return lines.join("\r\n") + "\r\n";
}

function buildEmail(c) {
  const boundary = "cb-" + crypto.randomBytes(12).toString("hex");
  const when = new Date().toLocaleString("en-CA", { timeZone: "America/Toronto", dateStyle: "medium", timeStyle: "short" });
  const subject = `New contact: ${c.name}${c.is_food_business ? " (food business)" : ""}`;
  const text = [
    `${c.name} shared their details from your business card.`,
    "",
    `Name: ${c.name}`,
    c.phone ? `Phone: ${c.phone}` : null,
    c.email ? `Email: ${c.email}` : null,
    c.what_they_do ? `What they do: ${c.what_they_do}` : null,
    `Food business owner: ${c.is_food_business ? "Yes" : "No"}`,
    c.is_food_business && c.business_name ? `Business: ${c.business_name}` : null,
    `Wants Cups & Bites updates: ${c.wants_updates ? "Yes (opted in)" : "No"}`,
    `How they reached the form: ${c.entry === "connect-button" ? "\"Other industry? Let's connect\" button" : "After saving your contact"}`,
    `Scanned via: ${c.src || "direct"}`,
    `When: ${when}`,
    "",
    "Tap the attached contact card to save them to your phone.",
  ].filter((l) => l !== null).join("\r\n");
  const fileName = (c.name.replace(/[^A-Za-z0-9 ._-]+/g, "").trim() || "contact").replace(/\s+/g, "-") + ".vcf";
  const headers = [
    `From: ${mimeWord("Cups & Bites Card")} <${SMTP_USER}>`,
    `To: <${NOTIFY_TO}>`,
    c.email ? `Reply-To: ${mimeWord(oneLine(c.name))} <${oneLine(c.email)}>` : null,
    `Subject: ${mimeWord(oneLine(subject))}`,
    `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${crypto.randomUUID()}@go.cupsandbites.com>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].filter(Boolean);
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trimEnd();
  return [
    ...headers, "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64", "",
    b64(text),
    `--${boundary}`,
    `Content-Type: text/vcard; charset=utf-8; name="${fileName}"`,
    `Content-Disposition: attachment; filename="${fileName}"`,
    "Content-Transfer-Encoding: base64", "",
    b64(buildVCard(c)),
    `--${boundary}--`, "",
  ].join("\r\n");
}

async function handler(req, res) {
  const origin = req.headers.origin || "";
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }
  if (origin && !ALLOWED_ORIGINS.some((re) => re.test(origin))) return res.status(403).json({ ok: false });

  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch { b = {}; } }
  b = b || {};

  // Bots: honeypot filled, or form submitted implausibly fast → pretend success, store nothing.
  if (clean(b.website, 200) || Number(b.elapsed_ms) < 800) return res.status(200).json({ ok: true });

  const c = {
    name: clean(b.name, 100),
    phone: clean(b.phone, 40),
    email: clean(b.email, 254).toLowerCase(),
    what_they_do: clean(b.what_they_do, 200),
    is_food_business: b.is_food_business === true,
    business_name: clean(b.business_name, 150),
    wants_updates: b.wants_updates === true,
    src: clean(b.src, 20).toLowerCase().replace(/[^a-z0-9_-]/g, ""),
    entry: b.entry === "connect-button" ? "connect-button" : "after-save",
  };
  if (!c.name) return res.status(400).json({ ok: false, error: "name_required" });
  if (!c.phone && !c.email) return res.status(400).json({ ok: false, error: "contact_required" });

  const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_card_connection`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_name: c.name, p_phone: c.phone || null, p_email: c.email || null, p_what_they_do: c.what_they_do || null,
      p_is_food_business: c.is_food_business, p_business_name: c.business_name || null, p_wants_updates: c.wants_updates,
      p_src: c.src || null, p_entry: c.entry, p_session_id: clean(b.session_id, 64) || null, p_user_agent: clean(req.headers["user-agent"], 300) || null,
    }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));

  if (!rpc.ok) {
    const detail = await rpc.text();
    const code = /rate_limited/.test(detail) ? "rate_limited"
      : /invalid_email/.test(detail) ? "invalid_email"
      : /invalid_phone/.test(detail) ? "invalid_phone"
      : /contact_required/.test(detail) ? "contact_required"
      : /invalid_name/.test(detail) ? "name_required" : "save_failed";
    console.error("[connect] rpc failed", rpc.status, detail.slice(0, 300));
    return res.status(code === "save_failed" ? 502 : code === "rate_limited" ? 429 : 400).json({ ok: false, error: code });
  }

  // Saved. Email is best-effort: a mail failure never loses the contact.
  let emailed = false;
  if (process.env.TITAN_SMTP_PASSWORD) {
    try {
      await sendMail({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_SECURE, user: SMTP_USER, pass: process.env.TITAN_SMTP_PASSWORD,
        from: SMTP_USER, to: NOTIFY_TO, raw: buildEmail(c) });
      emailed = true;
    } catch (e) {
      console.error("[connect] email failed", String(e && e.message || e).slice(0, 300));
    }
  } else {
    console.error("[connect] TITAN_SMTP_PASSWORD not set; contact saved but not emailed");
  }
  return res.status(200).json({ ok: true, emailed });
}

module.exports = handler;
module.exports.buildEmail = buildEmail;
module.exports.buildVCard = buildVCard;
