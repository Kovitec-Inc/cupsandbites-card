// Minimal SMTP client (implicit TLS, AUTH LOGIN) — no dependencies.
// Used to send share-back contacts through Titan (smtp.titan.email:465).
const tls = require("node:tls");
const net = require("node:net");

function sendMail({ host, port = 465, secure = true, user, pass, from, to, raw, timeoutMs = 15000 }) {
  return new Promise((resolve, reject) => {
    const socket = secure
      ? tls.connect({ host, port, servername: host })
      : net.connect({ host, port });
    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => { socket.destroy(); reject(new Error("smtp_timeout")); });

    let buffer = "";
    const queue = [];
    socket.on("data", (chunk) => {
      buffer += chunk;
      // A full reply ends with a line "NNN text\r\n" (space after the code, not '-').
      let m;
      while ((m = buffer.match(/^(?:\d{3}-[^\r\n]*\r\n)*(\d{3}) [^\r\n]*\r\n/))) {
        const reply = m[0];
        buffer = buffer.slice(reply.length);
        const waiter = queue.shift();
        if (waiter) waiter(parseInt(m[1], 10), reply);
      }
    });
    socket.on("error", reject);

    const expect = (codes) => new Promise((res, rej) => {
      queue.push((code, text) => (codes.includes(code) ? res(text) : rej(new Error(`smtp_${code}: ${text.trim().slice(0, 200)}`))));
    });
    const cmd = (line, codes) => { const p = expect(codes); socket.write(line + "\r\n"); return p; };

    (async () => {
      await expect([220]);
      await cmd("EHLO go.cupsandbites.com", [250]);
      await cmd("AUTH LOGIN", [334]);
      await cmd(Buffer.from(user).toString("base64"), [334]);
      await cmd(Buffer.from(pass).toString("base64"), [235]);
      await cmd(`MAIL FROM:<${from}>`, [250]);
      await cmd(`RCPT TO:<${to}>`, [250, 251]);
      await cmd("DATA", [354]);
      // Dot-stuffing per RFC 5321 §4.5.2
      const body = raw.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
      await cmd(body + "\r\n.", [250]);
      await cmd("QUIT", [221]).catch(() => {});
      socket.end();
      resolve(true);
    })().catch((err) => { socket.destroy(); reject(err); });
  });
}

module.exports = { sendMail };
