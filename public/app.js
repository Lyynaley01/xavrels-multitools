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

// State buat fpreset search → detail view
let fpresetSearchState = null; // { keyword, videos, shownCount, scrollPos }
let fpresetInDetailView = false;


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
  },
  fpreset: {
  title: "AM PRESET FINDER", titleLead: "AM PRESET", titleAccent: "FINDER", issue: "TOOL 06", number: "06",
  category: "PRESET LAB", icon: "🎬",
  description: "Cari preset Alight Motion dari link TikTok atau keyword.",
  tip: "Pilih mode: paste link video langsung, atau cari pakai keyword.",
  label: "Link video TikTok", placeholder: "https://www.tiktok.com/@user/video/...", inputType: "url",
  endpoint: "api/fpreset", searchEndpoint: "api/fpreset-search",
  button: "FIND PRESET", searchButton: "CARI VIDEO",
  supportsUpload: false,
  supportsModeSwitch: true
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

  // FPRESET pakai 2 mode: url = link video, upload = search keyword
  if (activeTool === "fpreset") {
    const info = toolInfo.fpreset;
    if (mode === "url") {
      if (modeUrl) modeUrl.hidden = false;
      if (modeUpload) modeUpload.hidden = true;
      $("#inputLabel").textContent = info.label;
      input.placeholder = info.placeholder;
      input.type = "url";
      submitLabel.textContent = info.button;
    } else {
      if (modeUrl) modeUrl.hidden = true;
      if (modeUpload) modeUpload.hidden = true; // fpreset gak pakai upload file
      // Tampilkan mode search: pakai input URL, tapi label & placeholder beda
      if (modeUrl) modeUrl.hidden = false;
      $("#inputLabel").textContent = "Keyword pencarian video";
      input.placeholder = "contoh: JJ kicau mania";
      input.type = "text";
      submitLabel.textContent = info.searchButton;
    }
    clearResult();
    return;
  }

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
/* =========================================================
   RENDER FPRESET — Alight Motion Preset Finder
   ========================================================= */
function renderFpreset(data, targetContainer) {
  const item = data.result || {};
  const stats = item.stats || {};
  const presetLinks = Array.isArray(item.presetLinks) ? item.presetLinks : [];

  const target = targetContainer || resultArea;
  resultShell.hidden = false;
  if (!targetContainer) target.replaceChildren();
  // Kalau targetContainer dikasih, JANGAN replace (biar tombol back tetap ada)

  const card = document.createElement("article");
  card.className = "fpreset-result-card";

  /* ===== HEADER: Avatar + Nama + Bio ===== */
  const header = document.createElement("div");
  header.className = "fpreset-header";

  const avatar = document.createElement("div");
  avatar.className = "fpreset-avatar";
  if (item.avatar) {
    const img = document.createElement("img");
    img.src = item.avatar;
    img.alt = item.nickname || "Avatar";
    img.loading = "lazy";
    img.onerror = () => { avatar.textContent = "🎬"; };
    avatar.append(img);
  } else {
    avatar.textContent = "🎬";
  }

  const info = document.createElement("div");
  info.className = "fpreset-header-info";

  const nameRow = document.createElement("div");
  nameRow.className = "fpreset-name-row";

  const nickname = document.createElement("h2");
  nickname.className = "fpreset-nickname";
  nickname.textContent = item.nickname || item.username || "Creator TikTok";
  nameRow.append(nickname);

  // Verified badge — kalau ada preset verified
  if (presetLinks.some(p => p.verified)) {
    const badge = document.createElement("span");
    badge.className = "fpreset-verified";
    badge.textContent = "✓";
    badge.title = "Verified";
    nameRow.append(badge);
  }

  const username = document.createElement("p");
  username.className = "fpreset-username";
  username.textContent = item.username ? `@${item.username.replace(/^@/, "")}` : "";

  info.append(nameRow);
  if (username.textContent) info.append(username);

  // Bio
  if (item.bio) {
    const bio = document.createElement("p");
    bio.className = "fpreset-bio";
    bio.textContent = item.bio;
    info.append(bio);
  }

  header.append(avatar, info);
  card.append(header);

  /* ===== STATS ROW ===== */
  if (stats.views || stats.likes || stats.comments || stats.shares) {
    const statsRow = document.createElement("div");
    statsRow.className = "fpreset-stats";

    if (stats.views) {
      const s = document.createElement("span");
      s.className = "fpreset-stat";
      s.innerHTML = `<b>${formatNumber(stats.views)}</b> views`;
      statsRow.append(s);
    }
    if (stats.likes) {
      const s = document.createElement("span");
      s.className = "fpreset-stat";
      s.innerHTML = `<b>${formatNumber(stats.likes)}</b> likes`;
      statsRow.append(s);
    }
    if (stats.comments) {
      const s = document.createElement("span");
      s.className = "fpreset-stat";
      s.innerHTML = `<b>${formatNumber(stats.comments)}</b> comments`;
      statsRow.append(s);
    }
    if (stats.shares) {
      const s = document.createElement("span");
      s.className = "fpreset-stat";
      s.innerHTML = `<b>${formatNumber(stats.shares)}</b> shares`;
      statsRow.append(s);
    }

    card.append(statsRow);
  }

  /* ===== VIDEO THUMBNAIL (clickable → modal) ===== */
  if (item.cover || item.videoUrl) {
    const videoWrap = document.createElement("div");
    videoWrap.className = "fpreset-video-thumb";
    videoWrap.setAttribute("role", "button");
    videoWrap.setAttribute("tabindex", "0");
    videoWrap.setAttribute("aria-label", "Buka video dalam pop-up");
    if (item.cover) {
      videoWrap.style.backgroundImage = `url("${item.cover}")`;
      videoWrap.classList.add("has-cover");
    }

    const overlay = document.createElement("div");
    overlay.className = "fpreset-video-overlay";

    const playBtn = document.createElement("div");
    playBtn.className = "fpreset-play-btn";
    playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

    const playText = document.createElement("span");
    playText.className = "fpreset-play-text";
    playText.textContent = "Klik untuk putar video";

    overlay.append(playBtn, playText);
    videoWrap.append(overlay);

    const openPreview = () => openFpresetVideoModal(item);
    videoWrap.addEventListener("click", openPreview);
    videoWrap.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPreview();
      }
    });

    card.append(videoWrap);
  }

  /* ===== CAPTION ===== */
  if (item.caption) {
    const cap = document.createElement("div");
    cap.className = "fpreset-caption";
    cap.textContent = item.caption;
    card.append(cap);
  }

  /* ===== PRESET LIST ===== */
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

      // Thumbnail preset (kalau ada)
      if (p.thumb) {
        const thumb = document.createElement("div");
        thumb.className = "fpreset-item-thumb";
        const img = document.createElement("img");
        img.src = p.thumb;
        img.alt = p.title || "Preset";
        img.loading = "lazy";
        img.onerror = () => { thumb.remove(); };
        thumb.append(img);
        row.append(thumb);
      }

      const body = document.createElement("div");
      body.className = "fpreset-item-body";

      const titleRow = document.createElement("div");
      titleRow.className = "fpreset-item-title-row";

      const badge = document.createElement("span");
      badge.className = "fpreset-item-type";
      const typeRaw = String(p.type || "").toLowerCase();
      const titleRaw = String(p.title || "").toLowerCase();
      let label = (p.type || "PRESET").toUpperCase();
      if (typeRaw.includes("5mb") || titleRaw.includes("5mb")) label = "5MB";
      else if (typeRaw.includes("xml") || titleRaw.includes("xml")) label = "XML";
      badge.textContent = label;

      const name = document.createElement("strong");
      name.textContent = p.title || `Preset ${i + 1}`;
      titleRow.append(badge, name);

      if (p.verified) {
        const v = document.createElement("span");
        v.className = "fpreset-item-verified";
        v.textContent = "✓";
        v.title = "Verified";
        titleRow.append(v);
      }

      body.append(titleRow);

      const metaBits = [];
      if (p.size) metaBits.push(p.size);
      if (p.ratio) metaBits.push(p.ratio);
      if (p.byAuthor) metaBits.push("by creator");
      if (metaBits.length) {
        const meta = document.createElement("span");
        meta.className = "fpreset-item-meta";
        meta.textContent = metaBits.join(" · ");
        body.append(meta);
      }

      if (p.detail && p.detail !== p.title) {
        const detail = document.createElement("small");
        detail.className = "fpreset-item-detail";
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

      row.append(body, action);
      listWrap.append(row);
    });

    card.append(listWrap);
  } else {
    const empty = document.createElement("div");
    empty.className = "fpreset-no-preset";
    empty.textContent = "⚠️ Tidak ada preset 5MB/XML di video ini.";
    card.append(empty);
  }

  /* ===== OTHER LINKS ===== */
