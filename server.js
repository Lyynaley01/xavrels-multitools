const express = require("express");
const axios = require("axios");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const FormData = require("form-data");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "https://i.scdn.co"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "https://www.youtube.com", "https://www.youtube-nocookie.com"],
      mediaSrc: ["'self'", "https:", "blob:"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(express.json({ limit: "32kb" }));
app.use("/api/", rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
}));
app.use(express.static(path.join(__dirname, "public"), { etag: true, maxAge: "1h" }));


const http = axios.create({
  timeout: 60_000,
  maxRedirects: 3,
  maxContentLength: 12 * 1024 * 1024,
  maxBodyLength: 12 * 1024 * 1024
});

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";


const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Format file tidak didukung. Gunakan PNG, JPG, WEBP, atau GIF."));
  }
});


/* ============================================================
   AUTH
   ============================================================ */
const MASTER_API_KEY = process.env.MASTER_API_KEY || "";
if (!MASTER_API_KEY) console.warn("⚠️  MASTER_API_KEY belum di-set.");

const sessionStore = new Map();
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_MAX_USES = 30;

function pruneSessions() {
  const now = Date.now();
  for (const [token, data] of sessionStore.entries()) {
    if (data.expiresAt < now || data.used > SESSION_MAX_USES) sessionStore.delete(token);
  }
}
setInterval(pruneSessions, 5 * 60 * 1000);

function createSession(req) {
  const token = crypto.randomBytes(32).toString("hex");
  sessionStore.set(token, {
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: req.ip || "unknown",
    ua: (req.headers["user-agent"] || "").slice(0, 200),
    used: 0
  });
  return token;
}

function validateSession(req) {
  const token = req.headers["x-session-token"];
  if (!token) return { ok: false, reason: "Token tidak ada" };
  const session = sessionStore.get(token);
  if (!session) return { ok: false, reason: "Token tidak valid" };
  if (session.expiresAt < Date.now()) {
    sessionStore.delete(token);
    return { ok: false, reason: "Token expired" };
  }
  session.used = (session.used || 0) + 1;
  if (session.used > SESSION_MAX_USES) {
    sessionStore.delete(token);
    return { ok: false, reason: "Token overused" };
  }
  return { ok: true, session };
}

function validateMasterKey(req) {
  if (!MASTER_API_KEY) return false;
  const provided = req.headers["x-api-key"];
  if (!provided || typeof provided !== "string") return false;
  if (provided.length !== MASTER_API_KEY.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(MASTER_API_KEY));
  } catch { return false; }
}

function requireAuth(req, res, next) {
  if (validateMasterKey(req)) { req.authMode = "master"; return next(); }

  // Support token dari query string juga (buat <audio>, <img>, dll yang gak bisa kirim header)
  let sessionResult = validateSession(req);
  if (!sessionResult.ok) {
    const queryToken = req.query?.token;
    if (queryToken && typeof queryToken === "string") {
      const fakeReq = { headers: { "x-session-token": queryToken } };
      sessionResult = validateSession(fakeReq);
    }
  }
  if (sessionResult.ok) { req.authMode = "session"; req.session = sessionResult.session; return next(); }

  return res.status(401).json({
    ok: false,
    error: "Akses ditolak. Butuh API key atau session token yang valid."
  });
}


/* ============================================================
   /api/session
   ============================================================ */
app.post("/api/session", (req, res) => {
  try {
    const origin = req.headers.origin || "";
    const referer = req.headers.referer || "";
    const host = req.headers.host || "";

    const allowedOrigins = [
      `https://${host}`, `http://${host}`,
      "http://localhost:3000", "http://127.0.0.1:3000"
    ];

    const isFromAllowedOrigin =
      !origin || allowedOrigins.some(o => origin === o || referer.startsWith(o));

    if (!isFromAllowedOrigin) {
      console.log(`🚫 [/api/session] Origin ditolak: ${origin}`);
      return res.status(403).json({ ok: false, error: "Origin tidak diizinkan." });
    }

    const ip = req.ip || "unknown";
    const now = Date.now();
    const recentCount = Array.from(sessionStore.values())
      .filter(s => s.ip === ip && (now - s.createdAt) < 60_000).length;

    if (recentCount >= 10) {
      return res.status(429).json({ ok: false, error: "Terlalu banyak session. Coba lagi nanti." });
    }

    const token = createSession(req);
res.set("Cache-Control", "no-store, no-cache, must-revalidate");
res.set("Pragma", "no-cache");
res.set("Expires", "0");
res.json({ ok: true, token, expiresIn: SESSION_TTL_MS / 1000 });
  } catch (err) {
    console.error("❌ [/api/session]", err.message);
    res.status(500).json({ ok: false, error: "Gagal membuat session." });
  }
});


