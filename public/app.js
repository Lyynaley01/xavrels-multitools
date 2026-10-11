/* =========================================================
   XAVRELS MULTITOOLS — Main Script (FINAL)
   ========================================================= */

/* ===== Block Zoom ===== */
document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturechange', e => e.preventDefault(), { passive: false });
document.addEventListener('gestureend', e => e.preventDefault(), { passive: false });

document.addEventListener('wheel', (e) => {
  if (e.ctrlKey) e.preventDefault();
}, { passive: false });

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && ['+', '-', '=', '0'].includes(e.key)) {
    e.preventDefault();
  }
});
/* ===== End Block Zoom ===== */


/* ===== Helpers ===== */
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);


/* =========================================================
   SESSION TOKEN
   ========================================================= */
let sessionToken = null;
let sessionExpiresAt = 0;
let sessionPromise = null;

async function ensureSession() {
  const now = Date.now();
  if (sessionToken && sessionExpiresAt > now + 30_000) return sessionToken;
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.ok || !data.token) throw new Error("Token tidak valid");
      sessionToken = data.token;
      sessionExpiresAt = now + (data.expiresIn || 600) * 1000;
      console.log("[SESSION] Token refreshed, expired at", new Date(sessionExpiresAt).toLocaleTimeString());
      return sessionToken;
    } catch (err) {
      console.error("[SESSION] Gagal ambil token:", err.message);
      throw err;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

ensureSession().catch(() => {});
setInterval(() => { ensureSession().catch(() => {}); }, 8 * 60 * 1000);


/* ===== Element cache ===== */
const homeView = $("#homeView");
const toolView = $("#toolView");
const form = $("#toolForm");
const input = $("#toolInput");
const extra = $("#toolExtra");
const submit = $("#submitBtn");
const submitLabel = $("#submitLabel");
const resultArea = $("#resultArea");
const resultShell = $("#resultShell");
const inputTabs = $("#inputTabs");
const modeUrl = $("#modeUrl");
const modeUpload = $("#modeUpload");
const dropzone = $("#dropzone");
const fileInput = $("#fileInput");
const dropzoneInner = $("#dropzoneInner");
const dropzonePreview = $("#dropzonePreview");
const previewImg = $("#previewImg");
const previewName = $("#previewName");
const previewSize = $("#previewSize");
const clearFile = $("#clearFile");

let activeTool = null;
let telegramUrl = "https://t.me/";
let activeObjectUrl = null;
let activeBeforeUrl = null;
let selectedFile = null;
let inputMode = "url";


/* ===== Tool config ===== */
const toolInfo = {
  hd: {
    title: "HD IMAGE", titleLead: "HD", titleAccent: "IMAGE", issue: "TOOL 01", number: "01",
    category: "IMAGE LAB", icon: "▧",
    description: "Naikkan resolusi gambar dengan proses upscale. Bisa via link atau upload file langsung.",
    tip: "Upload file langsung lebih praktis — atau tempel direct link HTTPS.",
    label: "Direct image URL (HTTPS)", placeholder: "https://example.com/photo.jpg", inputType: "url",
    endpoint: "api/hd", button: "UPSCALE IMAGE",
    supportsUpload: true
  },
  "remove-bg": {
    title: "REMOVE BG", titleLead: "REMOVE", titleAccent: "BG", issue: "TOOL 02", number: "02",
    category: "IMAGE LAB", icon: "✂",
    description: "Bersihkan latar belakang gambar. Bisa via link atau upload file langsung.",
    tip: "Upload file langsung lebih praktis — atau tempel direct link HTTPS.",
    label: "Direct image URL (HTTPS)", placeholder: "https://example.com/photo.jpg", inputType: "url",
    endpoint: "api/remove-bg", button: "REMOVE BACKGROUND",
    supportsUpload: true
  },
  react: {
    title: "WA CHANNEL REACT", titleLead: "WA CHANNEL", titleAccent: "REACT", issue: "TOOL 03", number: "03",
    category: "SOCIAL TOOLS", icon: "⚡",
    description: "Kirim permintaan reaksi untuk postingan channel WhatsApp dengan langkah yang simpel.",
    tip: "Gunakan link postingan channel WhatsApp, bukan link undangan grup.",
    label: "WhatsApp channel post URL", placeholder: "https://whatsapp.com/channel/...", inputType: "url",
    endpoint: "api/react", button: "SEND REACTION",
    supportsUpload: false
  },
  pinterest: {
    title: "PINTEREST SEARCH", titleLead: "PINTEREST", titleAccent: "SEARCH", issue: "TOOL 04", number: "04",
    category: "DISCOVER LAB", icon: "⌕",
    description: "Temukan inspirasi visual berdasarkan keyword dan jelajahi hasilnya dalam grid yang seimbang.",
    tip: "Gunakan keyword spesifik agar hasil pencarian lebih relevan.",
    label: "Keyword pencarian", placeholder: "spider comic wallpaper", inputType: "text",
    endpoint: "api/pinterest", button: "SEARCH IMAGES",
    supportsUpload: false
  },
  spotify: {
    title: "MUSIC FINDER", titleLead: "MUSIC", titleAccent: "FINDER", issue: "TOOL 05", number: "05",
    category: "MUSIC LAB", icon: "♫",
    description: "Cari lagu berdasarkan judul atau artis, lalu putar langsung di sini.",
    tip: "Coba kombinasi judul lagu dan nama artis untuk hasil yang lebih tepat.",
    label: "Judul lagu atau nama artis", placeholder: "judul lagu atau nama artis", inputType: "text",
    endpoint: "api/spotify", button: "FIND MUSIC",
    supportsUpload: false
  }
};

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"];


["homeView","toolView","toolForm","toolInput","toolExtra","submitBtn","submitLabel","resultArea","resultShell"].forEach(id => {
  if (!document.getElementById(id)) console.error(`[XAVRELS] Elemen #${id} tidak ditemukan di DOM!`);
});


/* ===== Telegram config ===== */
if (location.protocol !== "file:") {
  fetch("api/config")
    .then(response => response.ok ? response.json() : null)
    .then(config => {
      if (config?.telegramBotUrl) telegramUrl = config.telegramBotUrl;
      const amprem = $("#ampremLink");
      if (amprem) amprem.href = telegramUrl;
    })
    .catch(() => {});
}


/* =========================================================
   FILE UPLOAD
   ========================================================= */
function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1) + " " + sizes[i];
}

