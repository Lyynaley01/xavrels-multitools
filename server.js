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

/* ============================================================
   SIGNED SESSION TOKEN (Stateless — works on serverless)
   ============================================================ */
const SESSION_SECRET = process.env.SESSION_SECRET || "";
if (!SESSION_SECRET) {
  console.warn("⚠️  SESSION_SECRET belum di-set — fallback ke random per-process (session gak akan persisten!)");
}
const ACTIVE_SESSION_SECRET = SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const SESSION_TTL_MS = 10 * 60 * 1000;

/**
 * Format token: base64url(payload).hex(signature)
 * payload: { ip, ua, exp }
 */
function createSignedToken(req) {
  const payload = {
    ip: req.ip || "unknown",
    ua: (req.headers["user-agent"] || "").slice(0, 60),
    exp: Date.now() + SESSION_TTL_MS
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", ACTIVE_SESSION_SECRET)
    .update(payloadB64)
    .digest("hex");
  return `${payloadB64}.${signature}`;
}

function validateSignedToken(req) {
  const token = req.headers["x-session-token"] || req.query?.token;
  if (!token || typeof token !== "string") return { ok: false, reason: "Token tidak ada" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "Format token salah" };

  const [payloadB64, signature] = parts;

  // Verify signature
  const expectedSig = crypto
    .createHmac("sha256", ACTIVE_SESSION_SECRET)
    .update(payloadB64)
    .digest("hex");

  if (signature.length !== expectedSig.length) return { ok: false, reason: "Signature tidak valid" };
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return { ok: false, reason: "Signature tidak valid" };
    }
  } catch { return { ok: false, reason: "Signature tidak valid" }; }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch { return { ok: false, reason: "Payload corrupt" }; }

  // Check expiry
  if (!payload.exp || Date.now() > payload.exp) {
    return { ok: false, reason: "Token expired" };
  }

  // Optional: cek IP (bisa dimatiin kalau mobile user sering ganti IP)
  const currentIp = req.ip || "unknown";
  if (payload.ip && payload.ip !== currentIp && payload.ip !== "unknown") {
    // ⚠️ Kalau mau strict, uncomment baris di bawah:
    // return { ok: false, reason: "IP tidak cocok" };
  }

  return { ok: true, payload };
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

  const sessionResult = validateSignedToken(req);
  if (sessionResult.ok) {
    req.authMode = "session";
    req.session = sessionResult.payload;
    return next();
  }

  return res.status(401).json({
    ok: false,
    error: "Akses ditolak. Butuh API key atau session token yang valid."
  });
}


/* ============================================================
   CACHE + RATE LIMIT HELPERS
   ============================================================ */

/* ===== Simple in-memory cache ===== */
const responseCache = new Map();
const CACHE_MAX_SIZE = 500;

function cacheGet(key) {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  // Evict oldest kalau penuh
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const firstKey = responseCache.keys().next().value;
    responseCache.delete(firstKey);
  }
  responseCache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

// Auto-prune tiap 5 menit
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (now > entry.expiresAt) responseCache.delete(key);
  }
}, 5 * 60 * 1000);

/* ===== Per-endpoint rate limiter (in-memory) ===== */
const endpointLimits = new Map(); // key: `ip:endpoint`, value: { count, resetAt }

function checkEndpointLimit(identifier, endpoint, maxPerMinute) {
  const now = Date.now();
  const key = `${identifier}:${endpoint}`;
  let entry = endpointLimits.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60_000 };
    endpointLimits.set(key, entry);
  }

  entry.count++;
  if (entry.count > maxPerMinute) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { ok: true, remaining: maxPerMinute - entry.count, resetAt: entry.resetAt };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of endpointLimits.entries()) {
    if (now > entry.resetAt) endpointLimits.delete(key);
  }
}, 5 * 60 * 1000);

