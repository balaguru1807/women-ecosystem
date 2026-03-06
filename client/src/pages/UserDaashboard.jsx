// client/src/pages/UserDashboard.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "firebase/auth";
import {
  auth,
  db,
  doc,
  updateDoc,
  getDocs,
  query,
  collection,
  where,
  arrayUnion,
  arrayRemove,
  onSnapshot,
  addDoc,
  serverTimestamp,
  orderBy,
  limit,
} from "../firebase";
import { useAuth } from "../context/authcontext.jsx";
import { useNavigate } from "react-router-dom";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

// Distance between two lat/lng points (meters)
function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h =
    sinDLat * sinDLat +
    Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;

  return 2 * R * Math.asin(Math.sqrt(h));
}

// Record a short audio clip and return a Blob (or null if unsupported)
async function recordShortAudioClip(durationMs = 4000) {
  if (
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia ||
    typeof MediaRecorder === "undefined"
  ) {
    return null;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const recorder = new MediaRecorder(stream);

    return await new Promise((resolve) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        stream.getTracks().forEach((t) => t.stop());
        resolve(blob);
      };

      recorder.start();
      setTimeout(() => {
        if (recorder.state !== "inactive") recorder.stop();
      }, durationMs);
    });
  } catch (err) {
    console.warn("Audio capture failed:", err);
    return null;
  }
}

// Convert Blob to Base64 (data:audio/webm;base64,...)
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Basic E.164 phone validation: + and 8-15 digits
function isValidPhone(phone) {
  if (!phone) return true;
  return /^\+\d{8,15}$/.test(phone);
}

// Small helper
function uniq(arr) {
  return Array.from(new Set((arr || []).filter(Boolean)));
}