function setFile(file) {
  if (!file) return;
  if (!ALLOWED_TYPES.includes(file.type)) {
    showMessage("Format file tidak didukung. Gunakan PNG, JPG, WEBP, atau GIF.", "error");
    return;
  }
  if (file.size > MAX_UPLOAD_SIZE) {
    showMessage(`File terlalu besar (${formatBytes(file.size)}). Maksimal 10 MB.`, "error");
    return;
  }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = (ev) => {
    previewImg.src = ev.target.result;
    previewName.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);
    dropzoneInner.hidden = true;
    dropzonePreview.hidden = false;
    clearResult();
  };
  reader.readAsDataURL(file);
}

function clearSelectedFile() {
  selectedFile = null;
  if (fileInput) fileInput.value = "";
  if (previewImg) previewImg.src = "";
  if (dropzoneInner) dropzoneInner.hidden = false;
  if (dropzonePreview) dropzonePreview.hidden = true;
}

if (dropzone) {
  dropzone.addEventListener("click", (e) => {
    if (e.target.closest(".clear-file")) return;
    fileInput.click();
  });
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "drop"].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault(); e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) setFile(file);
  });
}

if (fileInput) fileInput.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (file) setFile(file);
});

if (clearFile) clearFile.addEventListener("click", (e) => {
  e.stopPropagation();
  clearSelectedFile();
});

document.addEventListener("paste", (e) => {
  if (!activeTool || !toolInfo[activeTool]?.supportsUpload) return;
  if (inputMode !== "upload") return;
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) { e.preventDefault(); setFile(file); break; }
    }
  }
});


/* ===== Input mode tabs ===== */
function switchInputMode(mode) {
  inputMode = mode;
  $$(".input-tab").forEach(tab => tab.classList.toggle("active", tab.dataset.mode === mode));
  if (mode === "url") {
    if (modeUrl) modeUrl.hidden = false;
    if (modeUpload) modeUpload.hidden = true;
  } else {
    if (modeUrl) modeUrl.hidden = true;
    if (modeUpload) modeUpload.hidden = false;
  }
  clearResult();
}