/* ===== ACTIONS ===== */
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

  if (actions.children.length) card.append(actions);

    target.append(card);

  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${presetLinks.length} preset ditemukan`;
}

/* =========================================================
   RENDER FPRESET SEARCH — Grid card video TikTok
   ========================================================= */
function renderFpresetSearch(data) {
  const videos = Array.isArray(data.videos) ? data.videos : [];
  resultShell.hidden = false;
  resultArea.replaceChildren();

  // Simpan state search biar bisa di-restore pas balik dari detail view
  fpresetSearchState = {
    keyword: input.value.trim() || "",
    videos,
    shownCount: 0,
    scrollPos: window.scrollY
  };
  fpresetInDetailView = false;

  const summary = document.createElement("div");
  summary.className = "result-summary";
  summary.innerHTML = `<strong>${videos.length} video ditemukan</strong><span>Klik salah satu untuk cari preset-nya.</span>`;
  resultArea.append(summary);

  if (!videos.length) {
    const empty = document.createElement("div");
    empty.className = "result-msg";
    empty.textContent = "Tidak ada video preset untuk keyword ini. Coba kata kunci lain.";
    resultArea.append(empty);
    return;
  }

  // ===== PAGINATION CONFIG =====
  const INITIAL_COUNT = 6;
  const LOAD_STEP = 6; // tiap klik load 6 lagi
  let shownCount = 0;

  // Grid container
  const grid = document.createElement("div");
  grid.className = "fpreset-search-grid";
  resultArea.append(grid);

  // Wrapper buat tombol "load more" (biar gampang di-remove)
  const loadMoreWrap = document.createElement("div");
  loadMoreWrap.className = "fpreset-load-more-wrap";
  resultArea.append(loadMoreWrap);

  // Counter kecil di bawah grid
  const counterEl = document.createElement("div");
  counterEl.className = "fpreset-load-counter";
  loadMoreWrap.append(counterEl);

  // Tombol "LIHAT LEBIH BANYAK"
  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.type = "button";
  loadMoreBtn.className = "fpreset-load-more-btn";
  loadMoreBtn.innerHTML = `⬇ <span>LIHAT LEBIH BANYAK</span>`;
  loadMoreWrap.append(loadMoreBtn);

  // ===== Function: bikin 1 card =====
  function buildCard(v, i) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "fpreset-search-card";
    card.style.animationDelay = `${(i % LOAD_STEP) * 30}ms`;

    if (v.cover) {
      card.style.backgroundImage = `url("${v.cover}")`;
      card.classList.add("has-cover");
    }

    const overlay = document.createElement("div");
    overlay.className = "fpreset-search-overlay";

    const body = document.createElement("div");
    body.className = "fpreset-search-body";

    const nick = document.createElement("strong");
    nick.textContent = v.author?.nickname || v.author?.uniqueId || "Creator TikTok";

    const handle = document.createElement("span");
    handle.className = "fpreset-search-handle";
    handle.textContent = v.author?.uniqueId ? `@${v.author.uniqueId.replace(/^@/, "")}` : "";

    const desc = document.createElement("span");
    desc.className = "fpreset-search-desc";
    desc.textContent = v.description || "Tanpa deskripsi";

    const statsRow = document.createElement("div");
    statsRow.className = "fpreset-search-stats";
    if (v.stats?.views) {
      const s = document.createElement("span");
      s.innerHTML = `👁 <b>${formatNumber(v.stats.views)}</b>`;
      statsRow.append(s);
    }
    if (v.stats?.likes) {
      const s = document.createElement("span");
      s.innerHTML = `❤️ <b>${formatNumber(v.stats.likes)}</b>`;
      statsRow.append(s);
    }
    if (statsRow.children.length) body.append(statsRow);

    body.append(nick);
    if (handle.textContent) body.append(handle);
    body.append(desc);
    overlay.append(body);

    const cta = document.createElement("div");
    cta.className = "fpreset-search-cta";
    cta.innerHTML = `🔍 <span>CARI PRESET</span>`;
    overlay.append(cta);

    card.append(overlay);
    card.addEventListener("click", () => findPresetFromVideo(v.url, card));

    return card;
  }

  // ===== Function: render batch =====
  function renderBatch(count) {
    const start = shownCount;
    const end = Math.min(start + count, videos.length);

    for (let i = start; i < end; i++) {
      grid.append(buildCard(videos[i], i));
    }
    shownCount = end;
if (fpresetSearchState) fpresetSearchState.shownCount = shownCount;

    // Update counter
    counterEl.textContent = `Menampilkan ${shownCount} dari ${videos.length} video`;

    // Kalau udah semua, sembunyikan tombol
    if (shownCount >= videos.length) {
      loadMoreBtn.hidden = true;
      counterEl.textContent = `Semua ${videos.length} video sudah ditampilkan`;
    } else {
      // Update label tombol: sisa berapa
      const remaining = videos.length - shownCount;
      const nextBatch = Math.min(LOAD_STEP, remaining);
      loadMoreBtn.querySelector("span").textContent =
        `LIHAT ${nextBatch} VIDEO LAGI`;
    }
  }

  // Load pertama (6 video)
  renderBatch(INITIAL_COUNT);

  // Event klik load more
  loadMoreBtn.addEventListener("click", () => {
    loadMoreBtn.disabled = true;
    loadMoreBtn.innerHTML = `⏳ <span>MEMUAT…</span>`;

    // Pakai setTimeout biar ada efek loading dikit (biar gak kerasa instan)
    setTimeout(() => {
      renderBatch(LOAD_STEP);
      loadMoreBtn.disabled = false;
      if (shownCount < videos.length) {
        loadMoreBtn.innerHTML = `⬇ <span>LIHAT LEBIH BANYAK</span>`;
      }
    }, 180);
  });

  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${videos.length} video`;
}


