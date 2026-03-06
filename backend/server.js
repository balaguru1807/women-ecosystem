// backend/server.js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import twilio from "twilio";

import { db, FieldValue } from "./src/firebaseAdmin.js";
import { verifyFirebaseToken } from "./src/middleware.js";
import { sendSosEmail } from "./src/email.js";

dotenv.config();

const app = express();

app.use(cors()); // tighten for prod
app.use(express.json());

// ---------- Twilio helpers (SMS + optional voice calls) ----------

const hasTwilio =
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  (process.env.TWILIO_FROM_SMS || process.env.TWILIO_FROM_VOICE);

const twilioClient = hasTwilio
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

async function sendSms(to, body) {
  if (!twilioClient || !process.env.TWILIO_FROM_SMS) return;
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_FROM_SMS,
      to,
      body,
    });
  } catch (err) {
    console.error("SMS error:", err.message || err);
  }
}

async function placeVoiceCall(to, text) {
  if (!twilioClient || !process.env.TWILIO_FROM_VOICE) return;
  try {
    await twilioClient.calls.create({
      from: process.env.TWILIO_FROM_VOICE,
      to,
      twiml: `<Response><Say>${text}</Say></Response>`,
    });
  } catch (err) {
    console.error("Voice call error:", err.message || err);
  }
}

// ---------- Health check ----------

app.get("/", (req, res) => {
  res.send("SCSE backend running");
});

// ---------- Risk-score helper ----------

function computeRiskScore({
  hour,
  sosCountLast30Days = 0,
  isUnsafeZone = false,
}) {
  let score = 0;

  // Night hours 10pm–5am
  if (hour >= 22 || hour <= 5) score += 3;

  // Recent SOS alerts
  if (sosCountLast30Days >= 3) score += 3;
  else if (sosCountLast30Days >= 1) score += 1;

  // Unsafe zone (placeholder for heatmap later)
  if (isUnsafeZone) score += 4;

  let level = "NORMAL";
  if (score >= 7) level = "ALERT";
  else if (score >= 4) level = "CAUTION";

  return { score, level };
}

// ---------- /api/track : continuous tracking ----------