if (inputTabs) inputTabs.addEventListener("click", (e) => {
  const tab = e.target.closest(".input-tab");
  if (!tab) return;
  e.preventDefault();
  switchInputMode(tab.dataset.mode);
});


/* =========================================================
   RESULT HELPERS
   ========================================================= */
function clearResult() {
  if (activeObjectUrl) { URL.revokeObjectURL(activeObjectUrl); activeObjectUrl = null; }
  if (activeBeforeUrl && activeBeforeUrl.startsWith("blob:")) { URL.revokeObjectURL(activeBeforeUrl); activeBeforeUrl = null; }
  if (resultArea) resultArea.replaceChildren();
  if (resultShell) resultShell.hidden = true;
  const note = $("#resultHeadingNote");
  if (note) note.textContent = "Output akan muncul di sini";
}

function showMessage(message, type = "") {
  if (!resultShell || !resultArea) return null;
  resultShell.hidden = false;
  resultArea.replaceChildren();
  const card = document.createElement("div");
  card.className = `result-msg ${type}`;
  card.textContent = message;
  resultArea.append(card);
  const note = $("#resultHeadingNote");
  if (note) note.textContent = type === "error" ? "Perlu diperiksa" : type === "loading" ? "Sedang diproses" : "Selesai";
  return card;
}


/* =========================================================
   RENDER IMAGE RESULT
   ========================================================= */
function renderImageResult(response) {
  return response.blob().then(blob => {
    activeObjectUrl = URL.createObjectURL(blob);
    resultShell.hidden = false;
    resultArea.replaceChildren();

    activeBeforeUrl = null;
    if (activeTool === "hd" || activeTool === "remove-bg") {
      if (selectedFile) activeBeforeUrl = URL.createObjectURL(selectedFile);
      else if (input.value.trim()) activeBeforeUrl = input.value.trim();
    }

    const canShowBeforeAfter = activeTool === "hd" && !!activeBeforeUrl;

    const card = document.createElement("article");
    card.className = "image-result-card";

    const preview = document.createElement("div");
    preview.className = "image-preview-stage";

    const image = document.createElement("img");
    image.className = "result-img";
    image.alt = `Hasil ${toolInfo[activeTool].title}`;
    image.src = activeObjectUrl;
    preview.append(image);

    if (canShowBeforeAfter) {
      preview.classList.add("is-clickable");
      preview.addEventListener("click", () => {
        openBeforeAfterModal({
          title: toolInfo[activeTool].title,
          beforeUrl: activeBeforeUrl,
          afterUrl: activeObjectUrl
        });
      });
    }

    const meta = document.createElement("div");
    meta.className = "image-result-meta";

    const info = document.createElement("div");
    info.className = "image-result-info";
    info.innerHTML = "<strong>Image processed</strong><span>Preview hasil kamu siap.</span>";

    const actions = document.createElement("div");
    actions.className = "image-result-actions";

    if (canShowBeforeAfter) {
      const baBtn = document.createElement("button");
      baBtn.type = "button";
      baBtn.className = "ba-trigger-btn";
      baBtn.innerHTML = `🔍 <span>BEFORE / AFTER</span>`;
      baBtn.addEventListener("click", () => {
        openBeforeAfterModal({
          title: toolInfo[activeTool].title,
          beforeUrl: activeBeforeUrl,
          afterUrl: activeObjectUrl
        });
      });
      actions.append(baBtn);
    }

    const download = document.createElement("a");
    download.className = "download-btn";
    download.href = activeObjectUrl;
    download.download = activeTool === "remove-bg" ? "xavrels-remove-bg" : "xavrels-hd";
    download.textContent = "↓  SIMPAN HASIL";
    actions.append(download);

    meta.append(info, actions);
    card.append(preview, meta);
    resultArea.append(card);

    const note = $("#resultHeadingNote");
    if (note) note.textContent = "Berhasil diproses";
  });
}