/* =========================================================
   EXECUTE FIND PRESET DARI CARD VIDEO
   ========================================================= */
async function findPresetFromVideo(videoUrl, cardEl) {
  if (!videoUrl) return;

  // Simpan scroll position sebelum pindah
  if (fpresetSearchState) {
    fpresetSearchState.scrollPos = window.scrollY;
  }

  // Loading state di card
  if (cardEl) {
    cardEl.disabled = true;
    cardEl.classList.add("is-loading");
    const cta = cardEl.querySelector(".fpreset-search-cta");
    if (cta) cta.innerHTML = `⏳ <span>MENCARI…</span>`;
  }

  // Switch ke detail view — clear result area, tampilkan loading
  fpresetInDetailView = true;
  resultShell.hidden = false;
  resultArea.replaceChildren();

  // Render tombol back + loading state di detail view
  const detailWrap = document.createElement("div");
  detailWrap.className = "fpreset-detail-view";
  detailWrap.id = "fpresetDetailView";

  const backBtn = document.createElement("button");
  backBtn.type = "button";
  backBtn.className = "fpreset-back-btn";
  backBtn.innerHTML = `<span>←</span> KEMBALI KE HASIL PENCARIAN`;
  backBtn.addEventListener("click", () => backToFpresetSearch());
  detailWrap.append(backBtn);

  const loadingBox = document.createElement("div");
  loadingBox.className = "fpreset-detail-loading";
  loadingBox.innerHTML = `
    <div class="fpreset-detail-loading-spinner"></div>
    <strong>Mencari preset dari video…</strong>
    <span>Tunggu sebentar, sedang scan caption & komentar.</span>
  `;
  detailWrap.append(loadingBox);
  resultArea.append(detailWrap);

  const note = $("#resultHeadingNote");
  if (note) note.textContent = "Mencari preset…";

  // Scroll ke atas
  window.scrollTo({ top: 0, behavior: "smooth" });

  try {
    const token = await ensureSession();

    let response = await fetch("/api/fpreset", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-Token": token
      },
      body: JSON.stringify({ url: videoUrl })
    });

    if (response.status === 401) {
      sessionToken = null;
      sessionExpiresAt = 0;
      const fresh = await ensureSession();
      response = await fetch("/api/fpreset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-Token": fresh
        },
        body: JSON.stringify({ url: videoUrl })
      });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) {
      let message = `Request gagal (HTTP ${response.status}).`;
      if (contentType.includes("application/json")) {
        const err = await response.json();
        message = err.error || message;
      }
      throw new Error(message);
    }

    const data = await response.json();
    if (!data.ok) throw new Error(data.error || "Gagal mencari preset.");

    // Hapus loading, render detail preset (pakai renderFpreset yang udah ada)
    // Tapi kita render ke dalam detailWrap, biar tombol back tetap ada di atas
    const presetContainer = document.createElement("div");
    presetContainer.className = "fpreset-detail-content";

    // Render preset ke container sementara
    const originalResultArea = resultArea;
    // Trick: render ke container preset
    renderFpresetInto(presetContainer, data);

    // Clear detailWrap & append fresh
    detailWrap.replaceChildren();
    detailWrap.append(backBtn, presetContainer);

    // Balikin state card (di grid belakang)
    if (cardEl) {
      cardEl.disabled = false;
      cardEl.classList.remove("is-loading");
      const cta = cardEl.querySelector(".fpreset-search-cta");
      if (cta) cta.innerHTML = `🔍 <span>CARI PRESET</span>`;
    }

    if (note) note.textContent = "Preset ditemukan";

  } catch (err) {
    // Kalau error, tampilkan error + tombol back
    detailWrap.replaceChildren();
    detailWrap.append(backBtn);

    const errBox = document.createElement("div");
    errBox.className = "result-msg error";
    errBox.textContent = err.message || "Gagal mencari preset dari video ini.";
    detailWrap.append(errBox);

    if (cardEl) {
      cardEl.disabled = false;
      cardEl.classList.remove("is-loading");
      const cta = cardEl.querySelector(".fpreset-search-cta");
      if (cta) cta.innerHTML = `🔍 <span>CARI PRESET</span>`;
    }

    if (note) note.textContent = "Perlu diperiksa";
  }
}


