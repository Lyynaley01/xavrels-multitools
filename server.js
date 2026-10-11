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
    let input;
    if (req.file) {
      console.log(`📤 [RMBG] Upload: ${req.file.originalname} (${req.file.size} bytes)`);
      input = req.file.buffer;
    } else if (req.body?.url) {
      const imageUrl = validatePublicHttpsUrl(safeText(req.body.url, 1500));
      const inputResponse = await http.get(imageUrl, {
        responseType: "arraybuffer",
        headers: { Accept: "image/*" }
      });
      const inputType = String(inputResponse.headers["content-type"] || "").toLowerCase();
      if (!inputType.startsWith("image/")) throw new Error("URL harus mengarah langsung ke file gambar.");
      input = Buffer.from(inputResponse.data);
    } else {
      throw new Error("Kirim url atau file image.");
    }

    if (!input.length || input.length > 10 * 1024 * 1024) throw new Error("Gambar maksimal 10 MB.");

    const cdnUrl = await uploadImageToCdn(input, "upload.jpg");

    const result = await http.post(
      "https://www.dreamai.art/api/background-remover",
      { images: [cdnUrl] },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": crypto.randomUUID(),
          "User-Agent": BROWSER_UA,
          "Origin": "https://www.dreamai.art",
          "Referer": "https://www.dreamai.art/en/ai-background-remover"
        },
        timeout: 120_000
      }
    );

    const outUrl = result.data?.processedImage;
    if (result.data?.success !== true || typeof outUrl !== "string") {
      throw new Error("Provider Remove BG gagal memproses gambar.");
    }

    const outResponse = await http.get(validatePublicHttpsUrl(outUrl), {
      responseType: "arraybuffer",
      headers: { Accept: "image/*" }
    });

    const output = requireImageResponse(outResponse);
    res.set("Content-Type", "image/png");
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