/* =========================================================
   BEFORE / AFTER MODAL
   ========================================================= */
function openBeforeAfterModal({ title, beforeUrl, afterUrl }) {
  const old = document.getElementById("baModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.className = "ba-modal-backdrop";
  modal.id = "baModal";

  modal.innerHTML = `
    <div class="ba-modal-card">
      <button class="ba-modal-close" aria-label="Tutup">✕</button>
      <div class="ba-modal-header">
        <span class="ba-modal-title">🎨 ${title} — BEFORE / AFTER</span>
        <span class="ba-modal-hint">Geser garis ke kanan atau kiri</span>
      </div>
      <div class="ba-slider" id="baSlider">
        <div class="ba-layer ba-after">
          <img src="${afterUrl}" alt="After" draggable="false">
          <span class="ba-label ba-label-after">AFTER</span>
        </div>
        <div class="ba-layer ba-before" id="baBeforeLayer">
          <img src="${beforeUrl}" alt="Before" draggable="false">
          <span class="ba-label ba-label-before">BEFORE</span>
        </div>
        <div class="ba-handle" id="baHandle" tabindex="0" role="slider"
             aria-label="Slider pembanding before after"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <div class="ba-handle-line"></div>
          <div class="ba-handle-knob">
            <span class="ba-arrow ba-arrow-left">◀</span>
            <span class="ba-arrow ba-arrow-right">▶</span>
          </div>
        </div>
      </div>
      <div class="ba-modal-actions">
        <a class="download-btn" href="${afterUrl}" download="xavrels-hd.jpg">↓ SIMPAN HASIL HD</a>
      </div>
    </div>
  `;

  document.body.append(modal);
  document.body.style.overflow = "hidden";

  const slider = modal.querySelector("#baSlider");
  const beforeLayer = modal.querySelector("#baBeforeLayer");
  const handle = modal.querySelector("#baHandle");
  let pos = 50;
  let dragging = false;

  function setPosition(percent) {
    pos = Math.max(0, Math.min(100, percent));
    beforeLayer.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
    handle.style.left = `${pos}%`;
    handle.setAttribute("aria-valuenow", String(Math.round(pos)));
  }
  function updateFromEvent(clientX) {
    const rect = slider.getBoundingClientRect();
    setPosition(((clientX - rect.left) / rect.width) * 100);
  }
  function onPointerDown(e) {
    dragging = true;
    slider.classList.add("ba-dragging");
    updateFromEvent(e.touches ? e.touches[0].clientX : e.clientX);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!dragging) return;
    updateFromEvent(e.touches ? e.touches[0].clientX : e.clientX);
    e.preventDefault();
  }
  function onPointerUp() { dragging = false; slider.classList.remove("ba-dragging"); }

  slider.addEventListener("mousedown", onPointerDown);
  window.addEventListener("mousemove", onPointerMove);
  window.addEventListener("mouseup", onPointerUp);
  slider.addEventListener("touchstart", onPointerDown, { passive: false });
  window.addEventListener("touchmove", onPointerMove, { passive: false });
  window.addEventListener("touchend", onPointerUp);
  window.addEventListener("touchcancel", onPointerUp);

  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft")  { setPosition(pos - 5); e.preventDefault(); }
    if (e.key === "ArrowRight") { setPosition(pos + 5); e.preventDefault(); }
  });

  function close() {
    document.body.style.overflow = "";
    window.removeEventListener("mousemove", onPointerMove);
    window.removeEventListener("mouseup", onPointerUp);
    window.removeEventListener("touchmove", onPointerMove);
    window.removeEventListener("touchend", onPointerUp);
    window.removeEventListener("touchcancel", onPointerUp);
    modal.remove();
  }

  modal.querySelector(".ba-modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });

  setPosition(50);
}


/* =========================================================
   RENDER PINTEREST
   ========================================================= */
