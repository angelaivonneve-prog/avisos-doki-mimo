// Robot de avisos de Doki, Mimo y Cuki: revisa la cola de cada app y manda el aviso al dispositivo que usaste por último.
import admin from "firebase-admin";
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SA)) });
const db = admin.firestore(), fcm = admin.messaging();
const now = Date.now(), LATE = 45 * 60000, ACTIVE = 3 * 3600000;
const safe = k => k.replace(/[.\/]/g, "_");
let sent = 0;
for (const u of await db.collection("users").listDocuments()) {
  const [qd, qm, qc, fd, devs] = await Promise.all([
    u.collection("push").doc("q_doki").get(), u.collection("push").doc("q_mimi").get(), u.collection("push").doc("q_cuki").get(),
    u.collection("push").doc("fired").get(), u.collection("devices").get()]);
  const fired = fd.exists ? fd.data() : {};
  const devices = devs.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() })).filter(d => d.token && d.on !== false);
  if (!devices.length) continue;
  const due = [qd, qm, qc].flatMap(q => (q.exists && q.data().items) || []).filter(it => it.at <= now && it.at > now - LATE && !fired[safe(it.k)]);
  const mark = {};
  for (const it of due) {
    const mine = devices.filter(d => d.app === it.app).sort((a, b) => (b.last || 0) - (a.last || 0));
    if (!mine.length) continue;
    // al dispositivo que estés usando; si no usaste ninguno en las últimas horas, a todos
    const targets = (mine[0].last || 0) > now - ACTIVE ? [mine[0]] : mine;
    for (const d of targets) {
      try {
        await fcm.send({ token: d.token, data: { title: it.title || "", body: it.body || "", go: it.go || "", k: it.k },
          webpush: { headers: { Urgency: "high", TTL: "1800" } }, android: { priority: "high" } });
        sent++;
      } catch (e) {
        const c = e.code || "";
        if (c.includes("registration-token-not-registered") || c.includes("invalid-registration-token") || c.includes("invalid-argument")) await d.ref.set({ on: false, token: null }, { merge: true });
        console.log("error", d.id, c);
      }
    }
    mark[safe(it.k)] = now;
  }
  // limpia lo anotado de hace más de 3 días
  const old = Object.keys(fired).filter(k => fired[k] < now - 3 * 86400000);
  old.forEach(k => mark[k] = admin.firestore.FieldValue.delete());
  if (Object.keys(mark).length) await u.collection("push").doc("fired").set(mark, { merge: true });
}
console.log("avisos enviados:", sent);