/* ============================================================
   HELPERS
   ============================================================ */
function safeText(value, max = 180) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function validatePublicHttpsUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("URL tidak valid."); }
  if (u.protocol !== "https:") throw new Error("Gunakan URL HTTPS yang aman.");
  if (u.username || u.password) throw new Error("URL dengan username/password tidak diizinkan.");
  const host = u.hostname.toLowerCase();
  if (
    !host || host === "localhost" || host.endsWith(".localhost") ||
    host.endsWith(".local") || host === "127.0.0.1" || host === "::1" ||
    /^10\./.test(host) || /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) || host === "0.0.0.0"
  ) {
    throw new Error("URL menuju host privat/lokal tidak diizinkan.");
  }
  return u.toString();
}

function sendError(res, err) {
  const msg = String(err?.message || "Permintaan gagal.");
  res.status(400).json({ ok: false, error: msg.slice(0, 180) });
}

function requireSecret(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Tool ini belum dikonfigurasi oleh owner (${name}).`);
  return value;
}

function requireImageResponse(response) {
  const type = String(response.headers["content-type"] || "").toLowerCase();
  if (!type.startsWith("image/")) throw new Error("API tidak mengembalikan file gambar yang valid.");
  const buf = Buffer.from(response.data);
  if (!buf.length || buf.length > 12 * 1024 * 1024) throw new Error("Ukuran hasil gambar tidak valid atau terlalu besar.");
  return buf;
}

async function uploadImageToCdn(buffer, filename = "image.jpg") {
  const form = new FormData();
  form.append("file", buffer, { filename, contentType: "image/jpeg" });
  const res = await http.post(
    "https://cdnn.ikyyxd.my.id/api/upload.php",
    form,
    { headers: form.getHeaders(), timeout: 60_000, maxBodyLength: 12 * 1024 * 1024 }
  );
  const cdnUrl = res.data?.url || res.data?.result?.url || res.data?.file;
  if (typeof cdnUrl !== "string" || !/^https?:\/\//i.test(cdnUrl)) {
    throw new Error("Gagal menyiapkan gambar (CDN tidak mengembalikan URL).");
  }
  return cdnUrl;
}


/* ============================================================
   HEALTH
   ============================================================ */
app.get("/api/health", (_req, res) =>
  res.json({ ok: true, name: "Xavrels MultiTools", status: "online" })
);

app.get("/api/config", (_req, res) => {
  const candidate = process.env.TELEGRAM_BOT_URL || "";
  let telegramBotUrl = "";
  try {
    const u = new URL(candidate);
    if (u.protocol === "https:" && u.hostname === "t.me") telegramBotUrl = u.toString();
  } catch {}
  res.set("Cache-Control", "no-store").json({ telegramBotUrl });
});


/* ============================================================
   /api/hd
   ============================================================ */
app.post("/api/hd", requireAuth, upload.single("image"), async (req, res) => {
  try {
    let imageUrl;
    if (req.file) {
      console.log(`📤 [HD] Upload: ${req.file.originalname} (${req.file.size} bytes)`);
      imageUrl = await uploadImageToCdn(req.file.buffer, req.file.originalname || "upload.jpg");
      imageUrl = validatePublicHttpsUrl(imageUrl);
    } else if (req.body?.url) {
      imageUrl = validatePublicHttpsUrl(safeText(req.body.url, 1500));
    } else {
      throw new Error("Kirim url atau file image.");
    }

    const response = await http.get("https://api.nexadev.my.id/api/upscale/", {
      params: { url: imageUrl },
      responseType: "arraybuffer",
      timeout: 60_000,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://api.nexadev.my.id/",
        "Origin": "https://api.nexadev.my.id"
      }
    });

    const buf = requireImageResponse(response);
    res.set("Content-Type", response.headers["content-type"] || "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", 'inline; filename="xavrels-hd.jpg"');
    res.send(buf);
  } catch (err) {
    console.error("❌ [/api/hd]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/remove-bg
   ============================================================ */
app.post("/api/remove-bg", requireAuth, upload.single("image"), async (req, res) => {
  try {
    let imageUrl;

    if (req.file) {
      console.log(`📤 [RMBG] Upload: ${req.file.originalname} (${req.file.size} bytes)`);
      imageUrl = await uploadImageToCdn(req.file.buffer, req.file.originalname || "upload.jpg");
      imageUrl = validatePublicHttpsUrl(imageUrl);
      console.log(`📤 [RMBG] CDN URL: ${imageUrl}`);
    } else if (req.body?.url) {
      imageUrl = validatePublicHttpsUrl(safeText(req.body.url, 1500));
      console.log(`📤 [RMBG] Input URL: ${imageUrl}`);
    } else {
      throw new Error("Kirim url atau file image.");
    }

    // Panggil API Nexadev — response binary image langsung
    const apiUrl = "https://api.nexadev.my.id/tools/remove/";
    const response = await http.get(apiUrl, {
      params: { url: imageUrl },
      responseType: "arraybuffer",
      timeout: 90_000,
      maxContentLength: 12 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/avif,image/webp,image/apng,image/png,image/jpeg,image/*,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Referer": "https://api.nexadev.my.id/",
        "Origin": "https://api.nexadev.my.id"
      }
    });

    const output = requireImageResponse(response);

    res.set("Content-Type", response.headers["content-type"] || "image/png");
    res.set("Content-Disposition", 'inline; filename="xavrels-remove-bg.png"');
    res.set("Cache-Control", "no-store");
    res.send(output);

  } catch (err) {
    console.error("❌ [/api/remove-bg]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/pinterest
   ============================================================ */
app.post("/api/pinterest", requireAuth, async (req, res) => {
  try {
    const q = safeText(req.body?.query, 100);
    if (q.length < 2) throw new Error("Masukkan keyword minimal 2 karakter.");

    const response = await http.get("https://api.ikyyxd.my.id/search/pinterest", {
      params: { apikey: "kyzz", q },
      timeout: 30_000,
      headers: { "User-Agent": BROWSER_UA }
    });

    if (response.data?.status !== true) throw new Error("Pencarian Pinterest gagal.");

    const seen = new Set();
    const results = (Array.isArray(response.data.results) ? response.data.results : [])
      .filter(x => typeof x?.image_url === "string" && /^https:\/\/[^ ]+/i.test(x.image_url))
      .filter(x => { if (seen.has(x.image_url)) return false; seen.add(x.image_url); return true; })
      .slice(0, 10)
      .map(x => ({
        id: safeText(String(x.id || ""), 40),
        image_url: x.image_url,
        title: safeText(x.title, 200) || "Pinterest Image",
        pin_url: typeof x.source === "string" && /^https?:\/\//i.test(x.source)
          ? safeText(x.source, 500)
          : "",
        author: x.user && typeof x.user === "object" ? {
          username: safeText(String(x.user.username || ""), 80),
          name: safeText(String(x.user.name || ""), 100),
          followers: typeof x.user.followers === "number" ? x.user.followers : null
        } : null
      }));

    res.json({ ok: true, results });
  } catch (err) {
    console.error("❌ [/api/pinterest]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/stream — Proxy audio (biar Content-Type bener)
   ============================================================ */
app.get("/api/stream", requireAuth, async (req, res) => {
  try {
    const audioUrl = safeText(req.query?.url, 2000);
    if (!audioUrl) throw new Error("Parameter url wajib.");

    // Validasi URL (harus HTTPS, bukan privat)
    const validUrl = validatePublicHttpsUrl(audioUrl);

    // Whitelist domain — cuma boleh stream dari provider audio
    const u = new URL(validUrl);
    const allowedHosts = [
      "rapid.spotidown.app",
      "spotidown.app",
      "googlevideo.com",
      "youtube.com",
      "ytimg.com"
    ];
    const isAllowed = allowedHosts.some(h => u.hostname === h || u.hostname.endsWith("." + h));
    if (!isAllowed) {
      throw new Error("Domain audio tidak diizinkan.");
    }

    // Forward Range header kalau ada (buat seek/pause)
    const rangeHeader = req.headers["range"];
    const upstreamHeaders = {
      "User-Agent": BROWSER_UA,
      "Accept": "*/*"
    };
    if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

    // Request ke provider
    const upstream = await http.get(validUrl, {
      responseType: "stream",
      timeout: 60_000,
      headers: upstreamHeaders,
      validateStatus: (s) => s >= 200 && s < 400
    });

    // Set header ke browser — paksa jadi audio/mpeg
    const upstreamType = String(upstream.headers["content-type"] || "").toLowerCase();
    let contentType = "audio/mpeg";
    if (upstreamType.startsWith("audio/")) contentType = upstreamType;

    res.set("Content-Type", contentType);
    res.set("Accept-Ranges", "bytes");
    res.set("Cache-Control", "public, max-age=3600");

    // Forward Content-Length & Content-Range kalau ada
    if (upstream.headers["content-length"]) {
      res.set("Content-Length", upstream.headers["content-length"]);
    }
    if (upstream.headers["content-range"]) {
      res.set("Content-Range", upstream.headers["content-range"]);
    }
    if (upstream.status === 206) {
      res.status(206);
    }

    // Stream ke browser
    upstream.data.pipe(res);

    upstream.data.on("error", (err) => {
      console.error("❌ [stream] Pipe error:", err.message);
      if (!res.headersSent) res.status(500).end();
    });

  } catch (err) {
    console.error("❌ [/api/stream]", err.message);
    if (!res.headersSent) {
      sendError(res, err);
    }
  }
});


/* ============================================================
   /api/spotify — pakai Nexadev (metadata lengkap + mp3_url)
   ============================================================ */
app.post("/api/spotify", requireAuth, async (req, res) => {
  try {
    const q = safeText(req.body?.query, 120);
    if (q.length < 2) throw new Error("Masukkan judul lagu atau artis.");

    const response = await http.get(
      "https://api.nexadev.my.id/api/spotifyplay",
      {
        params: { q },
        timeout: 60_000,
        headers: {
          "User-Agent": BROWSER_UA,
          "Accept": "application/json, text/plain, */*",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          "Referer": "https://api.nexadev.my.id/",
          "Origin": "https://api.nexadev.my.id"
        }
      }
    );

    const data = response.data;
    if (!data?.status || !data?.data) throw new Error("Lagu tidak ditemukan.");

    const r = data.data;

    res.json({
      ok: true,
      result: {
        title: safeText(r.title, 200),
        artist: safeText(r.artist, 150),
        album: safeText(r.album, 150),
        year: r.year || null,
        duration: safeText(String(r.duration || ""), 20),
        cover: typeof r.cover === "string" && r.cover.startsWith("https://") ? r.cover : "",
        spotifyUrl: typeof r.spotify_url === "string" && r.spotify_url.startsWith("https://") ? r.spotify_url : "",
        audio: typeof r.mp3_url === "string" && r.mp3_url.startsWith("https://") ? r.mp3_url : ""
      }
    });
  } catch (err) {
    console.error("❌ [/api/spotify]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/react
   ============================================================ */
app.post("/api/react", requireAuth, async (req, res) => {
  try {
    const url = validatePublicHttpsUrl(safeText(req.body?.url, 1000));
    const emoji = safeText(req.body?.emoji, 80);

    if (!/whatsapp\.com\/channel\//i.test(new URL(url).hostname + new URL(url).pathname)) {
      throw new Error("URL harus berupa link postingan/channel WhatsApp.");
    }
    if (!emoji || emoji.length > 60) {
      throw new Error("Isi emoji reaksi, contoh ❤️,🔥,😂.");
    }

    const apiKey = requireSecret("REACT_API_KEY");
    const response = await http.get(
      "https://auto-reaction.zxcoderid.web.id/api/vip/open-api/react",
      {
        params: { api_key: apiKey, url, reaction: emoji },
        timeout: 45_000,
        headers: { "User-Agent": BROWSER_UA, "Accept": "application/json, */*" }
      }
    );

    const d = response.data;
    if (!d?.success) {
      const detail = safeText(d?.error?.message || d?.message || "Provider menolak permintaan.", 180);
      throw new Error(detail);
    }

    res.json({
      ok: true,
      message: "Permintaan reaksi dikirim ke provider.",
      result: d?.message ? safeText(d.message, 160) : "Selesai"
    });
  } catch (err) {
    console.error("❌ [/api/react]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   FPRESET — Alight Motion Preset Finder (dari TikTok)
   ============================================================ */

const FPRESET_API_BASE = process.env.FPRESET_API_BASE || "https://amfinder.web.id/api/find";

function fp_isTikTokUrl(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

function fp_extractUrls(value) {
  if (value == null) return [];
  const matches = String(value).match(/https?:\/\/[^\s<>"']+/g) || [];
  return matches.map((u) => u.replace(/[),.;]+$/g, "").trim());
}

function fp_walkObject(data, callback) {
  if (data == null) return;
  if (typeof data === "string") { callback(data); return; }
  if (Array.isArray(data)) { for (const item of data) fp_walkObject(item, callback); return; }
  if (typeof data === "object") {
    for (const value of Object.values(data)) {
      callback(value);
      fp_walkObject(value, callback);
    }
  }
}

function fp_findAllUrls(data) {
  const found = [];
  fp_walkObject(data, (value) => {
    if (typeof value !== "string") return;
    for (const url of fp_extractUrls(value)) found.push(url);
  });
  return [...new Set(found)];
}

function fp_findPresetUrls(data) {
  const found = [];
  fp_walkObject(data, (value) => {
    if (typeof value !== "string") return;
    for (const url of fp_extractUrls(value)) {
      const l = url.toLowerCase();
      if (l.includes("alight") || l.includes("preset") ||
          l.includes("xml") || l.includes("project")) {
        found.push(url);
      }
    }
  });
  return [...new Set(found)];
}

function fp_parseAmFinderResponse(rawData) {
  if (rawData && typeof rawData === "object") return rawData;

  const text = String(rawData ?? "").trim();
  if (!text) throw new Error("API tidak mengembalikan data.");

  const lines = text.split(/\r?\n/);
  let currentEvent = null;

  for (const line of lines) {
    if (line.startsWith("event:")) { currentEvent = line.slice(6).trim(); continue; }
    if (currentEvent === "result" && line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      try { return JSON.parse(payload); } catch (_) {}
    }
  }

  try { return JSON.parse(text); } catch (_) {}

  for (const line of [...lines].reverse()) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    try { const p = JSON.parse(payload); if (p && typeof p === "object") return p; } catch (_) {}
  }

  throw new Error("Format response API tidak dikenali.");
}

function fp_firstPresetLink(presetLinks = []) {
  if (!Array.isArray(presetLinks)) return null;
  return (
    presetLinks.find((i) => i?.type === "5mb") ||
    presetLinks.find((i) => i?.type === "xml") ||
    presetLinks.find((i) => i?.url) ||
    null
  );
}

app.post("/api/fpreset", requireAuth, async (req, res) => {
  try {
    const inputUrl = safeText(req.body?.url, 1000);
    if (!inputUrl) throw new Error("Masukkan link video TikTok.");
    if (!fp_isTikTokUrl(inputUrl)) throw new Error("URL harus berupa link TikTok yang valid.");

    const response = await http.get(FPRESET_API_BASE, {
      params: { url: inputUrl },
      timeout: 45_000,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/event-stream, application/json, text/plain, */*"
      },
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const apiMsg = response.data?.message || response.data?.error || response.data?.description;
      throw new Error(apiMsg ? `API error: ${apiMsg}` : `API mengembalikan HTTP ${response.status}.`);
    }

    const data = fp_parseAmFinderResponse(response.data);
    if (!data) throw new Error("API tidak mengembalikan data.");
    if (data.found === false) throw new Error("Preset tidak ditemukan di video ini.");

    const video        = data.video        || {};
    const authorDetail = data.authorDetail || data.author || video.author || {};
    const stats        = video.stats || video.statistics || data.stats || data.statistics || {};

    // API provider bisa memakai nama field berbeda untuk statistik TikTok.
    // Jangan memakai data.scanned.comments karena itu jumlah komentar yang dipindai,
    // bukan total komentar pada video.
    const firstCount = (...values) => {
      for (const value of values) {
        if (value === null || value === undefined || value === "") continue;
        const number = Number(value);
        if (Number.isFinite(number) && number >= 0) return number;
      }
      return 0;
    };
    const firstString = (...values) => {
      for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
        if (typeof value === "number" && Number.isFinite(value)) return String(value);
      }
      return "";
    };
    const avatarValue = authorDetail.avatar || authorDetail.avatarUrl ||
      authorDetail.avatar_url || authorDetail.avatarLarger ||
      authorDetail.avatarMedium || authorDetail.avatarThumb ||
      authorDetail.avatar_large || authorDetail.avatar_medium ||
      authorDetail.avatar_thumb || authorDetail.avatarThumbUrl || "";
    const avatarUrl = typeof avatarValue === "string"
      ? avatarValue
      : (Array.isArray(avatarValue?.urlList) ? avatarValue.urlList[0] :
        (Array.isArray(avatarValue?.url_list) ? avatarValue.url_list[0] : ""));

    const presetLinks = Array.isArray(data.presetLinks)
      ? data.presetLinks
          .filter((i) => i?.url && typeof i.url === "string")
          .map((i) => ({
            type: safeText(String(i.type || ""), 40),
            title: safeText(String(i.title || ""), 120),
            url: safeText(i.url, 1000),
            thumb: typeof i.thumb === "string" && /^https?:\/\//i.test(i.thumb) ? i.thumb : "",
            size: safeText(String(i.size || ""), 40),
            ratio: safeText(String(i.ratio || ""), 40),
            detail: safeText(String(i.detail || ""), 200),
            source: safeText(String(i.source || ""), 40),
            verified: i.verified === true,
            byAuthor: i.byAuthor === true
          }))
      : [];

    const result = {
      author: safeText(firstString(data.author, authorDetail.uniqueId, authorDetail.username, authorDetail.unique_id), 80),
      username: safeText(firstString(authorDetail.uniqueId, authorDetail.username, authorDetail.unique_id, authorDetail.uniqueID), 80),
      nickname: safeText(firstString(authorDetail.nickname, authorDetail.displayName, authorDetail.display_name, authorDetail.name), 120),
      bio: safeText(firstString(authorDetail.bio, authorDetail.signature, authorDetail.bioDescription, authorDetail.bio_description), 500),
      bioLink: typeof authorDetail.bioLink === "string" && /^https?:\/\//i.test(authorDetail.bioLink)
        ? safeText(authorDetail.bioLink, 500)
        : "",
      avatar: typeof avatarUrl === "string" && /^https?:\/\//i.test(avatarUrl)
        ? avatarUrl
        : "",

      videoId: safeText(String(video.id || ""), 40),
      sourceUrl: safeText(String(video.url || inputUrl), 500),
      caption: safeText(String(video.description || ""), 500),
      cover: typeof video.cover === "string" && /^https?:\/\//i.test(video.cover)
        ? video.cover
        : "",
      videoUrl: typeof video.playUrlNoWm === "string" && /^https?:\/\//i.test(video.playUrlNoWm)
        ? video.playUrlNoWm
        : (typeof video.playUrl === "string" && /^https?:\/\//i.test(video.playUrl) ? video.playUrl : ""),

      stats: {
        views: firstCount(stats.views, stats.playCount, stats.viewCount, stats.play_count, stats.view_count, video.playCount, video.play_count, video.viewCount, video.view_count),
        likes: firstCount(stats.likes, stats.diggCount, stats.likeCount, stats.like_count, stats.digg_count, video.diggCount, video.digg_count, video.likeCount, video.like_count),
        comments: firstCount(stats.comments, stats.commentCount, stats.comment_count, video.commentCount, video.comment_count),
        shares: firstCount(stats.shares, stats.shareCount, stats.share_count, video.shareCount, video.share_count)
      },

      presetLinks
    };

    res.set("Cache-Control", "no-store");
    res.json({ ok: true, result });

  } catch (err) {
    console.error("❌ [/api/fpreset]", err.message);
    sendError(res, err);
  }
});

/* ============================================================
   FPRESET SEARCH — Cari video TikTok by keyword
   ============================================================ */
const FPRESET_SEARCH_API = process.env.FPRESET_SEARCH_API || "https://amfinder.web.id/api/search";

app.post("/api/fpreset-search", requireAuth, async (req, res) => {
  try {
    const q = safeText(req.body?.query, 120);
    if (q.length < 2) throw new Error("Masukkan keyword minimal 2 karakter.");

    const response = await http.get(FPRESET_SEARCH_API, {
      params: { mode: "pick", q },
      timeout: 45_000,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/event-stream, application/json, text/plain, */*"
      },
      validateStatus: () => true
    });

    if (response.status < 200 || response.status >= 300) {
      const apiMsg = response.data?.message || response.data?.error || response.data?.description;
      throw new Error(apiMsg ? `API error: ${apiMsg}` : `API mengembalikan HTTP ${response.status}.`);
    }

    const data = fp_parseAmFinderResponse(response.data);
    if (!data) throw new Error("API tidak mengembalikan data.");

    // Response bisa berupa array langsung atau object dengan field tertentu
    let rawList = [];
    if (Array.isArray(data)) rawList = data;
    else if (Array.isArray(data.videos)) rawList = data.videos;
    else if (Array.isArray(data.results)) rawList = data.results;
    else if (Array.isArray(data.data)) rawList = data.data;
    else if (Array.isArray(data.items)) rawList = data.items;

    const videos = rawList.slice(0, 30).map((v) => {
      const author = v.author || v.authorDetail || v.user || {};
      const stats = v.stats || v.statistics || {};
      const videoId = String(v.id || v.videoId || v.video_id || "");
      const url = v.url || v.videoUrl || v.video_url
        || (videoId && author.uniqueId ? `https://www.tiktok.com/@${author.uniqueId}/video/${videoId}` : "")
        || "";

      const firstString = (...vals) => {
        for (const val of vals) {
          if (typeof val === "string" && val.trim()) return val.trim();
          if (typeof val === "number" && Number.isFinite(val)) return String(val);
        }
        return "";
      };
      const firstCount = (...vals) => {
        for (const val of vals) {
          if (val === null || val === undefined || val === "") continue;
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0) return n;
        }
        return 0;
      };

      const cover = firstString(v.cover, v.thumbnail, v.thumb, v.dynamicCover, v.dynamic_cover);
      const description = firstString(v.description, v.desc, v.caption, v.title);

      return {
        videoId,
        url,
        cover: /^https?:\/\//i.test(cover) ? cover : "",
        description: safeText(description, 200),
        author: {
          uniqueId: safeText(firstString(author.uniqueId, author.username, author.unique_id), 80),
          nickname: safeText(firstString(author.nickname, author.displayName, author.name), 120)
        },
        stats: {
          views: firstCount(stats.views, stats.playCount, stats.viewCount, stats.play_count),
          likes: firstCount(stats.likes, stats.diggCount, stats.likeCount, stats.digg_count)
        }
      };
    }).filter((v) => v.url && /tiktok\.com/i.test(v.url));

    res.set("Cache-Control", "no-store");
    res.json({ ok: true, videos });

  } catch (err) {
    console.error("❌ [/api/fpreset-search]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   FALLBACK
   ============================================================ */
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ ok: false, error: "Endpoint tidak ditemukan." });
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});


/* ============================================================
   ERROR HANDLER
   ============================================================ */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ ok: false, error: "File terlalu besar. Maksimal 10 MB." });
    }
    return res.status(400).json({ ok: false, error: `Upload error: ${err.message}` });
  }
  if (err) {
    console.error("❌ [Global Error]", err.message);
    return res.status(400).json({ ok: false, error: String(err.message || "Terjadi kesalahan.").slice(0, 180) });
  }
  next();
});


module.exports = app;
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () =>
    console.log(`Xavrels MultiTools running on http://0.0.0.0:${port}`)
  );
}
