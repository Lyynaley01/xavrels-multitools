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
  fpreset: {
  title: "AM PRESET FINDER", titleLead: "AM PRESET", titleAccent: "FINDER", issue: "TOOL 06", number: "06",
  category: "PRESET LAB", icon: "🎬",
  description: "Cari preset Alight Motion dari link video TikTok yang kamu berikan.",
  tip: "Gunakan link video TikTok, contoh: https://www.tiktok.com/@user/video/123",
  label: "Link video TikTok", placeholder: "https://www.tiktok.com/@user/video/...", inputType: "url",
  endpoint: "api/fpreset", button: "FIND PRESET",
  supportsUpload: false
},
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

    const canShowBeforeAfter = (activeTool === "hd" || activeTool === "remove-bg") && !!activeBeforeUrl;

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
  summary.innerHTML = `<strong>${results.length} visual ditemukan</strong><span>Klik kartu untuk melihat detail.</span>`;
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pin-result-card";
    btn.style.animationDelay = `${index * 40}ms`;

    const img = document.createElement("img");
    img.loading = "lazy";
    img.src = item.image_url;
    img.alt = item.title || `Pinterest ${index + 1}`;
    img.onerror = () => {
      // Fallback kalau gambar gagal load
      img.style.background = "#eef0f4";
      img.alt = "Gagal memuat";
    };

    const overlay = document.createElement("div");
    overlay.className = "pin-result-overlay";

    const caption = document.createElement("div");
caption.className = "pin-result-caption";
caption.textContent = item.title || `Visual ${index + 1}`;