/* ===== Bot detection (basic UA check) ===== */
function isLikelyBot(req) {
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const botPatterns = [
    "headless", "puppeteer", "playwright", "selenium",
    "phantomjs", "nightmare", "curl/", "wget/",
    "python-requests", "python-urllib", "go-http-client",
    "java/", "okhttp", "axios/", "node-fetch", "undici",
    "scrapy", "httpclient", "postmanruntime"
  ];
  if (!ua) return true;
  return botPatterns.some(p => ua.includes(p));
}

/* ===== Helper buat cek provider publik ===== */
function attachPublicWarningHeader(res) {
  res.set("X-Provider-Public", "true");
}


/* ============================================================
   /api/session
   ============================================================ */
/* ===== Strict origin validation ===== */
function isAllowedRequestOrigin(origin, referer, allowedOrigins) {
  // Cek Origin header (paling strict)
  if (origin) {
    return allowedOrigins.includes(origin);
  }
  // Fallback ke Referer (parse hostname persis)
  if (referer) {
    try {
      const refUrl = new URL(referer);
      const refOrigin = `${refUrl.protocol}//${refUrl.host}`;
      return allowedOrigins.includes(refOrigin);
    } catch (_) {
      return false;
    }
  }
  // Gak ada origin & referer → TOLAK
  return false;
}

app.post("/api/session", (req, res) => {
  try {
    const origin = req.headers.origin || "";
    const referer = req.headers.referer || "";
    const host = req.headers.host || "";

    const allowedOrigins = [
      `https://${host}`, `http://${host}`,
      "http://localhost:3000", "http://127.0.0.1:3000"
    ];

    // 🔥 STRICT: wajib ada Origin ATAU Referer yang match persis
    if (!isAllowedRequestOrigin(origin, referer, allowedOrigins)) {
      console.log(`🚫 [/api/session] Ditolak — origin: "${origin}" referer: "${referer}"`);
      return res.status(403).json({ ok: false, error: "Origin tidak diizinkan." });
    }


    const token = createSignedToken(req);
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
    // 🔥 LAYER 1: Bot detection
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/pinterest] Bot detected: ${req.headers["user-agent"]}`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // 🔥 LAYER 2: Rate limit ketat (5 req/menit per IP + session)
    const identifier = req.ip || req.session?.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "pinterest", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    const q = safeText(req.body?.query, 100);
    if (q.length < 2) throw new Error("Masukkan keyword minimal 2 karakter.");

    // 🔥 LAYER 3: Cache (5 menit TTL)
    const cacheKey = `pinterest:${q.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      console.log(`✅ [/api/pinterest] CACHE HIT: "${q}"`);
      res.set("X-Cache", "HIT");
      return res.json({ ok: true, results: cached });
    }

    // Cache MISS — hit provider
    console.log(`📡 [/api/pinterest] CACHE MISS — fetch provider: "${q}"`);
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

    // Simpan ke cache
    cacheSet(cacheKey, results, 5 * 60 * 1000);

    res.set("X-Cache", "MISS");
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

/* ===== NEW: Parse SSE `candidates` event dari amfinder ===== */
function fp_parseCandidatesSSE(rawData) {
  const text = String(rawData ?? "").trim();
  if (!text) return null;

  const lines = text.split(/\r?\n/);
  let currentEvent = null;

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (currentEvent === "candidates" && line.startsWith("data:")) {
      const payload = line.slice(5).trim();
      try {
        const parsed = JSON.parse(payload);
        if (Array.isArray(parsed?.items)) return parsed.items;
      } catch (_) {}
    }
  }
  return null;
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
    // Bot detection
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/fpreset] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // Rate limit ketat (3 req/menit — endpoint ini paling berat)
    const identifier = req.ip || req.session?.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "fpreset", 3);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    const inputUrl = safeText(req.body?.url, 1000);
    if (!inputUrl) throw new Error("Masukkan link video TikTok.");
    if (!fp_isTikTokUrl(inputUrl)) throw new Error("URL harus berupa link TikTok yang valid.");

    // Cache (15 menit TTL — video preset gak sering berubah)
    const cacheKey = `fpreset:${inputUrl}`;
