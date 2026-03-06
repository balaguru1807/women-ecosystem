// backend/src/email.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || SMTP_USER;

// ✅ 465 => secure true, 587 => secure false
const SMTP_SECURE =
  process.env.SMTP_SECURE
    ? process.env.SMTP_SECURE === "true"
    : SMTP_PORT === 465;

// Create transporter (with stability options)
const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  auth: {
    user: SMTP_USER,
    pass: SMTP_PASS,
  },

  // ✅ stability improvements (prevents ECONNRESET in many cases)
  pool: true,
  maxConnections: 1,
  maxMessages: 50,

  connectionTimeout: 20000,
  greetingTimeout: 20000,
  socketTimeout: 30000,

  tls: {
    rejectUnauthorized: false,
  },
});

let verifiedOnce = false;

async function verifyTransportOnce() {
  if (verifiedOnce) return;
  await transporter.verify();
  verifiedOnce = true;
  console.log("✅ SMTP verified");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Retry only for network-like errors
async function sendWithRetry(sendFn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await sendFn();
    } catch (err) {
      lastErr = err;
      const code = err?.code || "";
      const msg = String(err?.message || "");

      const shouldRetry =
        code === "ECONNRESET" ||
        code === "ESOCKET" ||
        code === "ETIMEDOUT" ||
        msg.includes("ECONNRESET") ||
        msg.includes("ESOCKET") ||
        msg.includes("ETIMEDOUT");

      if (!shouldRetry) throw err;

      console.warn(`⚠️ Email send retry ${i + 1}/${retries} due to`, code || msg);
      await sleep(1000 * (i + 1));
    }
  }
  throw lastErr;
}

export async function sendSosEmail({ to, subject, text, html }) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    throw new Error("SMTP env missing: SMTP_HOST / SMTP_USER / SMTP_PASS");
  }

  await verifyTransportOnce();

  const mailOptions = {
    from: FROM_EMAIL,
    to,
    subject,
    text,
    html,
  };

  const info = await sendWithRetry(() => transporter.sendMail(mailOptions), 3);
  return info;
}