app.post("/api/track", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { location } = req.body || {};

    if (
      !location ||
      typeof location.lat !== "number" ||
      typeof location.lng !== "number"
    ) {
      return res.status(400).json({ error: "Invalid location" });
    }

    const { lat, lng } = location;
    const userDocRef = db.collection("users").doc(uid);

    // count SOS in last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sosSnap = await db
      .collection("sos_alerts")
      .where("userId", "==", uid)
      .get();

    let sosCount = 0;
    sosSnap.forEach((docSnap) => {
      const data = docSnap.data();
      const t = data.time;
      const ts = t?.toDate?.() || t;
      if (ts && ts >= thirtyDaysAgo) sosCount += 1;
    });

    const now = new Date();
    const hour = now.getHours();
    const isUnsafeZone = false; // plug in heatmap later

    const { score, level } = computeRiskScore({
      hour,
      sosCountLast30Days: sosCount,
      isUnsafeZone,
    });

    // live_tracking
    await db
      .collection("live_tracking")
      .doc(uid)
      .set(
        {
          lat,
          lng,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    // tracking.locations
    await db
      .collection("tracking")
      .doc(uid)
      .set(
        {
          locations: FieldValue.arrayUnion({
            lat,
            lng,
            timestamp: now,
          }),
        },
        { merge: true }
      );

    // user doc
    await userDocRef.set(
      {
        currentLocation: { lat, lng },
        lastUpdated: FieldValue.serverTimestamp(),
        riskScore: score,
        riskLevel: level,
      },
      { merge: true }
    );

    return res.json({ ok: true, riskScore: score, riskLevel: level });
  } catch (err) {
    console.error("track error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- /api/sos : main SOS endpoint ----------

/**
 * Body: { location?: {lat,lng}, note?: string, audioUrl?: string }
 */
app.post("/api/sos", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const userEmail = req.user.email || "";
    const { location, note, audioUrl } = req.body || {};

    // 1) Load user profile
    const userDocRef = db.collection("users").doc(uid);
    const userSnap = await userDocRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User profile not found" });
    }

    const userData = userSnap.data() || {};
    const userName = userData.name || userEmail || uid;

    const guardianEmail = userData.guardianEmail || "";
    const extraEmails = Array.isArray(userData.extraContacts)
      ? userData.extraContacts
      : [];

    const guardianPhone = userData.guardianPhone || "";
    const extraPhones = Array.isArray(userData.extraPhones)
      ? userData.extraPhones
      : [];

    if (!guardianEmail) {
      return res
        .status(400)
        .json({ error: "Guardian email not set for this user" });
    }

    const now = new Date();
    const nowString = now.toLocaleString();

    // 2) Create SOS alert documents
    const mapLink =
      location &&
      typeof location.lat === "number" &&
      typeof location.lng === "number"
        ? `https://www.google.com/maps?q=${location.lat},${location.lng}`
        : "Location not available";

    const sosData = {
      userId: uid,
      userEmail,
      userName,
      guardianEmail,
      extraContacts: extraEmails,
      guardianPhone,
      extraPhones,
      location: location || null,
      note: note || "",
      audioUrl: audioUrl || "",
      status: "open",
      time: FieldValue.serverTimestamp(),
    };

    const sosRef = await db.collection("sos_alerts").add(sosData);

    // Mesh broadcast for nearby helpers
    await db.collection("mesh_sos").doc(sosRef.id).set({
      ...sosData,
    });

    // 3) Update tracking/risk
    if (
      location &&
      typeof location.lat === "number" &&
      typeof location.lng === "number"
    ) {
      const { lat, lng } = location;

      await db
        .collection("live_tracking")
        .doc(uid)
        .set(
          {
            lat,
            lng,
            lastUpdated: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );

      await db
        .collection("tracking")
        .doc(uid)
        .set(
          {
            locations: FieldValue.arrayUnion({
              lat,
              lng,
              timestamp: now,
            }),
          },
          { merge: true }
        );

      await userDocRef.set(
        {
          currentLocation: { lat, lng },
          lastUpdated: FieldValue.serverTimestamp(),
          riskLevel: "ALERT",
          riskScore: 10,
        },
        { merge: true }
      );
    } else {
      await userDocRef.set(
        {
          lastUpdated: FieldValue.serverTimestamp(),
          riskLevel: "ALERT",
          riskScore: 10,
        },
        { merge: true }
      );
    }

    // 4) Prepare email
    const subject = "🚨 SOS Alert from Smart Campus Safety";

    const textLines = [
      `SOS alert raised by ${userName} (${userEmail || "no email"}).`,
      "",
      `Time: ${nowString}`,
      `Location: ${mapLink}`,
      `Note from student: ${note || "No additional note provided."}`,
    ];

    if (audioUrl) {
      textLines.push(`Audio evidence: ${audioUrl}`);
    }

    textLines.push("", "Please check on them immediately.");

    const text = textLines.join("\n");

    const htmlLines = [
      "<h2>🚨 SOS Alert</h2>",
      `<p><strong>User:</strong> ${userName} (${userEmail || "no email"})</p>`,
      `<p><strong>Time:</strong> ${nowString}</p>`,
      `<p><strong>Location:</strong> ${
        mapLink === "Location not available"
          ? "Location not available"
          : `<a href="${mapLink}">Open in Google Maps</a>`
      }</p>`,
      `<p><strong>Note from student:</strong> ${
        note || "No additional note provided."
      }</p>`,
    ];

    if (audioUrl) {
      htmlLines.push(
        `<p><strong>Audio evidence:</strong> <a href="${audioUrl}">Listen to recording</a></p>`
      );
    }

    htmlLines.push("<p>Please check on them immediately.</p>");

    const html = htmlLines.join("\n");

    const allEmailRecipients = [guardianEmail, ...extraEmails]
      .filter(Boolean)
      .join(",");

    // 5a) Send email
    if (allEmailRecipients.length > 0) {
      try {
        await sendSosEmail({
          to: allEmailRecipients,
          subject,
          text,
          html,
        });
      } catch (emailErr) {
        console.error("Email send error:", emailErr);
        // still continue with SMS/escalation
      }
    }

    // 5b) Send SMS to guardian + extra phones (if Twilio configured)
    const phoneRecipients = [guardianPhone, ...extraPhones].filter(Boolean);

    if (phoneRecipients.length > 0 && twilioClient) {
      const smsBody = `SOS ALERT - ${userName}
Email: ${userEmail || "n/a"}
Time: ${nowString}
Location: ${mapLink}
Note: ${note || "No note"}
Please contact them immediately.`;

      for (const phone of phoneRecipients) {
        sendSms(phone, smsBody); // fire & forget
      }

      // Basic auto-call escalation after 60s if alert still open
      if (guardianPhone) {
        setTimeout(async () => {
          try {
            const snap = await sosRef.get();
            if (!snap.exists) return;
            const data = snap.data();
            if (data.status !== "open") return; // already resolved

            const callText = `This is an automated alert from Smart Campus Safety. ${userName} triggered an SOS and has not been marked safe. Please check on them immediately.`;
            await placeVoiceCall(guardianPhone, callText);
          } catch (err) {
            console.error("Escalation/voice call error:", err);
          }
        }, 60_000);
      }
    }

    return res.status(200).json({ ok: true, sosId: sosRef.id });
  } catch (err) {
    console.error("SOS error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- /api/mark-safe ----------

app.post("/api/mark-safe", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    await db
      .collection("users")
      .doc(uid)
      .set(
        {
          riskLevel: "NORMAL",
          riskScore: 0,
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return res.json({ ok: true });
  } catch (err) {
    console.error("mark-safe error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- /api/resolve-sos (guardian) ----------

app.post("/api/resolve-sos", verifyFirebaseToken, async (req, res) => {
  try {
    const { sosId } = req.body;
    if (!sosId) {
      return res.status(400).json({ error: "Missing sosId" });
    }

    const sosRef = db.collection("sos_alerts").doc(sosId);
    const snap = await sosRef.get();
    if (!snap.exists) {
      return res.status(404).json({ error: "Not found" });
    }

    await sosRef.update({ status: "resolved" });
    await db
      .collection("mesh_sos")
      .doc(sosId)
      .set({ status: "resolved" }, { merge: true });

    return res.json({ ok: true });
  } catch (err) {
    console.error("resolve sos error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- /api/mesh-presence ----------

app.post("/api/mesh-presence", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;
    const email = req.user.email || "";
    const { location, enabled } = req.body || {};

    await db
      .collection("mesh_nodes")
      .doc(uid)
      .set(
        {
          email,
          enabled: !!enabled,
          location: location || null,
          lastActive: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

    return res.json({ ok: true });
  } catch (err) {
    console.error("mesh-presence error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ---------- Start server ----------

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`SCSE backend listening on port ${port}`);
});