const cached = cacheGet(cacheKey);
if (cached) {
  console.log(`✅ [/api/fpreset] CACHE HIT: ${inputUrl}`);
  res.set("X-Cache", "HIT");
  return res.json({ ok: true, result: cached });
}

// Cache MISS — fetch dari amfinder
console.log(`📡 [/api/fpreset] CACHE MISS — fetch: ${inputUrl}`);
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

        // Simpan ke cache
    cacheSet(cacheKey, result, 15 * 60 * 1000);

    res.set("X-Cache", "MISS");
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
    // 🔥 LAYER 1: Bot detection
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/fpreset-search] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // 🔥 LAYER 2: Rate limit ketat (5 req/menit per IP + session)
    const identifier = req.ip || req.session?.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "fpreset-search", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    const q = safeText(req.body?.query, 120);
    if (q.length < 2) throw new Error("Masukkan keyword minimal 2 karakter.");

    // 🔥 LAYER 3: Cache (10 menit TTL — biar hemat hit provider)
    const cacheKey = `fpreset-search:${q.toLowerCase()}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
      console.log(`✅ [/api/fpreset-search] CACHE HIT: "${q}"`);
      res.set("X-Cache", "HIT");
      return res.json({ ok: true, videos: cached });
    }

    // Cache MISS — hit provider
    console.log(`📡 [/api/fpreset-search] CACHE MISS — fetch: "${q}"`);
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

    // Parse SSE candidates (pake helper yang udah ada)
    let rawList = fp_parseCandidatesSSE(response.data);

    if (!rawList) {
      const data = fp_parseAmFinderResponse(response.data);
      if (data) {
        if (Array.isArray(data)) rawList = data;
        else if (Array.isArray(data.videos)) rawList = data.videos;
        else if (Array.isArray(data.results)) rawList = data.results;
        else if (Array.isArray(data.data)) rawList = data.data;
        else if (Array.isArray(data.items)) rawList = data.items;
      }
    }
    if (!rawList) rawList = [];

    const videos = rawList.slice(0, 30).map((v) => {
      let uniqueId = v.handle || v.author?.uniqueId || v.author?.username || "";
      uniqueId = String(uniqueId).replace(/^@/, "").trim();

      const videoId = String(v.id || v.videoId || v.video_id || "");
      const url = v.url || v.videoUrl || v.video_url
        || (videoId && uniqueId ? `https://www.tiktok.com/@${uniqueId}/video/${videoId}` : "")
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

      const cover = firstString(v.thumb, v.cover, v.thumbnail, v.dynamicCover, v.dynamic_cover);
      const description = firstString(v.snippet, v.description, v.desc, v.caption, v.title);

      return {
        videoId,
        url,
        cover: /^https?:\/\//i.test(cover) ? cover : "",
        description: safeText(description, 200),
        author: {
          uniqueId: safeText(uniqueId, 80),
          nickname: safeText(firstString(v.nickname, v.author?.nickname, v.author?.displayName, uniqueId), 120)
        },
        stats: {
          views: firstCount(v.stats?.playCount, v.stats?.views, v.stats?.viewCount, v.stats?.play_count),
          likes: firstCount(v.stats?.likeCount, v.stats?.likes, v.stats?.diggCount, v.stats?.digg_count)
        }
      };
    }).filter((v) => v.url && /tiktok\.com/i.test(v.url));

    // Simpan ke cache
    cacheSet(cacheKey, videos, 10 * 60 * 1000);

    res.set("X-Cache", "MISS");
    res.json({ ok: true, videos });

  } catch (err) {
    console.error("❌ [/api/fpreset-search]", err.message);
    sendError(res, err);
  }
});

/* ============================================================
   /api/random-cecan — Random Cecan Generator
   ============================================================ */