/* =========================================================
   FPRESET — Back to search results
   ========================================================= */
function backToFpresetSearch() {
  if (!fpresetSearchState) {
    // Gak ada state, fallback ke clear result
    clearResult();
    return;
  }

  fpresetInDetailView = false;

  // Restore grid search pakai state yang tersimpan
  const data = { videos: fpresetSearchState.videos };
  const preservedShown = fpresetSearchState.shownCount;
  const preservedScroll = fpresetSearchState.scrollPos;

  // Re-render search grid
  renderFpresetSearch(data);

  // Restore shownCount (load sampe jumlah yang tadi udah keload)
  // renderFpresetSearch udah load 6 pertama, kita perlu nambah sampe preservedShown
  // Akses internal via re-trigger tombol load more
  const loadBtn = resultArea.querySelector(".fpreset-load-more-btn");
  if (loadBtn && preservedShown > 6) {
    let target = Math.min(preservedShown, data.videos.length);
    // Klik tombol load more sampe shownCount nyampe target
    // Simulasi: hitung berapa batch lagi yang perlu di-load
    // Karena renderFpresetSearch nge-load 6 pertama, kita perlu (target - 6) / 6 batch
    const remaining = target - 6;
    const batches = Math.ceil(remaining / 6);
    for (let i = 0; i < batches; i++) {
      if (!loadBtn || loadBtn.hidden) break;
      loadBtn.click();
    }
  }

  // Restore scroll
  setTimeout(() => {
    window.scrollTo({ top: preservedScroll, behavior: "smooth" });
  }, 100);

  // Update note
  const note = $("#resultHeadingNote");
  if (note) note.textContent = `${data.videos.length} video`;
}