export default function UserDashboard() {
  const { firebaseUser, profile } = useAuth();

  // ====== Base profile fields ======
  const [guardianEmail, setGuardianEmail] = useState(profile?.guardianEmail || "");
  const [guardianPhone, setGuardianPhone] = useState(profile?.guardianPhone || "");
  const [savingGuardian, setSavingGuardian] = useState(false);

  // Multi guardian (NEW)
  const [guardianEmails, setGuardianEmails] = useState(profile?.guardianEmails || []);
  const [guardianPhones, setGuardianPhones] = useState(profile?.guardianPhones || []);
  const [newGuardianEmail, setNewGuardianEmail] = useState("");
  const [newGuardianPhone, setNewGuardianPhone] = useState("");
  const [multiMsg, setMultiMsg] = useState("");

  // extra contacts
  const [extraEmail, setExtraEmail] = useState("");
  const [extraPhone, setExtraPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const [sosMessage, setSosMessage] = useState("");
  const [sosLoading, setSosLoading] = useState(false);
  const [lastLocation, setLastLocation] = useState(null);
  const [error, setError] = useState("");

  // safety note + timer
  const [safetyNote, setSafetyNote] = useState("");
  const [timerMinutes, setTimerMinutes] = useState(15);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerFinished, setTimerFinished] = useState(false);
  const [autoEscLeft, setAutoEscLeft] = useState(0);
  const autoEscIntervalRef = useRef(null);

  // Auto evidence recording toggle
  const [autoRecord, setAutoRecord] = useState(true);

  // Fake call
  const [fakeCallActive, setFakeCallActive] = useState(false);
  const [fakeCallIncoming, setFakeCallIncoming] = useState(true);
  const ringtoneRef = useRef(null);

  // voice SOS
  const [voiceActive, setVoiceActive] = useState(false);
  const recognitionRef = useRef(null);

  // continuous tracking
  const [trackingOn, setTrackingOn] = useState(false);

  // Mesh mode
  const [meshEnabled, setMeshEnabled] = useState(true);
  const [nearbyAlerts, setNearbyAlerts] = useState([]);

  // Incident report
  const [incidentText, setIncidentText] = useState("");
  const [incidentLocation, setIncidentLocation] = useState("");
  const [incidentLoading, setIncidentLoading] = useState(false);
  const [incidentMsg, setIncidentMsg] = useState("");

  // ====== NEW: Safety Check-in ======
  const [checkinMsg, setCheckinMsg] = useState("");
  const [checkinMinutes, setCheckinMinutes] = useState(10);
  const [checkinStatusMsg, setCheckinStatusMsg] = useState("");

  // ====== NEW: Siren + Flashlight ======
  const sirenRef = useRef(null);
  const [sirenOn, setSirenOn] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const torchTrackRef = useRef(null);
  const torchStreamRef = useRef(null);

  // Sync from profile
  useEffect(() => {
    setGuardianEmail(profile?.guardianEmail || "");
    setGuardianPhone(profile?.guardianPhone || "");
    setGuardianEmails(profile?.guardianEmails || []);
    setGuardianPhones(profile?.guardianPhones || []);
    if (profile?.currentLocation) setLastLocation(profile.currentLocation);
  }, [profile]);

  if (!firebaseUser) return null;
  const uid = firebaseUser.uid;

  // ====== AI Advisor (rule-based) ======
  const ai = useMemo(() => {
    const tips = [];
    let score = 0;

    const hour = new Date().getHours();
    if (hour >= 20 || hour <= 5) {
      score += 2;
      tips.push("It’s late hours — stay in well-lit areas and avoid isolated routes.");
    }

    if (!lastLocation?.lat || !lastLocation?.lng) {
      score += 2;
      tips.push("Location isn’t available — turn ON GPS for better safety tracking.");
    }

    const linkedGuardians = uniq([guardianEmail?.trim(), ...(guardianEmails || [])]);
    if (linkedGuardians.length === 0) {
      score += 2;
      tips.push("No guardian linked — add at least one guardian to receive SOS/check-ins.");
    }

    if (timerRunning) {
      score += 1;
      tips.push("Safe-walk timer is running — keep phone accessible and battery above 20%.");
    }

    if (meshEnabled) {
      tips.push("Mesh mode is ON — you can receive nearby SOS alerts.");
    }

    const level = score >= 5 ? "ALERT" : score >= 3 ? "CAUTION" : "SAFE";
    return {
      level,
      score,
      tips: tips.length
        ? tips
        : ["You look safe right now. Stay aware and keep your phone charged."],
    };
  }, [guardianEmail, guardianEmails, lastLocation, meshEnabled, timerRunning]);

  // ====== Logout ======
 // inside component
const navigate = useNavigate();

const handleLogout = async () => {
  await signOut(auth);
  navigate("/auth");
};

  // ✅ CALL POLICE (100)
  const callPolice = () => {
    window.location.href = "tel:100";
  };

  // open nearby places in Google Maps
  const openNearby = (queryText) => {
    const base = "https://www.google.com/maps/search/";
    if (lastLocation?.lat && lastLocation?.lng) {
      window.open(
        `${base}${encodeURIComponent(queryText)}/@${lastLocation.lat},${lastLocation.lng},15z`,
        "_blank"
      );
    } else {
      window.open(`${base}${encodeURIComponent(queryText)}`, "_blank");
    }
  };

  // ====== Multi-Guardian (NEW) ======
  const addGuardianToList = async () => {
    setError("");
    setMultiMsg("");
    const email = newGuardianEmail.trim().toLowerCase();
    const phone = newGuardianPhone.trim();

    if (!email) return setError("Enter guardian email.");
    if (phone && !isValidPhone(phone)) return setError("Phone must be like +91XXXXXXXXXX");

    try {
      // Ensure guardian account exists (your DB rule)
      const gRef = collection(db, "guardians");
      const q1 = query(gRef, where("email", "==", email));
      const snap = await getDocs(q1);

      if (snap.empty) return setError("No guardian account found with this email.");

      const guardianDoc = snap.docs[0];
      const userRef = doc(db, "users", uid);

      // Add to arrays
      const updates = {
        guardianEmails: arrayUnion(email),
      };
      if (phone) updates.guardianPhones = arrayUnion(phone);

      await updateDoc(userRef, updates);

      // guardian watches this uid
      await updateDoc(guardianDoc.ref, { watching: arrayUnion(uid) });

      setNewGuardianEmail("");
      setNewGuardianPhone("");
      setMultiMsg("Guardian added.");
    } catch (e) {
      console.error(e);
      setError("Failed to add guardian.");
    }
  };

  const removeGuardianFromList = async (email) => {
    setError("");
    setMultiMsg("");
    try {
      const userRef = doc(db, "users", uid);
      await updateDoc(userRef, { guardianEmails: arrayRemove(email) });
      setMultiMsg("Guardian removed.");
    } catch (e) {
      console.error(e);
      setError("Failed to remove guardian.");
    }
  };

  // ====== Old single guardian Save (kept) ======
  const handleSaveGuardian = async () => {
    setError("");
    setSosMessage("");
    const trimmedEmail = guardianEmail.trim().toLowerCase();
    const trimmedPhone = guardianPhone.trim();

    if (!trimmedEmail) return setError("Enter a guardian email.");
    if (!isValidPhone(trimmedPhone)) {
      return setError("Enter phone with country code (example: +91XXXXXXXXXX).");
    }

    try {
      setSavingGuardian(true);

      const gRef = collection(db, "guardians");
      const q1 = query(gRef, where("email", "==", trimmedEmail));
      const snap = await getDocs(q1);

      if (snap.empty) {
        setError("No guardian account found with this email.");
        return;
      }

      const guardianDoc = snap.docs[0];
      const userRef = doc(db, "users", uid);

      await updateDoc(userRef, {
        guardianEmail: trimmedEmail,
        guardianPhone: trimmedPhone || "",
      });

      await updateDoc(guardianDoc.ref, { watching: arrayUnion(uid) });

      setSosMessage("Guardian email & phone saved.");
    } catch (err) {
      console.error(err);
      setError("Failed to save guardian details. Try again.");
    } finally {
      setSavingGuardian(false);
    }
  };

  // add extra emergency contact
  const handleAddContact = async () => {
    setError("");
    setSosMessage("");

    const trimmedEmail = extraEmail.trim().toLowerCase();
    const trimmedPhone = extraPhone.trim();

    if (!trimmedEmail && !trimmedPhone) return;
    if (!isValidPhone(trimmedPhone)) return setError("Extra phone must be like +91XXXXXXXXXX");

    try {
      setSavingContact(true);
      const userRef = doc(db, "users", uid);

      const payload = {};
      if (trimmedEmail) payload.extraContacts = arrayUnion(trimmedEmail);
      if (trimmedPhone) payload.extraPhones = arrayUnion(trimmedPhone);

      await updateDoc(userRef, payload);
      setExtraEmail("");
      setExtraPhone("");
      setSosMessage("Emergency contact saved.");
    } catch (err) {
      console.error(err);
      setError("Could not add contact.");
    } finally {
      setSavingContact(false);
    }
  };

  // ====== Mark safe (existing API) ======
  const handleMarkSafe = async () => {
    try {
      const token = await firebaseUser.getIdToken();
      await fetch(`${API_BASE}/api/mark-safe`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      });
      window.location.reload();
    } catch (err) {
      console.error("mark safe error:", err);
    }
  };

  // ====== SEND SOS (existing) ======
  const handleSos = async () => {
    setError("");
    setSosMessage("");
    setSosLoading(true);

    let location = null;
    let audioBase64 = null;

    try {
      if (navigator.geolocation) {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          })
        );
        location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLastLocation(location);
      }
    } catch (geoErr) {
      console.warn("Geolocation failed, sending SOS without location", geoErr);
    }

    try {
      if (autoRecord) {
        const blob = await recordShortAudioClip(4000);
        if (blob) audioBase64 = await blobToBase64(blob);
      }
    } catch (audioErr) {
      console.warn("Audio capture failed (SOS will still send):", audioErr);
    }

    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch(`${API_BASE}/api/sos`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ location, note: safetyNote, audioBase64 }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error || "Failed to send SOS.");
      else {
        setSosMessage("SOS sent to your guardian and contacts.");
        setTimerRunning(false);
        setTimerFinished(false);
      }
    } catch (err) {
      console.error(err);
      setError("Could not contact SOS server.");
    } finally {
      setSosLoading(false);
    }
  };

  // ====== NEW: Safety Check-In (safe / timed) ======
  const sendCheckIn = async ({ timed = false } = {}) => {
    setError("");
    setCheckinStatusMsg("");
    setSosMessage("");

    const msg = checkinMsg.trim() || "Quick check-in";

    // guardians from single + multi
    const g1 = guardianEmail?.trim()?.toLowerCase();
    const gList = (guardianEmails || []).map((x) => String(x).trim().toLowerCase());
    const finalGuardians = uniq([g1, ...gList]);

    if (finalGuardians.length === 0) {
      setError("Add at least one guardian (single or multi) to use check-in.");
      return;
    }

    // optional location
    let geo = null;
    try {
      if (navigator.geolocation) {
        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 8000,
          })
        );
        geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLastLocation(geo);
      }
    } catch {
      // ignore
    }

    const dueAt = timed ? new Date(Date.now() + checkinMinutes * 60 * 1000) : null;

    try {
      await addDoc(collection(db, "checkins"), {
        userId: uid,
        userEmail: firebaseUser.email,
        userName: profile?.name || firebaseUser.email,
        guardianEmails: finalGuardians,
        message: msg,
        status: timed ? "pending" : "safe",
        dueAt: dueAt ? dueAt : null,
        locationGeo: geo || null,
        createdAt: serverTimestamp(),
      });

      setCheckinMsg("");
      setCheckinStatusMsg(timed ? "Timed check-in started." : "Check-in sent.");
    } catch (e) {
      console.error(e);
      setError("Failed to send check-in.");
    }
  };

  // ====== NEW: Automatic check-in failure alert ======
  // Any pending check-in past dueAt becomes "missed"
  useEffect(() => {
    if (!firebaseUser) return;

    const qy = query(
      collection(db, "checkins"),
      where("userId", "==", uid),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const unsub = onSnapshot(qy, (snap) => {
      const now = Date.now();

      snap.docs.forEach(async (d) => {
        const data = d.data();
        if (data?.status !== "pending") return;
        if (!data?.dueAt?.toDate) return;

        const dueMs = data.dueAt.toDate().getTime();
        if (dueMs <= now) {
          try {
            await updateDoc(doc(db, "checkins", d.id), { status: "missed" });
          } catch (e) {
            // ignore write conflicts
          }
        }
      });
    });

    return () => unsub();
  }, [firebaseUser, uid]);

  // ====== NEW: Siren ======
  const toggleSiren = async () => {
    const audio = sirenRef.current;
    if (!audio) return;

    if (!sirenOn) {
      audio.currentTime = 0;
      await audio.play().catch(() => {});
      setSirenOn(true);
    } else {
      audio.pause();
      audio.currentTime = 0;
      setSirenOn(false);
    }
  };

  // ====== NEW: Flashlight (Torch) ======
  const toggleTorch = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        alert("Flashlight not supported on this device/browser.");
        return;
      }

      if (!torchOn) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        const track = stream.getVideoTracks()[0];
        torchStreamRef.current = stream;
        torchTrackRef.current = track;

        // Try torch constraint
        await track.applyConstraints({ advanced: [{ torch: true }] });

        setTorchOn(true);
      } else {
        // Stop camera
        if (torchStreamRef.current) {
          torchStreamRef.current.getTracks().forEach((t) => t.stop());
        }
        torchStreamRef.current = null;
        torchTrackRef.current = null;
        setTorchOn(false);
      }
    } catch (e) {
      console.warn(e);
      alert("Flashlight not supported / permission denied.");
    }
  };

  const panicSirenFlash = async () => {
    await toggleSiren();
    try {
      await toggleTorch();
    } catch {
      // ignore
    }
  };

  // Stop torch on unmount
  useEffect(() => {
    return () => {
      try {
        if (torchStreamRef.current) torchStreamRef.current.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  // ====== Safe-walk countdown effect ======
  useEffect(() => {
    if (!timerRunning || timeLeft <= 0) return;

    const id = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          setTimerRunning(false);
          setTimerFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [timerRunning, timeLeft]);

  // Auto escalation when timer finished
  useEffect(() => {
    if (!timerFinished) {
      if (autoEscIntervalRef.current) {
        clearInterval(autoEscIntervalRef.current);
        autoEscIntervalRef.current = null;
      }
      setAutoEscLeft(0);
      return;
    }

    let remaining = 30;
    setAutoEscLeft(remaining);

    autoEscIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setAutoEscLeft(remaining);
      if (remaining <= 0) {
        clearInterval(autoEscIntervalRef.current);
        autoEscIntervalRef.current = null;
        setTimerFinished(false);
        handleSos();
      }
    }, 1000);

    return () => {
      if (autoEscIntervalRef.current) {
        clearInterval(autoEscIntervalRef.current);
        autoEscIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerFinished]);

  // continuous live tracking ping
  useEffect(() => {
    if (!trackingOn || !firebaseUser) return;

    let intervalId;

    const sendTrackPing = async () => {
      try {
        if (!navigator.geolocation) return;

        const pos = await new Promise((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
          })
        );

        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLastLocation(location);

        const token = await firebaseUser.getIdToken();
        await fetch(`${API_BASE}/api/track`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ location }),
        });
      } catch (err) {
        console.warn("Tracking ping failed", err);
      }
    };

    sendTrackPing();
    intervalId = setInterval(sendTrackPing, 15000);

    return () => intervalId && clearInterval(intervalId);
  }, [trackingOn, firebaseUser]);

  // secret SOS – press "S" three times
  useEffect(() => {
    if (!firebaseUser) return;

    let lastPressTime = 0;
    let count = 0;

    const handler = (e) => {
      if (e.key.toLowerCase() !== "s") return;
      const now = Date.now();
      if (now - lastPressTime < 2000) count += 1;
      else count = 1;

      lastPressTime = now;
      if (count >= 3) {
        handleSos();
        count = 0;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  // Mesh presence heartbeat
  useEffect(() => {
    if (!firebaseUser) return;
    let intervalId;

    async function sendPresence() {
      try {
        const token = await firebaseUser.getIdToken();
        await fetch(`${API_BASE}/api/mesh-presence`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            enabled: meshEnabled,
            location: lastLocation || null,
          }),
        });
      } catch (err) {
        console.warn("mesh presence failed:", err);
      }
    }

    sendPresence();
    intervalId = setInterval(sendPresence, 30000);

    return () => intervalId && clearInterval(intervalId);
  }, [firebaseUser, meshEnabled, lastLocation]);

  // Listen for mesh_sos alerts
  useEffect(() => {
    if (!meshEnabled || !firebaseUser) {
      setNearbyAlerts([]);
      return;
    }

    const sosRef = collection(db, "mesh_sos");
    const unsub = onSnapshot(
      sosRef,
      (snap) => {
        const items = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((a) => a.status !== "resolved");

        if (lastLocation?.lat && lastLocation?.lng) {
          const mine = lastLocation;
          setNearbyAlerts(
            items.filter((a) => {
              if (!a.location?.lat || !a.location?.lng) return false;
              return haversineMeters(mine, a.location) <= 800;
            })
          );
        } else {
          setNearbyAlerts(items);
        }
      },
      (err) => console.error("mesh_sos listener error:", err)
    );

    return () => unsub();
  }, [firebaseUser, meshEnabled, lastLocation]);

  // Incident submit
  const submitIncident = async () => {
    setIncidentMsg("");
    setError("");

    const desc = incidentText.trim();
    const locText = incidentLocation.trim();

    if (!desc) {
      setIncidentMsg("Please describe the incident.");
      return;
    }

    const gEmail = (profile?.guardianEmail || guardianEmail || "").trim().toLowerCase();
    if (!gEmail) {
      setIncidentMsg("Please save your guardian email first, then submit report.");
      return;
    }

    try {
      setIncidentLoading(true);

      let geo = null;
      try {
        if (navigator.geolocation) {
          const pos = await new Promise((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 8000,
            })
          );
          geo = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        }
      } catch {
        // ignore
      }

      await addDoc(collection(db, "incident_reports"), {
        userId: uid,
        userEmail: firebaseUser.email,
        userName: profile?.name || firebaseUser.email,
        guardianEmail: gEmail,
        locationText: locText || "",
        locationGeo: geo || null,
        description: desc,
        status: "reported",
        timestamp: serverTimestamp(),
      });

      setIncidentText("");
      setIncidentLocation("");
      setIncidentMsg("Incident report submitted successfully.");
    } catch (err) {
      console.error(err);
      setIncidentMsg("Failed to submit report.");
    } finally {
      setIncidentLoading(false);
    }
  };

  // Fake call
  const startFakeCall = () => {
    setFakeCallIncoming(true);
    setFakeCallActive(true);
    setTimeout(() => {
      if (ringtoneRef.current) {
        ringtoneRef.current.currentTime = 0;
        ringtoneRef.current.play().catch(() => {});
      }
    }, 10);
  };

  const acceptFakeCall = () => {
    setFakeCallIncoming(false);
    if (ringtoneRef.current) ringtoneRef.current.pause();
  };

  const endFakeCall = () => {
    setFakeCallActive(false);
    setFakeCallIncoming(true);
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current.currentTime = 0;
    }
  };

  // Voice SOS
  const startVoiceSos = () => {
    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) return alert("Voice SOS is not supported in this browser.");

      const recognition = new SpeechRecognition();
      recognition.lang = "en-IN";
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (event) => {
        const transcript =
          event.results[event.results.length - 1][0].transcript.toLowerCase();
        if (
          transcript.includes("help") ||
          transcript.includes("save me") ||
          transcript.includes("sos")
        ) {
          handleSos();
        }
      };

      recognition.onend = () => setVoiceActive(false);

      recognition.start();
      recognitionRef.current = recognition;
      setVoiceActive(true);
    } catch (err) {
      console.error(err);
      alert("Could not start voice recognition.");
    }
  };

  const stopVoiceSos = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setVoiceActive(false);
  };

  const rawRisk = profile?.riskLevel || "NORMAL";
  const riskScore = typeof profile?.riskScore === "number" ? profile.riskScore : null;
  const statusIsAlert = rawRisk === "ALERT";
  const statusIsCaution = rawRisk === "CAUTION";
  const riskLevel = rawRisk === "ALERT" ? "ALERT" : rawRisk === "CAUTION" ? "CAUTION" : "SAFE";

  const mapLink =
    lastLocation?.lat && lastLocation?.lng
      ? `https://www.google.com/maps?q=${lastLocation.lat},${lastLocation.lng}`
      : null;

  const formatTimer = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="app-shell">
      {/* hidden trigger */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "40px",
          height: "40px",
          cursor: "pointer",
          opacity: 0,
          zIndex: 10,
        }}
        onClick={handleSos}
      />

      {/* Siren audio */}
      {/* Put siren.mp3 inside: client/public/siren.mp3 */}
      <audio ref={sirenRef} src="/siren.mp3" loop />

      <div className="glass-card-wide">
        {/* LEFT */}
        <div className="stack-lg">
          {/* Header */}
          <div className="section-title-row">
            <div>
              <h2 className="card-title">Welcome, {profile?.name || firebaseUser.email}</h2>
              <p className="card-subtitle">Smart Campus Safety · Student dashboard</p>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span
                className={`chip ${
                  statusIsAlert ? "chip-danger" : statusIsCaution ? "chip-warning" : "chip-accent"
                }`}
              >
                Status: {riskLevel}
                {riskScore !== null ? ` (Score: ${riskScore})` : ""}
              </span>

              {statusIsAlert && (
                <button className="btn btn-ghost" type="button" onClick={handleMarkSafe}>
                  I'm safe now
                </button>
              )}

              <button className="btn btn-ghost" onClick={handleLogout}>
                Logout
              </button>
            </div>
          </div>

          {/* ✅ AI Safety Advisor (NEW) */}
          <div className="panel">
            <h3 className="panel-title">AI Safety Advisor</h3>
            <p className="panel-text">
              Status: <strong>{ai.level}</strong> (Score: {ai.score}/10)
            </p>
            <ul style={{ marginTop: "0.4rem", paddingLeft: "1.2rem" }}>
              {ai.tips.map((t, idx) => (
                <li key={idx}>{t}</li>
              ))}
            </ul>
          </div>

          {/* Guardian & Contacts */}
          <div className="stack">
            <div className="section-title-row">
              <h3 style={{ fontSize: "0.95rem", margin: 0 }}>Guardian & Contacts</h3>
            </div>

            <div className="field">
              <span className="field-label">Guardian email & phone</span>
              <div className="inline-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <input
                  className="input"
                  style={{ minWidth: "190px" }}
                  type="email"
                  placeholder="guardian@college.edu"
                  value={guardianEmail}
                  onChange={(e) => setGuardianEmail(e.target.value)}
                  disabled={savingGuardian}
                />
                <input
                  className="input"
                  style={{ minWidth: "160px" }}
                  type="tel"
                  placeholder="+91XXXXXXXXXX"
                  value={guardianPhone}
                  onChange={(e) => setGuardianPhone(e.target.value)}
                  disabled={savingGuardian}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={savingGuardian}
                  onClick={handleSaveGuardian}
                >
                  {savingGuardian ? "Saving..." : "Save"}
                </button>
              </div>
            </div>

            {/* ✅ Multi-Guardian Monitoring (NEW) */}
            <div className="panel">
              <h3 className="panel-title">Multi-Guardian Monitoring</h3>
              <p className="panel-text">Add multiple guardians who can see SOS + check-ins.</p>

              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                <input
                  className="input"
                  style={{ minWidth: "220px" }}
                  placeholder="guardian email"
                  value={newGuardianEmail}
                  onChange={(e) => setNewGuardianEmail(e.target.value)}
                />
                <input
                  className="input"
                  style={{ minWidth: "170px" }}
                  placeholder="+91XXXXXXXXXX (optional)"
                  value={newGuardianPhone}
                  onChange={(e) => setNewGuardianPhone(e.target.value)}
                />
                <button className="btn btn-ghost" type="button" onClick={addGuardianToList}>
                  Add guardian
                </button>
              </div>

              <div style={{ marginTop: "0.7rem" }}>
                {(!guardianEmails || guardianEmails.length === 0) ? (
                  <p className="text-muted">No extra guardians added.</p>
                ) : (
                  guardianEmails.map((g) => (
                    <div
                      key={g}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.35rem 0",
                        gap: "0.6rem",
                      }}
                    >
                      <span>{g}</span>
                      <button className="btn btn-ghost" type="button" onClick={() => removeGuardianFromList(g)}>
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>

              {multiMsg && <div className="text-success">{multiMsg}</div>}
            </div>

            <div className="field">
              <span className="field-label">Extra emergency contacts</span>
              <div className="inline-actions" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
                <input
                  className="input"
                  style={{ minWidth: "180px" }}
                  type="email"
                  placeholder="Friend / parent email"
                  value={extraEmail}
                  onChange={(e) => setExtraEmail(e.target.value)}
                  disabled={savingContact}
                />
                <input
                  className="input"
                  style={{ minWidth: "140px" }}
                  type="tel"
                  placeholder="+91..."
                  value={extraPhone}
                  onChange={(e) => setExtraPhone(e.target.value)}
                  disabled={savingContact}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={handleAddContact}
                  disabled={savingContact}
                >
                  {savingContact ? "Adding..." : "Add"}
                </button>
              </div>
            </div>
          </div>

          {/* ✅ Safety Check-In (NEW) */}
          <div className="panel">
            <h3 className="panel-title">Safety Check-In</h3>
            <p className="panel-text">Send “I’m safe” or start a timed check-in to guardians.</p>

            <input
              className="input"
              placeholder="Type check-in message (ex: Reached hostel)"
              value={checkinMsg}
              onChange={(e) => setCheckinMsg(e.target.value)}
            />

            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginTop: "0.6rem" }}>
              <button className="btn btn-ghost" type="button" onClick={() => sendCheckIn({ timed: false })}>
                Send “I’m safe”
              </button>

              <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                <select
                  className="input"
                  value={checkinMinutes}
                  onChange={(e) => setCheckinMinutes(Number(e.target.value))}
                >
                  <option value={5}>5 min</option>
                  <option value={10}>10 min</option>
                  <option value={15}>15 min</option>
                  <option value={20}>20 min</option>
                </select>

                <button className="btn btn-ghost" type="button" onClick={() => sendCheckIn({ timed: true })}>
                  Timed check-in
                </button>
              </div>
            </div>

            {checkinStatusMsg && <div className="text-success" style={{ marginTop: "0.5rem" }}>{checkinStatusMsg}</div>}
          </div>

          {/* Mesh mode */}
          <div className="panel">
            <div className="panel-header-row">
              <h3 className="panel-title">Help nearby students (Mesh mode)</h3>

              <label className="switch-label">
                <input
                  type="checkbox"
                  checked={meshEnabled}
                  onChange={(e) => setMeshEnabled(e.target.checked)}
                />
                <span className="switch-slider" />
              </label>
            </div>

            <p className="panel-text">
              When Mesh mode is ON, your device listens for SOS alerts from students near you.
            </p>

            {nearbyAlerts.length === 0 ? (
              <p className="text-muted">No nearby SOS alerts right now.</p>
            ) : (
              <div className="alert-list">
                {nearbyAlerts.map((a) => {
                  const createdAt =
                    a.time?.toDate?.().toLocaleString() ||
                    a.timestamp?.toDate?.().toLocaleString() ||
                    new Date().toLocaleString();

                  const map =
                    a.location?.lat && a.location?.lng
                      ? `https://www.google.com/maps?q=${a.location.lat},${a.location.lng}`
                      : null;

                  return (
                    <div key={a.id} className="alert-card compact">
                      <div>
                        <strong>{a.userName || a.userEmail || "Student"}</strong>
                        <div className="alert-meta">
                          Time: {createdAt}
                          {a.note ? (
                            <>
                              <br />
                              <span className="text-muted">Note: {a.note}</span>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="alert-actions">
                        {map ? (
                          <a className="link" href={map} target="_blank" rel="noreferrer">
                            View location
                          </a>
                        ) : (
                          <span className="text-muted">No location.</span>
                        )}

                        <button className="btn btn-primary" type="button" onClick={callPolice}>
                          Call police (100)
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* SOS */}
          <div className="stack">
            <h3 style={{ fontSize: "0.95rem", margin: 0 }}>SOS – Emergency</h3>

            {mapLink ? (
              <p className="text-muted">
                Last known location:{" "}
                <a className="link" href={mapLink} target="_blank" rel="noreferrer">
                  Open in Google Maps
                </a>
              </p>
            ) : (
              <p className="text-muted">Location not captured yet. SOS can still send without it.</p>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center" }}>
              <button className="btn btn-primary" type="button" onClick={handleSos} disabled={sosLoading}>
                {sosLoading ? "Sending SOS..." : "SEND SOS"}
              </button>

              <button
                className={`btn btn-ghost ${voiceActive ? "btn-ghost-active" : ""}`}
                type="button"
                onClick={voiceActive ? stopVoiceSos : startVoiceSos}
              >
                {voiceActive ? "Stop voice SOS" : "Voice SOS mode"}
              </button>

              <button className="btn btn-ghost" type="button" onClick={() => setTrackingOn((p) => !p)}>
                {trackingOn ? "Stop live tracking" : "Start live tracking"}
              </button>

              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem" }}>
                <input type="checkbox" checked={autoRecord} onChange={(e) => setAutoRecord(e.target.checked)} />
                Auto audio evidence
              </label>

              {/* ✅ 4) Emergency Siren */}
              <button className="btn btn-ghost" type="button" onClick={toggleSiren}>
                {sirenOn ? "Stop siren" : "Emergency siren"}
              </button>

              {/* ✅ 5) Siren + Flashlight */}
              <button className="btn btn-ghost" type="button" onClick={panicSirenFlash}>
                Siren + Flashlight
              </button>

              <button className="btn btn-primary" type="button" onClick={callPolice}>
                Call police (100)
              </button>

              <button className="btn btn-ghost" type="button" onClick={toggleTorch}>
                {torchOn ? "Flashlight OFF" : "Flashlight ON"}
              </button>
            </div>

            {error && <div className="text-error">{error}</div>}
            {sosMessage && <div className="text-success">{sosMessage}</div>}
          </div>

          {/* Incident Report */}
          <div className="panel" style={{ marginTop: "1rem" }}>
            <h3 className="panel-title">🚨 Report an Incident</h3>
            <p className="panel-text">Write what happened. This will show in your guardian dashboard.</p>

            <input
              className="input"
              type="text"
              placeholder="Incident location (optional)"
              value={incidentLocation}
              onChange={(e) => setIncidentLocation(e.target.value)}
            />

            <textarea
              className="note-input"
              rows={3}
              placeholder="Describe what happened..."
              value={incidentText}
              onChange={(e) => setIncidentText(e.target.value)}
              style={{ marginTop: "0.6rem" }}
            />

            <button
              className="btn btn-ghost"
              type="button"
              onClick={submitIncident}
              disabled={incidentLoading}
              style={{ marginTop: "0.6rem" }}
            >
              {incidentLoading ? "Submitting..." : "Submit Incident Report"}
            </button>

            {incidentMsg && (
              <div className="text-muted" style={{ marginTop: "0.5rem" }}>
                {incidentMsg}
              </div>
            )}
          </div>

          {/* Safe walk timer */}
          <div className="panel">
            <h3 className="panel-title">Safe walk timer</h3>
            <p className="panel-text">
              If you don't confirm safety in 30 seconds after timer ends, SOS is sent automatically.
            </p>

            <div className="timer-row">
              <label className="field-label">Duration</label>
              <select
                className="input"
                value={timerMinutes}
                onChange={(e) => setTimerMinutes(Number(e.target.value))}
                disabled={timerRunning}
              >
                <option value={10}>10 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={20}>20 minutes</option>
                <option value={30}>30 minutes</option>
              </select>
            </div>

            <div className="timer-actions">
              {!timerRunning && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setTimeLeft(timerMinutes * 60);
                    setTimerRunning(true);
                    setTimerFinished(false);
                  }}
                >
                  Start timer
                </button>
              )}
              {timerRunning && <div className="timer-countdown">Time left: {formatTimer(timeLeft)}</div>}
            </div>

            {timerFinished && (
              <div className="timer-warning">
                <p>
                  Timer finished. Are you safe?{" "}
                  <span style={{ fontSize: "0.8rem" }}>(Auto SOS in {autoEscLeft}s)</span>
                </p>
                <div className="timer-warning-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setTimerFinished(false);
                      handleMarkSafe();
                    }}
                  >
                    Yes, I'm safe
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setTimerFinished(false);
                      handleSos();
                    }}
                  >
                    No, send SOS
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div className="stack" style={{ fontSize: "0.84rem" }}>
          <div
            style={{
              padding: "1rem 1.1rem",
              borderRadius: "1.1rem",
              background: "rgba(15,23,42,0.96)",
              border: "1px solid rgba(55,65,81,0.9)",
            }}
          >
            <p style={{ marginTop: 0, fontWeight: 600, marginBottom: "0.35rem" }}>Escape tool – Fake call</p>
            <button type="button" className="btn btn-ghost" onClick={startFakeCall}>
              {fakeCallActive ? "Fake call running…" : "Trigger fake call"}
            </button>
          </div>

          {fakeCallActive && (
            <div className="fake-call-overlay">
              <div className="fake-call-card">
                <div className="fake-call-status">{fakeCallIncoming ? "Incoming call…" : "Call in progress"}</div>
                <div className="fake-call-avatar">📞</div>
                <div className="fake-call-name">Mom</div>

                <div className="fake-call-buttons">
                  {fakeCallIncoming ? (
                    <>
                      <button type="button" className="fake-call-btn fake-call-btn-decline" onClick={endFakeCall}>
                        Decline
                      </button>
                      <button type="button" className="fake-call-btn fake-call-btn-accept" onClick={acceptFakeCall}>
                        Answer
                      </button>
                    </>
                  ) : (
                    <button type="button" className="fake-call-btn fake-call-btn-decline" onClick={endFakeCall}>
                      End call
                    </button>
                  )}
                </div>
              </div>

              <audio ref={ringtoneRef} loop src="/fake-ringtone.mp3" />
            </div>
          )}

          {/* Nearby help panel (NO hospital) */}
          <div className="panel">
            <h3 className="panel-title">Nearby help</h3>
            <p className="panel-text">Quick emergency actions.</p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
              <button className="btn btn-primary" type="button" onClick={callPolice}>
                Call police (100)
              </button>

              <button className="btn btn-ghost" type="button" onClick={() => openNearby("police station")}>
                Nearby police station
              </button>

              <button className="btn btn-ghost" type="button" onClick={() => openNearby("women help center")}>
                Nearby women help center
              </button>
            </div>
          </div>

          {/* Optional tiny status card */}
          <div className="panel">
            <h3 className="panel-title">Quick status</h3>
            <div className="panel-text">
              Siren: <strong>{sirenOn ? "ON" : "OFF"}</strong> · Flashlight:{" "}
              <strong>{torchOn ? "ON" : "OFF"}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}