const CECAN_COUNTRIES = {
  china:     { label: "China",     flag: "🇨🇳", api: "https://api.ikyyxd.my.id/random/cecan/china" },
  japan:     { label: "Jepang",    flag: "🇯🇵", api: "https://api.ikyyxd.my.id/random/cecan/japan" },
  korea:     { label: "Korea",     flag: "🇰🇷", api: "https://api.ikyyxd.my.id/random/cecan/korea" },
  indonesia: { label: "Indonesia", flag: "🇮🇩", api: "https://api.ikyyxd.my.id/random/cecan/indonesia" },
};

app.get("/api/random-cecan", requireAuth, async (req, res) => {
  try {
    // ── LAYER 1: Bot detection ──
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/random-cecan] Bot detected: ${req.headers["user-agent"]}`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // ── LAYER 2: Rate limit (5/menit per IP — konsisten dgn tools lain) ──
    const identifier = req.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "random-cecan", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    // ── LAYER 3: Input validation ──
    const country = safeText(req.query?.country, 20).toLowerCase();
    const cfg = CECAN_COUNTRIES[country];
    if (!cfg) {
      throw new Error("Negara tidak tersedia. Pilih: china, japan, korea, indonesia.");
    }

    console.log(`📡 [/api/random-cecan] Fetch: ${country}`);

    // ── LAYER 4: NO CACHE — karena random/gacha ──
    // Kalau di-cache, user yang klik gacha 2x dapet gambar sama. Skip cache.

    // ── LAYER 5: Hit provider ──
    const response = await http.get(cfg.api, {
      responseType: "arraybuffer",
      timeout: 45_000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/avif,image/webp,image/apng,image/jpeg,image/png,image/*,*/*;q=0.8",
      },
    });

    // ── LAYER 6: Validate response ──
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);

    if (!buffer.length) throw new Error("API mengembalikan gambar kosong.");
    if (buffer.length > 15 * 1024 * 1024) throw new Error("Gambar terlalu besar.");
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error("API tidak mengembalikan file gambar yang valid.");
    }

    // ── LAYER 7: Return ──
    res.set("Content-Type", contentType || "image/jpeg");
    res.set("Cache-Control", "no-store"); // Gacha harus fresh
    res.set("X-Cecan-Country", country);
    res.send(buffer);

  } catch (err) {
    console.error("❌ [/api/random-cecan]", err.message);
    sendError(res, err);
  }
});

/* ============================================================
   /api/gen-lobby-ff — Fake FF Profile Generator (Solo)
   ============================================================ */
const FAKEFF_API_BASE = "https://apii.nexadev.my.id/fakeff";

app.post("/api/gen-lobby-ff", requireAuth, async (req, res) => {
  try {
    // ── LAYER 1: Bot detection ──
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/gen-lobby-ff] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // ── LAYER 2: Rate limit (5/menit per IP) ──
    const identifier = req.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "gen-lobby-ff", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    // ── LAYER 3: Input validation ──
    const nickname = safeText(req.body?.nickname, 30);
    if (!nickname || nickname.length < 2 || nickname.length > 20) {
      throw new Error("Nickname harus 2–20 karakter.");
    }

    // ── LAYER 4: NO CACHE — hasil unik per nickname ──

    // ── LAYER 5: Hit provider ──
    console.log(`📡 [/api/gen-lobby-ff] Fetch: "${nickname}"`);
    const response = await http.get(FAKEFF_API_BASE, {
      params: { usn: nickname },
      responseType: "arraybuffer",
      timeout: 45_000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/jpeg,image/png,image/*,*/*;q=0.8",
      },
    });

    // ── LAYER 6: Validate response ──
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);

    if (!buffer.length) throw new Error("API mengembalikan gambar kosong.");
    if (buffer.length > 15 * 1024 * 1024) throw new Error("Gambar terlalu besar.");
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error("API tidak mengembalikan file gambar yang valid.");
    }

    // ── LAYER 7: Return ──
    res.set("Content-Type", contentType || "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.set("X-FF-Nickname", encodeURIComponent(nickname));
    res.send(buffer);

  } catch (err) {
    console.error("❌ [/api/gen-lobby-ff]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/gen-duo-ff — Fake FF Duo Profile Generator
   ============================================================ */
const FAKEFF_DUO_API_BASE = "https://apii.nexadev.my.id/fakeffduo";

app.post("/api/gen-duo-ff", requireAuth, async (req, res) => {
  try {
    // ── LAYER 1: Bot detection ──
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/gen-duo-ff] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // ── LAYER 2: Rate limit (5/menit per IP) ──
    const identifier = req.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "gen-duo-ff", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    // ── LAYER 3: Input validation ──
    const nick1 = safeText(req.body?.nickname1, 30);
    const nick2 = safeText(req.body?.nickname2, 30);

    if (!nick1 || nick1.length < 2 || nick1.length > 20) {
      throw new Error("Nickname 1 harus 2–20 karakter.");
    }
    if (!nick2 || nick2.length < 2 || nick2.length > 20) {
      throw new Error("Nickname 2 harus 2–20 karakter.");
    }
    if (nick1.toLowerCase() === nick2.toLowerCase()) {
      throw new Error("Nickname 1 dan 2 tidak boleh sama.");
    }

    // ── LAYER 4: NO CACHE ──

    // ── LAYER 5: Hit provider ──
    console.log(`📡 [/api/gen-duo-ff] Fetch: "${nick1}" & "${nick2}"`);
    const response = await http.get(FAKEFF_DUO_API_BASE, {
      params: { nickname1: nick1, nickname2: nick2 },
      responseType: "arraybuffer",
      timeout: 45_000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/jpeg,image/png,image/*,*/*;q=0.8",
      },
    });

    // ── LAYER 6: Validate response ──
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);

    if (!buffer.length) throw new Error("API mengembalikan gambar kosong.");
    if (buffer.length > 15 * 1024 * 1024) throw new Error("Gambar terlalu besar.");
    if (contentType && !contentType.startsWith("image/")) {
      throw new Error("API tidak mengembalikan file gambar yang valid.");
    }

    // ── LAYER 7: Return ──
    res.set("Content-Type", contentType || "image/jpeg");
    res.set("Cache-Control", "no-store");
    res.set("X-FF-Duo", encodeURIComponent(`${nick1}|${nick2}`));
    res.send(buffer);

  } catch (err) {
    console.error("❌ [/api/gen-duo-ff]", err.message);
    sendError(res, err);
  }
});

/* ============================================================
   /api/brat-vid — Brat Video Generator
   ============================================================ */
const BRAT_VID_API_BASE = "https://apii.nexadev.my.id/bratvid2";

app.post("/api/brat-vid", requireAuth, async (req, res) => {
  try {
    // ── LAYER 1: Bot detection ──
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/brat-vid] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // ── LAYER 2: Rate limit (3/menit — video lebih berat) ──
    const identifier = req.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "brat-vid", 3);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    // ── LAYER 3: Input validation ──
    const text = safeText(req.body?.text, 200);
    if (!text || text.length < 1) {
      throw new Error("Teks tidak boleh kosong.");
    }
    if (text.length > 200) {
      throw new Error("Teks maksimal 200 karakter.");
    }

    // ── LAYER 4: NO CACHE — setiap video unique ──

    // ── LAYER 5: Hit provider ──
    console.log(`📡 [/api/brat-vid] Fetch: "${text.slice(0, 50)}"`);
    const response = await http.get(BRAT_VID_API_BASE, {
      params: { text },
      responseType: "arraybuffer",
      timeout: 90_000,
      maxContentLength: 50 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "video/mp4,video/*,*/*",
      },
    });

    // ── LAYER 6: Validate response ──
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);

    if (!buffer.length) throw new Error("Video yang diterima kosong.");
    if (buffer.length > 50 * 1024 * 1024) throw new Error("Video terlalu besar.");

    // Validate MP4 magic bytes
    const isMp4 = buffer.length >= 12 &&
      buffer.subarray(4, 8).toString("ascii") === "ftyp";

    if (!contentType.startsWith("video/") && !isMp4) {
      throw new Error("API tidak mengembalikan file video yang valid.");
    }

    // ── LAYER 7: Return ──
    res.set("Content-Type", contentType.startsWith("video/") ? contentType : "video/mp4");
    res.set("Cache-Control", "no-store");
    res.set("Content-Disposition", 'inline; filename="xavrels-brat.mp4"');
    res.send(buffer);

  } catch (err) {
    console.error("❌ [/api/brat-vid]", err.message);
    sendError(res, err);
  }
});


/* ============================================================
   /api/gen-dana — Fake Dana Balance Generator
   ============================================================ */
const FAKEDANA_API_BASE = "https://api.ikyyxd.my.id/canvas/fakedana";

app.post("/api/gen-dana", requireAuth, async (req, res) => {
  try {
    // ── LAYER 1: Bot detection ──
    if (isLikelyBot(req)) {
      console.log(`🚫 [/api/gen-dana] Bot detected`);
      return res.status(403).json({ ok: false, error: "Akses ditolak." });
    }

    // ── LAYER 2: Rate limit (5/menit) ──
    const identifier = req.ip || "unknown";
    const limit = checkEndpointLimit(identifier, "gen-dana", 5);
    if (!limit.ok) {
      res.set("Retry-After", String(Math.ceil((limit.resetAt - Date.now()) / 1000)));
      return res.status(429).json({ ok: false, error: "Terlalu banyak request. Tunggu sebentar." });
    }

    // ── LAYER 3: Input validation ──
    const amount = parseInt(req.body?.amount, 10);
    if (!Number.isFinite(amount)) {
      throw new Error("Amount harus berupa angka.");
    }
    if (amount < 1000) {
      throw new Error("Amount minimal Rp 1.000.");
    }
    if (amount > 100_000_000) {
      throw new Error("Amount maksimal Rp 100.000.000.");
    }

    // ── LAYER 4: NO CACHE — setiap amount unique ──

    // ── LAYER 5: Hit provider ──
    console.log(`📡 [/api/gen-dana] Fetch: amount=${amount}`);
    const response = await http.get(FAKEDANA_API_BASE, {
      params: { amount },
      responseType: "arraybuffer",
      timeout: 45_000,
      maxContentLength: 15 * 1024 * 1024,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "image/png,image/jpeg,image/*,*/*;q=0.8",
      },
    });

    // ── LAYER 6: Validate response ──
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    const buffer = Buffer.from(response.data);

    if (!buffer.length) throw new Error("API mengembalikan gambar kosong.");
    if (buffer.length > 15 * 1024 * 1024) throw new Error("Gambar terlalu besar.");

    // Cek PNG magic bytes (89 50 4E 47) atau JPEG (FF D8 FF)
    const isPng = buffer.length >= 8 &&
      buffer[0] === 0x89 && buffer[1] === 0x50 &&
      buffer[2] === 0x4E && buffer[3] === 0x47;
    const isJpg = buffer.length >= 3 &&
      buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;

    if (!isPng && !isJpg && !contentType.startsWith("image/")) {
      throw new Error("API tidak mengembalikan file gambar yang valid.");
    }

    // ── LAYER 7: Return ──
    res.set("Content-Type", contentType.startsWith("image/") ? contentType : "image/png");
    res.set("Cache-Control", "no-store");
    res.set("X-Dana-Amount", String(amount));
    res.set("Content-Disposition", 'inline; filename="xavrels-dana.png"');
    res.send(buffer);

  } catch (err) {
    console.error("❌ [/api/gen-dana]", err.message);
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