function renderPinterest(data) {
  const results = Array.isArray(data.results) ? data.results : [];
  resultShell.hidden = false;
  resultArea.replaceChildren();
  const summary = document.createElement("div");
  summary.className = "result-summary";
  summary.innerHTML = `<strong>${results.length} visual ditemukan</strong><span>Pilih kartu untuk membuka gambar aslinya.</span>`;
  resultArea.append(summary);

  if (!results.length) {
    const empty = document.createElement("div");
    empty.className = "result-msg";
    empty.textContent = "Belum ada hasil untuk keyword ini. Coba kata kunci lain.";
    resultArea.append(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "pin-results";
  results.forEach((item, index) => {
    const link = document.createElement("a");
    link.className = "pin-result-card";
    link.href = item.image_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.loading = "lazy";
    image.src = item.image_url;
    image.alt = item.title || `Pinterest result ${index + 1}`;
    const caption = document.createElement("span");
    caption.textContent = item.title || `Visual ${index + 1}`;
    link.append(image, caption);
    grid.append(link);
  });
  resultArea.append(grid);
  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${results.length} visual`;
}


/* =========================================================
   RENDER MUSIC — hero + YouTube embed
   ========================================================= */
function renderMusic(data) {
  const item = data.result || {};
  resultShell.hidden = false;
  resultArea.replaceChildren();

  const card = document.createElement("article");
  card.className = "music-result-card";

  /* ===== HERO — cover Spotify HD ===== */
  const hero = document.createElement("div");
  hero.className = "music-hero";

  if (item.cover) {
    const bg = document.createElement("div");
    bg.className = "music-hero-bg";
    bg.style.backgroundImage = `url("${item.cover}")`;
    hero.append(bg);
  }

  const heroOverlay = document.createElement("div");
  heroOverlay.className = "music-hero-overlay";

  const cover = document.createElement("div");
  cover.className = "music-hero-cover";
  if (item.cover) {
    const img = document.createElement("img");
    img.src = item.cover;
    img.alt = "Cover lagu";
    img.loading = "lazy";
    cover.append(img);
  } else {
    cover.textContent = "♫";
  }
  heroOverlay.append(cover);

  const heroInfo = document.createElement("div");
  heroInfo.className = "music-hero-info";

  const titleEl = document.createElement("h2");
  titleEl.className = "music-hero-title";
  titleEl.textContent = item.title || "Judul tidak diketahui";

  const artistEl = document.createElement("p");
  artistEl.className = "music-hero-artist";
  artistEl.textContent = item.artist || "Artis tidak diketahui";

  heroInfo.append(titleEl, artistEl);

  const metaRow = document.createElement("div");
  metaRow.className = "music-hero-meta";

  if (item.duration) {
    const dur = document.createElement("span");
    dur.className = "music-meta-chip";
    dur.innerHTML = `◷ <b>${item.duration}</b>`;
    metaRow.append(dur);
  }
  if (item.year) {
    const yr = document.createElement("span");
    yr.className = "music-meta-chip";
    yr.innerHTML = `📅 <b>${item.year}</b>`;
    metaRow.append(yr);
  }
  if (item.album) {
    const alb = document.createElement("span");
    alb.className = "music-meta-chip";
    alb.textContent = `💿 ${item.album}`;
    metaRow.append(alb);
  }

  heroInfo.append(metaRow);
  heroOverlay.append(heroInfo);
  hero.append(heroOverlay);
  card.append(hero);

  /* ===== HTML5 Audio Player ===== */
  if (item.audio) {
  const playerWrap = document.createElement("div");
  playerWrap.className = "music-player";
  card.append(playerWrap);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.controlsList = "nodownload";

  // Placeholder loading dulu
  const loadingText = document.createElement("div");
  loadingText.className = "music-player-loading";
  loadingText.textContent = "⏳ Menyiapkan audio...";
  playerWrap.append(loadingText);

  // Async: pastikan sessionToken siap dulu, baru set src
  (async () => {
    try {
      const token = await ensureSession();
      const streamUrl = `/api/stream?url=${encodeURIComponent(item.audio)}&token=${encodeURIComponent(token)}`;
      console.log("[MUSIC] Setting audio src:", streamUrl.slice(0, 100) + "...");
      audio.src = streamUrl;

      audio.addEventListener("loadedmetadata", () => {
        console.log("[MUSIC] Audio metadata loaded ✅");
        loadingText.remove();
        playerWrap.append(audio);
      });

      audio.addEventListener("error", (e) => {
        console.error("[MUSIC] Audio error:", e, audio.error);
        playerWrap.innerHTML = `<div class="music-player-error">🎵 Audio tidak dapat diputar. Coba refresh halaman.</div>`;
      });

      // Fallback timeout — kalau 15 detik gak load, tampilkan audio langsung
      setTimeout(() => {
        if (loadingText.parentNode) {
          loadingText.remove();
          playerWrap.append(audio);
        }
      }, 15000);

    } catch (err) {
      console.error("[MUSIC] Gagal ambil session token:", err);
      playerWrap.innerHTML = `<div class="music-player-error">🎵 Gagal menyiapkan audio: ${err.message}</div>`;
    }
  })();
}

  /* ===== Actions ===== */
  const actions = document.createElement("div");
  actions.className = "music-actions";

  if (item.spotifyUrl) {
    const spotify = document.createElement("a");
    spotify.className = "download-btn music-spotify-btn";
    spotify.href = item.spotifyUrl;
    spotify.target = "_blank";
    spotify.rel = "noopener noreferrer";
    spotify.textContent = "🎧  BUKA DI SPOTIFY";
    actions.append(spotify);
  }

  if (actions.children.length) card.append(actions);

  resultArea.append(card);

  const note = $("#resultHeadingNote");
  if (note) note.textContent = "Lagu ditemukan";
}


/* =========================================================
   TOOL NAVIGATION
   ========================================================= */
function openTool(key, updateHistory = true) {
  if (key === "amprem") {
    window.open(telegramUrl, "_blank", "noopener,noreferrer");
    return;
  }
  const info = toolInfo[key];
  if (!info) { console.warn("[XAVRELS] Tool tidak dikenal:", key); return; }

  activeTool = key;
  homeView.hidden = true;
  toolView.hidden = false;
  document.body.classList.add("tool-page-active");

  $("#workspaceIssue").textContent = info.issue;
  $("#workspaceIcon").textContent = info.icon;
  $("#workspaceCategory").textContent = info.category;

  const titleEl = $("#workspaceTitle");
  titleEl.replaceChildren();
  const lead = document.createElement("span"); lead.textContent = info.titleLead;
  const accent = document.createElement("span"); accent.className = "title-accent"; accent.textContent = info.titleAccent;
  titleEl.append(lead, document.createTextNode(" "), accent);

  $("#workspaceDescription").textContent = info.description;
  $("#workspaceTip").textContent = info.tip;
  $("#panelNumber").textContent = info.number;
  $("#inputLabel").textContent = info.label;

  input.type = info.inputType;
  input.placeholder = info.placeholder;
  input.value = "";
  input.autocomplete = info.inputType === "url" ? "url" : "off";

  clearSelectedFile();
  if (info.supportsUpload) {
    if (inputTabs) inputTabs.hidden = false;
    switchInputMode("url");
  } else {
    if (inputTabs) inputTabs.hidden = true;
    if (modeUrl) modeUrl.hidden = false;
    if (modeUpload) modeUpload.hidden = true;
    inputMode = "url";
  }

  $("#secondField").hidden = key !== "react";
  extra.value = "";
  extra.required = key === "react";

  submit.disabled = false;
  submitLabel.textContent = info.button;

  clearResult();
  document.title = `${info.title} — XAVRELS MULTITOOLS`;

  if (updateHistory && location.hash !== `#tool/${key}`) location.hash = `tool/${key}`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  setTimeout(() => { if (inputMode === "url") input.focus({ preventScroll: true }); }, 180);
}

function goHome(updateHistory = true) {
  activeTool = null;
  toolView.hidden = true;
  homeView.hidden = false;
  document.body.classList.remove("tool-page-active");
  document.title = "XAVRELS // MULTITOOLS";
  clearResult();
  clearSelectedFile();
  if (updateHistory && location.hash) history.pushState(null, "", `${location.pathname}${location.search}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function syncRoute() {
  const match = location.hash.match(/^#tool\/(hd|remove-bg|react|pinterest|spotify)$/);
  if (match) openTool(match[1], false);
  else goHome(false);
}


/* =========================================================
   EVENT DELEGATION
   ========================================================= */
let lastOpenTime = 0;
function handleOpenClick(e) {
  const btn = e.target.closest("[data-open]");
  if (!btn) return;
  const now = Date.now();
  if (now - lastOpenTime < 250) return;
  lastOpenTime = now;
  e.preventDefault();
  e.stopPropagation();
  const key = btn.dataset.open;
  console.log("[XAVRELS] Opening tool:", key);
  openTool(key);
}
document.addEventListener("click", handleOpenClick, true);
document.addEventListener("pointerup", (e) => {
  const btn = e.target.closest("[data-open]");
  if (!btn) return;
  if (e.pointerType === "touch") handleOpenClick(e);
}, true);

document.addEventListener("click", (e) => {
  if (e.target.closest("#backHome")) { e.preventDefault(); goHome(true); }
}, true);

window.addEventListener("hashchange", syncRoute);
window.addEventListener("popstate", syncRoute);


/* ===== Search ===== */
const searchInput = $("#searchInput");
if (searchInput) {
  searchInput.addEventListener("input", event => {
    const query = event.target.value.trim().toLowerCase();
    let visible = 0;
    document.querySelectorAll(".tool-card").forEach(card => {
      const show = card.innerText.toLowerCase().includes(query);
      card.hidden = !show;
      if (show) visible++;
    });
    const empty = $("#emptyState");
    if (empty) empty.hidden = visible > 0;
  });
}


/* =========================================================
   SUBMIT FORM
   ========================================================= */
if (form) {
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const info = toolInfo[activeTool];
    if (!info) return;

    let fetchOptions;
    const isUploadMode = info.supportsUpload && inputMode === "upload";

    if (isUploadMode) {
      if (!selectedFile) { showMessage("Pilih file gambar dulu, atau switch ke mode URL.", "error"); return; }
      const fd = new FormData();
      fd.append("image", selectedFile, selectedFile.name);
      fetchOptions = { method: "POST", body: fd };
    } else {
      const value = input.value.trim();
      if (!value) return;
      const payload = (activeTool === "pinterest" || activeTool === "spotify")
        ? { query: value }
        : { url: value };
      if (activeTool === "react") payload.emoji = extra.value.trim();
      fetchOptions = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      };
    }

    submit.disabled = true;
    submitLabel.textContent = "PROCESSING...";
    showMessage("Sedang menghubungi provider dengan aman. Tunggu sebentar…", "loading");

    try {
      const token = await ensureSession();
      if (!fetchOptions.headers) fetchOptions.headers = {};
      fetchOptions.headers["X-Session-Token"] = token;

      let response = await fetch(info.endpoint, fetchOptions);

      if (response.status === 401) {
        console.warn("[SESSION] 401 — refresh token & retry");
        sessionToken = null; sessionExpiresAt = 0;
        const newToken = await ensureSession();
        fetchOptions.headers["X-Session-Token"] = newToken;
        response = await fetch(info.endpoint, fetchOptions);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) {
        let message = `Request gagal (HTTP ${response.status}).`;
        if (contentType.includes("application/json")) {
          const errorData = await response.json();
          message = errorData.error || message;
        }
        throw new Error(message);
      }

      if (contentType.startsWith("image/")) {
        await renderImageResult(response);
      } else {
        const data = await response.json();
        if (!data.ok) throw new Error(data.error || "Request gagal.");
        if (activeTool === "pinterest") renderPinterest(data);
        else if (activeTool === "spotify") renderMusic(data);
        else showMessage(data.message || "Permintaan reaksi berhasil dikirim ke provider.");
      }
    } catch (error) {
      showMessage(error.message || "Terjadi kesalahan. Coba lagi nanti.", "error");
    } finally {
      submit.disabled = false;
      submitLabel.textContent = info.button;
    }
  });
}


/* ===== Start ===== */
syncRoute();
console.log("[XAVRELS] Tools loaded:", Object.keys(toolInfo));
console.log("[XAVRELS] Tombol data-open:", document.querySelectorAll("[data-open]").length);
console.log("[XAVRELS] switchInputMode:", typeof switchInputMode);
console.log("[XAVRELS] supportsUpload hd:", toolInfo.hd.supportsUpload);