const zoom = document.createElement("div");
zoom.className = "pin-result-zoom";
zoom.textContent = "🔍";

    overlay.append(caption, zoom);
    btn.append(img, overlay);

    btn.addEventListener("click", () => openPinModal(item));

    grid.append(btn);
  });

  resultArea.append(grid);

  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${results.length} visual`;
}


/* =========================================================
   PIN DETAIL MODAL
   ========================================================= */
function openPinModal(item) {
  const old = document.getElementById("pinModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.className = "pin-modal-backdrop";
  modal.id = "pinModal";

  // Format followers
  const followersText = (() => {
    if (item.author?.followers === null || item.author?.followers === undefined) return "";
    const n = Number(item.author.followers);
    if (isNaN(n)) return "";
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  })();

  const hasAuthor = item.author && (item.author.name || item.author.username);
  const hasPinUrl = !!item.pin_url;

  modal.innerHTML = `
    <div class="pin-modal-card">
      <button class="pin-modal-close" aria-label="Tutup">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>

      <div class="pin-modal-image-wrap">
        <img class="pin-modal-img" src="${item.image_url}" alt="${item.title || 'Pinterest image'}">
        <div class="pin-modal-skeleton"></div>
      </div>

      <div class="pin-modal-info">
        <h3 class="pin-modal-title">${item.title || "Pinterest Image"}</h3>

        ${hasAuthor ? `
          <div class="pin-modal-author">
            <div class="pin-modal-author-avatar">
              ${(item.author.name || item.author.username || "?").trim().charAt(0).toUpperCase()}
            </div>
            <div class="pin-modal-author-meta">
              <strong>${item.author.name || item.author.username || "Anonim"}</strong>
              <span>
                ${item.author.username ? `@${item.author.username}` : ""}
                ${followersText ? ` · ${followersText} followers` : ""}
              </span>
            </div>
          </div>
        ` : ""}

        <div class="pin-modal-actions">
          ${hasPinUrl ? `
            <a class="pin-modal-btn pin-modal-btn-primary" href="${item.pin_url}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 0C5.373 0 0 5.372 0 12c0 5.084 3.163 9.426 7.627 11.174-.105-.949-.2-2.405.042-3.441.218-.937 1.407-5.965 1.407-5.965s-.359-.719-.359-1.782c0-1.668.967-2.914 2.171-2.914 1.023 0 1.518.769 1.518 1.69 0 1.029-.655 2.568-.994 3.995-.283 1.194.599 2.169 1.777 2.169 2.133 0 3.772-2.249 3.772-5.495 0-2.873-2.064-4.882-5.012-4.882-3.414 0-5.418 2.561-5.418 5.207 0 1.031.397 2.138.893 2.738.098.119.112.224.083.345l-.333 1.36c-.053.22-.174.267-.402.161-1.499-.698-2.436-2.889-2.436-4.649 0-3.785 2.75-7.262 7.929-7.262 4.163 0 7.398 2.967 7.398 6.931 0 4.136-2.607 7.464-6.227 7.464-1.216 0-2.359-.631-2.75-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0z"/></svg>
              <span>Lihat di Pinterest</span>
            </a>
          ` : ""}

          <a class="pin-modal-btn pin-modal-btn-secondary" href="${item.image_url}" target="_blank" rel="noopener noreferrer" download>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Buka Gambar HD</span>
          </a>
        </div>
      </div>
    </div>
  `;

  document.body.append(modal);
  document.body.style.overflow = "hidden";

  const img = modal.querySelector(".pin-modal-img");
  const skeleton = modal.querySelector(".pin-modal-skeleton");

  // Hilangkan skeleton saat gambar load
  img.addEventListener("load", () => {
    skeleton.style.opacity = "0";
    setTimeout(() => skeleton.remove(), 300);
  });
  img.addEventListener("error", () => {
    skeleton.remove();
    img.alt = "Gagal memuat gambar";
  });

  // Kalau gambar udah ke-cache, langsung hilangkan skeleton
  if (img.complete && img.naturalWidth > 0) {
    skeleton.remove();
  }

  function close() {
    document.body.style.overflow = "";
    modal.style.animation = "pinFadeOut 0.2s ease forwards";
    const card = modal.querySelector(".pin-modal-card");
    if (card) card.style.animation = "pinPopOut 0.2s ease forwards";
    setTimeout(() => modal.remove(), 200);
  }

  modal.querySelector(".pin-modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });

  // Swipe down untuk close di HP
  let touchStartY = 0;
  let touchCurrentY = 0;
  const card = modal.querySelector(".pin-modal-card");
  card.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
    touchCurrentY = touchStartY;
  }, { passive: true });
  card.addEventListener("touchmove", (e) => {
    touchCurrentY = e.touches[0].clientY;
    const diff = touchCurrentY - touchStartY;
    if (diff > 0) {
      card.style.transform = `translateY(${diff * 0.4}px)`;
      card.style.opacity = String(Math.max(0.5, 1 - diff / 400));
    }
  }, { passive: true });
  card.addEventListener("touchend", () => {
    const diff = touchCurrentY - touchStartY;
    if (diff > 100) {
      close();
    } else {
      card.style.transform = "";
      card.style.opacity = "";
    }
  }, { passive: true });
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
  playerWrap.className = "custom-audio-player";

  // Audio element (hidden, cuma buat kontrol programatik)
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  audio.style.display = "none";

  // Play/Pause button
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.className = "cap-play-btn";
  playBtn.setAttribute("aria-label", "Play");
  playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

  // Current time
  const currentTime = document.createElement("span");
  currentTime.className = "cap-time cap-current";
  currentTime.textContent = "0:00";

  // Progress bar container
  const progressWrap = document.createElement("div");
  progressWrap.className = "cap-progress";
  progressWrap.setAttribute("role", "slider");
  progressWrap.setAttribute("aria-label", "Seek");
  progressWrap.tabIndex = 0;

  const progressBg = document.createElement("div");
  progressBg.className = "cap-progress-bg";

  const progressFill = document.createElement("div");
  progressFill.className = "cap-progress-fill";

  const progressThumb = document.createElement("div");
  progressThumb.className = "cap-progress-thumb";

  progressWrap.append(progressBg, progressFill, progressThumb);

  // Duration
  const durationEl = document.createElement("span");
  durationEl.className = "cap-time cap-duration";
  durationEl.textContent = item.duration || "0:00";

  playerWrap.append(playBtn, currentTime, progressWrap, durationEl, audio);

  card.append(playerWrap);

  // ===== Logic =====
  let retried = false;

  function fmtTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    return `${m}:${s}`;
  }

  function updateProgress() {
    const dur = audio.duration;
    const cur = audio.currentTime;
    if (dur && !isNaN(dur)) {
      const pct = (cur / dur) * 100;
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;
      currentTime.textContent = fmtTime(cur);
      durationEl.textContent = fmtTime(dur);
    }
  }

  function updatePlayState() {
    if (audio.paused) {
      playBtn.classList.remove("is-playing");
      playBtn.setAttribute("aria-label", "Play");
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    } else {
      playBtn.classList.add("is-playing");
      playBtn.setAttribute("aria-label", "Pause");
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
    }
  }

  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      audio.play().catch(e => console.error("[MUSIC] play error:", e));
    } else {
      audio.pause();
    }
  });

  audio.addEventListener("play", updatePlayState);
  audio.addEventListener("pause", updatePlayState);
  audio.addEventListener("timeupdate", updateProgress);
  audio.addEventListener("loadedmetadata", updateProgress);

  // ===== Seek via click/drag di progress bar =====
  let dragging = false;

  function seekTo(clientX) {
    const rect = progressWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (audio.duration && !isNaN(audio.duration)) {
      audio.currentTime = pct * audio.duration;
      updateProgress();
    }
  }

  progressWrap.addEventListener("mousedown", (e) => {
    dragging = true;
    progressWrap.classList.add("is-dragging");
    seekTo(e.clientX);
    e.preventDefault();
  });
  progressWrap.addEventListener("touchstart", (e) => {
    dragging = true;
    progressWrap.classList.add("is-dragging");
    seekTo(e.touches[0].clientX);
    e.preventDefault();
  }, { passive: false });

  window.addEventListener("mousemove", (e) => {
    if (dragging) seekTo(e.clientX);
  });
  window.addEventListener("touchmove", (e) => {
    if (dragging) seekTo(e.touches[0].clientX);
  }, { passive: false });

  window.addEventListener("mouseup", () => {
    dragging = false;
    progressWrap.classList.remove("is-dragging");
  });
  window.addEventListener("touchend", () => {
    dragging = false;
    progressWrap.classList.remove("is-dragging");
  });

  // Keyboard seek
  progressWrap.addEventListener("keydown", (e) => {
    if (!audio.duration) return;
    if (e.key === "ArrowLeft") {
      audio.currentTime = Math.max(0, audio.currentTime - 5);
      updateProgress();
      e.preventDefault();
    }
    if (e.key === "ArrowRight") {
      audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
      updateProgress();
      e.preventDefault();
    }
    if (e.key === " ") {
      playBtn.click();
      e.preventDefault();
    }
  });

  // ===== Error handler + retry =====
  audio.addEventListener("error", async () => {
    console.error("[MUSIC] Audio error:", audio.error?.code, audio.error?.message);

    if (!retried) {
      retried = true;
      console.log("[MUSIC] Retry dengan token fresh...");
      try {
        sessionToken = null;
        sessionExpiresAt = 0;
        const newToken = await ensureSession();
        audio.src = `/api/stream?url=${encodeURIComponent(item.audio)}&token=${encodeURIComponent(newToken)}`;
        audio.load();
        return;
      } catch (err2) {
        console.error("[MUSIC] Retry gagal:", err2);
      }
    }

    playerWrap.innerHTML = `<div style="padding:14px;text-align:center;background:#fff8df;border:1.5px solid #f1d985;border-radius:6px;font-size:11px;color:#68551b;font-weight:700;">🎵 Audio gagal diputar. Klik BUKA DI SPOTIFY di bawah.</div>`;
  });

  // ===== Load audio =====
  (async () => {
    try {
      sessionToken = null;
      sessionExpiresAt = 0;
      const token = await ensureSession();
      console.log("[MUSIC] Set audio src dengan token fresh");
      audio.src = `/api/stream?url=${encodeURIComponent(item.audio)}&token=${encodeURIComponent(token)}`;
      audio.load();
    } catch (err) {
      console.error("[MUSIC] Gagal ambil token:", err);
      playerWrap.innerHTML = `<div style="padding:14px;text-align:center;background:#fff8df;border:1.5px solid #f1d985;border-radius:6px;font-size:11px;color:#68551b;font-weight:700;">🎵 ${err.message}</div>`;
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
   RENDER FPRESET — Alight Motion Preset Finder
   ========================================================= */
function renderFpreset(data) {
  const item = data.result || {};
  resultShell.hidden = false;
  resultArea.replaceChildren();

  const card = document.createElement("article");
  card.className = "fpreset-result-card";

  /* ===== HERO ===== */
  const hero = document.createElement("div");
  hero.className = "fpreset-hero";

  if (item.cover) {
    const bg = document.createElement("div");
    bg.className = "fpreset-hero-bg";
    bg.style.backgroundImage = `url("${item.cover}")`;
    hero.append(bg);
  }

  const overlay = document.createElement("div");
  overlay.className = "fpreset-hero-overlay";

  const cover = document.createElement("div");
  cover.className = "fpreset-hero-cover";
  if (item.avatar) {
    const av = document.createElement("img");
    av.src = item.avatar;
    av.alt = "Avatar";
    av.loading = "lazy";
    av.onerror = () => { cover.textContent = "🎬"; };
    cover.append(av);
  } else if (item.cover) {
    const im = document.createElement("img");
    im.src = item.cover;
    im.alt = "Cover";
    im.loading = "lazy";
    cover.append(im);
  } else {
    cover.textContent = "🎬";
  }
  overlay.append(cover);

  const info = document.createElement("div");
  info.className = "fpreset-hero-info";

  const titleEl = document.createElement("h2");
  titleEl.className = "fpreset-hero-title";
  titleEl.textContent = item.nickname || item.username || "Creator TikTok";

  const userEl = document.createElement("p");
  userEl.className = "fpreset-hero-user";
  userEl.textContent = item.username ? `@${item.username.replace(/^@/, "")}` : "";

  info.append(titleEl);
  if (userEl.textContent) info.append(userEl);

  const metaRow = document.createElement("div");
  metaRow.className = "fpreset-hero-meta";

  if (item.stats?.likes) {
    const c = document.createElement("span");
    c.className = "fpreset-chip";
    c.innerHTML = `❤️ <b>${formatNumber(item.stats.likes)}</b>`;
    metaRow.append(c);
  }
  if (item.stats?.plays) {
    const c = document.createElement("span");
    c.className = "fpreset-chip";
    c.innerHTML = `▶ <b>${formatNumber(item.stats.plays)}</b>`;
    metaRow.append(c);
  }
  const presetCount = Array.isArray(item.presetLinks) ? item.presetLinks.length : 0;
  if (presetCount > 0) {
    const c = document.createElement("span");
    c.className = "fpreset-chip fpreset-chip-accent";
    c.innerHTML = `🎬 <b>${presetCount} preset</b>`;
    metaRow.append(c);
  }

  if (metaRow.children.length) info.append(metaRow);
  overlay.append(info);
  hero.append(overlay);
  card.append(hero);

  /* ===== Caption ===== */
  if (item.caption) {
    const cap = document.createElement("div");
    cap.className = "fpreset-caption";
    cap.textContent = item.caption;
    card.append(cap);
  }

  /* ===== Preset links list ===== */
  const presetLinks = Array.isArray(item.presetLinks) ? item.presetLinks : [];
  if (presetLinks.length) {
    const listWrap = document.createElement("div");
    listWrap.className = "fpreset-list";

    const listTitle = document.createElement("div");
    listTitle.className = "fpreset-list-title";
    listTitle.innerHTML = `📦 <strong>Preset Tersedia</strong> <span>(${presetLinks.length})</span>`;
    listWrap.append(listTitle);

    presetLinks.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "fpreset-item";

      const badge = document.createElement("span");
      badge.className = "fpreset-item-type";
      const typeRaw = String(p.type || "").toLowerCase();
      const titleRaw = String(p.title || "").toLowerCase();
      let label = (p.type || "PRESET").toUpperCase();
      if (typeRaw.includes("5mb") || titleRaw.includes("5mb")) label = "5MB";
      else if (typeRaw.includes("xml") || titleRaw.includes("xml")) label = "XML";
      badge.textContent = label;

      const body = document.createElement("div");
      body.className = "fpreset-item-body";

      const name = document.createElement("strong");
      name.textContent = p.title || `Preset ${i + 1}`;
      body.append(name);

      const metaBits = [];
      if (p.size) metaBits.push(`📦 ${p.size}`);
      if (p.ratio) metaBits.push(`📐 ${p.ratio}`);
      if (metaBits.length) {
        const meta = document.createElement("span");
        meta.textContent = metaBits.join(" · ");
        body.append(meta);
      }
      if (p.detail) {
        const detail = document.createElement("small");
        detail.textContent = p.detail;
        body.append(detail);
      }

      const action = document.createElement("a");
      action.className = "fpreset-item-dl";
      action.href = p.url;
      action.target = "_blank";
      action.rel = "noopener noreferrer";
      action.setAttribute("download", "");
      action.innerHTML = `⬇ <span>DOWNLOAD</span>`;

      row.append(badge, body, action);
      listWrap.append(row);
    });

    card.append(listWrap);
  } else {
    const empty = document.createElement("div");
    empty.className = "fpreset-no-preset";
    empty.textContent = "⚠️ Tidak ada preset 5MB/XML di response API ini.";
    card.append(empty);
  }

  /* ===== Actions ===== */
  const actions = document.createElement("div");
  actions.className = "fpreset-actions";

  if (item.sourceUrl) {
    const open = document.createElement("a");
    open.className = "download-btn";
    open.href = item.sourceUrl;
    open.target = "_blank";
    open.rel = "noopener noreferrer";
    open.textContent = "▶  BUKA DI TIKTOK";
    actions.append(open);
  }
  if (item.presetUrl) {
    const dl = document.createElement("a");
    dl.className = "download-btn fpreset-primary";
    dl.href = item.presetUrl;
    dl.target = "_blank";
    dl.rel = "noopener noreferrer";
    dl.setAttribute("download", "");
    dl.textContent = "⬇  DOWNLOAD PRESET UTAMA";
    actions.append(dl);
  }

  if (actions.children.length) card.append(actions);

  resultArea.append(card);

  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${presetLinks.length} preset ditemukan`;
}

function formatNumber(n) {
  const num = Number(n);
  if (!num || isNaN(num)) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return String(num);
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
  const match = location.hash.match(/^#tool\/(hd|remove-bg|react|pinterest|spotify|fpreset)$/);
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
// fpreset pakai { url: value } — sama seperti hd/remove-bg/react
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
else if (activeTool === "fpreset") renderFpreset(data);
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