/* =========================================================
   FPRESET VIDEO MODAL
   ========================================================= */
function openFpresetVideoModal(item) {
  const old = document.getElementById("fpresetVideoModal");
  if (old) old.remove();

  const modal = document.createElement("div");
  modal.className = "fpreset-video-modal-backdrop";
  modal.id = "fpresetVideoModal";

  const stats = item.stats || {};

  modal.innerHTML = `
    <div class="fpreset-video-modal">
      <button class="fpreset-video-close" aria-label="Tutup">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>

      <div class="fpreset-video-stage">
        <video
          class="fpreset-video-el"
          src="${item.videoUrl || ''}"
          poster="${item.cover || ''}"
          playsinline
          preload="metadata"
          crossorigin="anonymous">
        </video>

        <div class="fpreset-video-controls">
          <button type="button" class="fpv-play-btn" aria-label="Play">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <div class="fpv-progress" tabindex="0" role="slider">
            <div class="fpv-progress-bg"></div>
            <div class="fpv-progress-fill"></div>
            <div class="fpv-progress-thumb"></div>
          </div>
          <span class="fpv-time">0:00</span>
          <button type="button" class="fpv-mute-btn" aria-label="Mute">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
          </button>
        </div>

        <div class="fpreset-video-loading">⏳ Memuat video...</div>
      </div>

      ${item.caption ? `
        <div class="fpreset-video-caption">
          ${escapeHtml(item.caption)}
        </div>
      ` : ""}

      <div class="fpreset-video-meta">
        ${item.nickname ? `<span class="fpv-meta-item"><b>${escapeHtml(item.nickname)}</b></span>` : ""}
        ${stats.views ? `<span class="fpv-meta-item">👁 <b>${formatNumber(stats.views)}</b></span>` : ""}
        ${stats.likes ? `<span class="fpv-meta-item">❤️ <b>${formatNumber(stats.likes)}</b></span>` : ""}
        ${stats.comments ? `<span class="fpv-meta-item">💬 <b>${formatNumber(stats.comments)}</b></span>` : ""}
        ${stats.shares ? `<span class="fpv-meta-item">🔗 <b>${formatNumber(stats.shares)}</b></span>` : ""}
      </div>
    </div>
  `;

  document.body.append(modal);
  document.body.style.overflow = "hidden";

  const video = modal.querySelector(".fpreset-video-el");
  const playBtn = modal.querySelector(".fpv-play-btn");
  const muteBtn = modal.querySelector(".fpv-mute-btn");
  const progress = modal.querySelector(".fpv-progress");
  const progressFill = modal.querySelector(".fpv-progress-fill");
  const progressThumb = modal.querySelector(".fpv-progress-thumb");
  const timeEl = modal.querySelector(".fpv-time");
  const loading = modal.querySelector(".fpreset-video-loading");

  let muted = false;
  let dragging = false;

  function fmtTime(sec) {
    if (!sec || isNaN(sec)) return "0:00";
    const m = Math.floor(sec / 60);
    const s = String(Math.floor(sec % 60)).padStart(2, "0");
    return `${m}:${s}`;
  }

  function updateProgress() {
    const dur = video.duration;
    const cur = video.currentTime;
    if (dur && !isNaN(dur)) {
      const pct = (cur / dur) * 100;
      progressFill.style.width = `${pct}%`;
      progressThumb.style.left = `${pct}%`;
      timeEl.textContent = fmtTime(cur);
    }
  }

  function updatePlayState() {
    if (video.paused) {
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
      playBtn.setAttribute("aria-label", "Play");
    } else {
      playBtn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>`;
      playBtn.setAttribute("aria-label", "Pause");
    }
  }

  playBtn.addEventListener("click", () => {
    if (video.paused) {
      video.play().catch(e => console.error("[FPRESET VIDEO] play error:", e));
    } else {
      video.pause();
    }
  });

  muteBtn.addEventListener("click", () => {
    muted = !muted;
    video.muted = muted;
    muteBtn.style.opacity = muted ? "0.4" : "1";
  });

  video.addEventListener("play", updatePlayState);
  video.addEventListener("pause", updatePlayState);
  video.addEventListener("timeupdate", updateProgress);
  video.addEventListener("loadedmetadata", () => {
    updateProgress();
    loading.style.display = "none";
  });
  video.addEventListener("error", () => {
    loading.innerHTML = "❌ Video tidak dapat diputar. Klik tombol BUKA DI TIKTOK.";
    loading.style.display = "block";
  });
  video.addEventListener("canplay", () => { loading.style.display = "none"; });

  // Klik video = toggle play
  video.addEventListener("click", () => playBtn.click());

  // Seek
  function seekTo(clientX) {
    const rect = progress.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (video.duration && !isNaN(video.duration)) {
      video.currentTime = pct * video.duration;
      updateProgress();
    }
  }
  progress.addEventListener("mousedown", (e) => { dragging = true; progress.classList.add("is-dragging"); seekTo(e.clientX); e.preventDefault(); });
  progress.addEventListener("touchstart", (e) => { dragging = true; progress.classList.add("is-dragging"); seekTo(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  window.addEventListener("mousemove", (e) => { if (dragging) seekTo(e.clientX); });
  window.addEventListener("touchmove", (e) => { if (dragging) seekTo(e.touches[0].clientX); }, { passive: false });
  window.addEventListener("mouseup", () => { dragging = false; progress.classList.remove("is-dragging"); });
  window.addEventListener("touchend", () => { dragging = false; progress.classList.remove("is-dragging"); });

  // Close
  function close() {
    video.pause();
    document.body.style.overflow = "";
    modal.style.animation = "fpvFadeOut 0.2s ease forwards";
    const card = modal.querySelector(".fpreset-video-modal");
    if (card) card.style.animation = "fpvPopOut 0.2s ease forwards";
    setTimeout(() => modal.remove(), 200);
  }

  modal.querySelector(".fpreset-video-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", function escHandler(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escHandler); }
  });
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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
} else if (info.supportsModeSwitch) {
  if (inputTabs) inputTabs.hidden = false;
  switchInputMode("url"); // mode awal = url
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
// Reset fpreset state
fpresetSearchState = null;
fpresetInDetailView = false;
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
// Reset fpreset state
fpresetSearchState = null;
fpresetInDetailView = false;
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

  let payload;
  let endpoint = info.endpoint;

  if (activeTool === "fpreset" && inputMode === "upload") {
    // FPRESET mode "Cari Preset" — pakai keyword, endpoint search
    payload = { query: value };
    endpoint = info.searchEndpoint;
  } else if (activeTool === "pinterest" || activeTool === "spotify") {
    payload = { query: value };
  } else {
    payload = { url: value };
  }

  if (activeTool === "react") payload.emoji = extra.value.trim();

  fetchOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    __endpoint: endpoint // simpan sementara
  };
}

    submit.disabled = true;
    submitLabel.textContent = "PROCESSING...";
    showMessage("Sedang menghubungi provider dengan aman. Tunggu sebentar…", "loading");

    try {
      const token = await ensureSession();
if (!fetchOptions.headers) fetchOptions.headers = {};
fetchOptions.headers["X-Session-Token"] = token;

const finalEndpoint = fetchOptions.__endpoint || info.endpoint;
delete fetchOptions.__endpoint;
let response = await fetch(finalEndpoint, fetchOptions);

      if (response.status === 401) {
        console.warn("[SESSION] 401 — refresh token & retry");
        sessionToken = null; sessionExpiresAt = 0;
        const newToken = await ensureSession();
        fetchOptions.headers["X-Session-Token"] = newToken;
response = await fetch(finalEndpoint, fetchOptions);
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
else if (activeTool === "fpreset") {
  if (inputMode === "upload") renderFpresetSearch(data);
  else renderFpreset(data);
}
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
