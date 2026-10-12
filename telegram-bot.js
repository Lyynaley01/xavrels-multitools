/* =========================================================
   XAVRELS MULTITOOLS — Telegram Bot Handler
   =========================================================
   Handle webhook dari Telegram untuk command admin.
   Commands:
     /createcode <code> <coin> <max>
     /deletecode <code>
     /listcodes
     /listuser
     /listprem
     /stats
     /userinfo <deviceId>
     /addcoin <deviceId> <amount>
     /grantpremium <deviceId> [coin]
     /revokepremium <deviceId>
     /ban <deviceId>
     /unban <deviceId>
     /help
   ========================================================= */

const { kv } = require("@vercel/kv");
const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ADMIN_ID = String(process.env.TELEGRAM_ADMIN_ID || "");
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

/* ===== KV Keys ===== */
const K = {
  user: (id) => `user:${id}`,
  allUsers: "users:all",
  allPrem: "users:premium",
  code: (code) => `code:${code.toUpperCase()}`,
  allCodes: "codes:all",
  failedRedeem: (id) => `failed:${id}`,
  dailyReact: (id) => `daily:${id}`,
};

/* ===== Telegram helpers ===== */
async function tgSend(chatId, text, options = {}) {
  try {
    await axios.post(`${TG_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...options,
    }, { timeout: 10_000 });
  } catch (err) {
    console.error("[TG] sendMessage error:", err.message);
  }
}

function esc(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/* ===== Command handlers ===== */

/* /createcode <code> <coin> <max> */
async function cmdCreateCode(args, chatId) {
  if (args.length < 3) {
    return tgSend(chatId, "❌ Format: <code>/createcode KODE coin max</code>\nContoh: <code>/createcode XAVRELS-TOOLS-82KJA 50 10</code>");
  }
  const [rawCode, coinStr, maxStr] = args;
  const code = rawCode.toUpperCase().trim();
  const coin = parseInt(coinStr, 10);
  const max = parseInt(maxStr, 10);

  if (!/^[A-Z0-9\-_]{4,64}$/.test(code)) {
    return tgSend(chatId, "❌ Kode harus 4-64 karakter, alfanumerik + <code>-</code> + <code>_</code>");
  }
  if (!Number.isFinite(coin) || coin < 1 || coin > 100000) {
    return tgSend(chatId, "❌ Coin harus angka 1-100000");
  }
  if (!Number.isFinite(max) || max < 1 || max > 10000) {
    return tgSend(chatId, "❌ Max redeem harus angka 1-10000");
  }

  const key = K.code(code);
  const existing = await kv.get(key);
  if (existing) {
    return tgSend(chatId, `❌ Kode <code>${esc(code)}</code> sudah ada. Hapus dulu atau pakai kode lain.`);
  }

  const payload = {
    code,
    coin,
    maxRedeem: max,
    redeemedCount: 0,
    redeemedBy: [],
    active: true,
    type: "regular",
    createdAt: new Date().toISOString(),
    createdBy: ADMIN_ID,
  };

  await kv.set(key, JSON.stringify(payload));
  await kv.sadd(K.allCodes, code);

  tgSend(chatId,
    `✅ <b>Kode dibuat!</b>\n\n` +
    `🎟️ Kode: <code>${esc(code)}</code>\n` +
    `💰 Coin: <b>${coin}</b>\n` +
    `👥 Max redeem: <b>${max}</b> orang\n` +
    `📅 Dibuat: ${new Date().toLocaleString("id-ID")}`
  );
}

/* /deletecode <code> */
async function cmdDeleteCode(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/deletecode KODE</code>");
  const code = args[0].toUpperCase().trim();
  const key = K.code(code);
  const existing = await kv.get(key);
  if (!existing) return tgSend(chatId, `❌ Kode <code>${esc(code)}</code> gak ketemu.`);

  await kv.del(key);
  await kv.srem(K.allCodes, code);
  tgSend(chatId, `✅ Kode <code>${esc(code)}</code> dihapus.`);
}

/* /listcodes */
async function cmdListCodes(args, chatId) {
  const codes = await kv.smembers(K.allCodes) || [];
  if (!codes.length) return tgSend(chatId, "📭 Belum ada kode.");

  const lines = [];
  for (const code of codes.slice(0, 30)) {
    const data = await kv.get(K.code(code));
    if (!data) continue;
    const p = typeof data === "string" ? JSON.parse(data) : data;
    lines.push(
      `🎟️ <code>${esc(p.code)}</code>\n` +
      `   💰 ${p.coin} coin · 👥 ${p.redeemedCount}/${p.maxRedeem} · ${p.active ? "🟢" : "🔴"}`
    );
  }

  const total = codes.length;
  tgSend(chatId, `📋 <b>Total Kode: ${total}</b>\n\n${lines.join("\n\n")}${total > 30 ? "\n\n<i>…dan lainnya (limit tampil 30)</i>" : ""}`);
}

/* /listuser */
async function cmdListUser(args, chatId) {
  const ids = await kv.smembers(K.allUsers) || [];
  if (!ids.length) return tgSend(chatId, "📭 Belum ada user.");

  const lines = [];
  let totalCoin = 0;
  for (const id of ids.slice(0, 40)) {
    const data = await kv.get(K.user(id));
    if (!data) continue;
    const u = typeof data === "string" ? JSON.parse(data) : data;
    totalCoin += u.coin || 0;
    const prem = u.premium ? "⭐" : "";
    lines.push(`${prem} <code>${esc(id.slice(0, 16))}…</code> · 💰 ${u.coin || 0} · 🎬 ${u.totalReaction || 0}`);
  }

  tgSend(chatId,
    `👥 <b>Total User: ${ids.length}</b>\n` +
    `💰 <b>Total Coin Beredar: ${totalCoin}</b>\n\n` +
    lines.join("\n") +
    (ids.length > 40 ? `\n\n<i>…dan ${ids.length - 40} user lainnya</i>` : "")
  );
}

/* /listprem */
async function cmdListPrem(args, chatId) {
  const ids = await kv.smembers(K.allPrem) || [];
  if (!ids.length) return tgSend(chatId, "📭 Belum ada user premium.");

  const lines = [];
  for (const id of ids.slice(0, 40)) {
    const data = await kv.get(K.user(id));
    if (!data) continue;
    const u = typeof data === "string" ? JSON.parse(data) : data;
    lines.push(`⭐ <code>${esc(id.slice(0, 16))}…</code> · 💰 ${u.coin || 0}`);
  }

  tgSend(chatId, `⭐ <b>Total Premium: ${ids.length}</b>\n\n${lines.join("\n")}${ids.length > 40 ? `\n\n<i>…dan ${ids.length - 40} user lainnya</i>` : ""}`);
}

/* /stats */
async function cmdStats(args, chatId) {
  const [totalUsers, totalPrem, totalCodes] = await Promise.all([
    kv.scard(K.allUsers),
    kv.scard(K.allPrem),
    kv.scard(K.allCodes),
  ]);
  const ids = await kv.smembers(K.allUsers) || [];
  let totalCoin = 0;
  let totalReaction = 0;
  for (const id of ids) {
    const data = await kv.get(K.user(id));
    if (!data) continue;
    const u = typeof data === "string" ? JSON.parse(data) : data;
    totalCoin += u.coin || 0;
    totalReaction += u.totalReaction || 0;
  }
  tgSend(chatId,
    `📊 <b>Statistik Xavrels Coin</b>\n\n` +
    `👥 Total user: <b>${totalUsers}</b>\n` +
    `⭐ Premium: <b>${totalPrem}</b>\n` +
    `🎟️ Kode aktif: <b>${totalCodes}</b>\n` +
    `💰 Coin beredar: <b>${totalCoin}</b>\n` +
    `🎬 Total reaction: <b>${totalReaction}</b>`
  );
}

/* /userinfo <deviceId> */
async function cmdUserInfo(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/userinfo deviceId</code>");
  const id = args[0].trim();
  const data = await kv.get(K.user(id));
  if (!data) return tgSend(chatId, `❌ User <code>${esc(id)}</code> gak ketemu.`);
  const u = typeof data === "string" ? JSON.parse(data) : data;

  tgSend(chatId,
    `<b>Info User</b>\n\n` +
    `🆔 <code>${esc(id)}</code>\n` +
    `💰 Coin: <b>${u.coin || 0}</b>\n` +
    `⭐ Premium: <b>${u.premium ? "Ya" : "Tidak"}</b>\n` +
    `🎬 Total reaction: <b>${u.totalReaction || 0}</b>\n` +
    `🚫 Banned: <b>${u.banned ? "Ya" : "Tidak"}</b>\n` +
    `📅 Terakhir aktif: ${u.lastSeenAt ? new Date(u.lastSeenAt).toLocaleString("id-ID") : "-"}`
  );
}

/* /addcoin <deviceId> <amount> */
async function cmdAddCoin(args, chatId) {
  if (args.length < 2) return tgSend(chatId, "❌ Format: <code>/addcoin deviceId amount</code>");
  const [id, amountStr] = args;
  const amount = parseInt(amountStr, 10);
  if (!Number.isFinite(amount) || amount === 0) return tgSend(chatId, "❌ Amount harus angka (bisa negatif buat ngurangin)");

  const key = K.user(id);
  let data = await kv.get(key);
  let u = data ? (typeof data === "string" ? JSON.parse(data) : data) : null;
  if (!u) {
    u = { deviceId: id, coin: 0, premium: false, banned: false, totalReaction: 0, totalRedeemed: 0, createdAt: new Date().toISOString() };
  }
  u.coin = Math.max(0, (u.coin || 0) + amount);
  u.lastSeenAt = new Date().toISOString();

  await kv.set(key, JSON.stringify(u));
  await kv.sadd(K.allUsers, id);

  tgSend(chatId, `✅ Coin user <code>${esc(id.slice(0, 16))}…</code> ${amount >= 0 ? "+" : ""}${amount}\n💰 Saldo baru: <b>${u.coin}</b>`);
}

/* /grantpremium <deviceId> [coin] */
async function cmdGrantPremium(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/grantpremium deviceId [coin]</code>");
  const id = args[0];
  const coinAmount = args[1] ? parseInt(args[1], 10) : 0;

  const key = K.user(id);
  let data = await kv.get(key);
  let u = data ? (typeof data === "string" ? JSON.parse(data) : data) : null;
  if (!u) {
    u = { deviceId: id, coin: 0, premium: false, banned: false, totalReaction: 0, totalRedeemed: 0, createdAt: new Date().toISOString() };
  }

  u.premium = true;
  u.premiumSince = u.premiumSince || new Date().toISOString();
  u.lastSeenAt = new Date().toISOString();
  if (Number.isFinite(coinAmount) && coinAmount > 0) {
    u.coin = (u.coin || 0) + coinAmount;
  }

  await kv.set(key, JSON.stringify(u));
  await kv.sadd(K.allUsers, id);
  await kv.sadd(K.allPrem, id);

  tgSend(chatId,
    `⭐ <b>User di-premium-kan!</b>\n\n` +
    `🆔 <code>${esc(id.slice(0, 16))}…</code>\n` +
    `💰 Coin: <b>${u.coin || 0}</b>\n` +
    `📅 Premium sejak: ${new Date().toLocaleString("id-ID")}`
  );
}

/* /revokepremium <deviceId> */
async function cmdRevokePremium(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/revokepremium deviceId</code>");
  const id = args[0];
  const key = K.user(id);
  const data = await kv.get(key);
  if (!data) return tgSend(chatId, `❌ User gak ketemu.`);
  const u = typeof data === "string" ? JSON.parse(data) : data;
  u.premium = false;
  delete u.premiumSince;
  await kv.set(key, JSON.stringify(u));
  await kv.srem(K.allPrem, id);
  tgSend(chatId, `✅ Premium user <code>${esc(id.slice(0, 16))}…</code> dicabut.`);
}

/* /ban <deviceId> */
async function cmdBan(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/ban deviceId</code>");
  const id = args[0];
  const key = K.user(id);
  let data = await kv.get(key);
  let u = data ? (typeof data === "string" ? JSON.parse(data) : data) : null;
  if (!u) u = { deviceId: id, coin: 0, premium: false, banned: false, totalReaction: 0, totalRedeemed: 0, createdAt: new Date().toISOString() };
  u.banned = true;
  await kv.set(key, JSON.stringify(u));
  await kv.sadd(K.allUsers, id);
  tgSend(chatId, `🚫 User <code>${esc(id.slice(0, 16))}…</code> di-BAN.`);
}

/* /unban <deviceId> */
async function cmdUnban(args, chatId) {
  if (args.length < 1) return tgSend(chatId, "❌ Format: <code>/unban deviceId</code>");
  const id = args[0];
  const key = K.user(id);
  const data = await kv.get(key);
  if (!data) return tgSend(chatId, `❌ User gak ketemu.`);
  const u = typeof data === "string" ? JSON.parse(data) : data;
  u.banned = false;
  await kv.set(key, JSON.stringify(u));
  tgSend(chatId, `✅ User <code>${esc(id.slice(0, 16))}…</code> di-UNBAN.`);
}

/* /help */
async function cmdHelp(chatId) {
  tgSend(chatId,
    `<b>🤖 XAVRELS BOT COMMAND LIST</b>\n\n` +
    `<b>Code Management:</b>\n` +
    `/createcode &lt;code&gt; &lt;coin&gt; &lt;max&gt;\n` +
    `/deletecode &lt;code&gt;\n` +
    `/listcodes\n\n` +
    `<b>User Management:</b>\n` +
    `/listuser\n` +
    `/listprem\n` +
    `/userinfo &lt;deviceId&gt;\n` +
    `/addcoin &lt;deviceId&gt; &lt;amount&gt;\n` +
    `/grantpremium &lt;deviceId&gt; [coin]\n` +
    `/revokepremium &lt;deviceId&gt;\n` +
    `/ban &lt;deviceId&gt;\n` +
    `/unban &lt;deviceId&gt;\n\n` +
    `<b>Statistik:</b>\n` +
    `/stats\n` +
    `/help`
  );
}

/* ===== Main handler ===== */
async function handleTelegramUpdate(update) {
  if (!update?.message?.text) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const fromId = String(msg.from.id);
  const text = msg.text.trim();

  // Cek admin
  if (fromId !== ADMIN_ID) {
    console.log(`[TG] Non-admin attempt: ${fromId}`);
    return tgSend(chatId, "❌ Akses ditolak. Bot ini khusus admin.");
  }

  // Parse command
  const parts = text.split(/\s+/);
  const command = parts[0].toLowerCase().split("@")[0]; // /cmd@botname → /cmd
  const args = parts.slice(1);

  try {
    switch (command) {
      case "/start":
      case "/help":
        return cmdHelp(chatId);
      case "/createcode":
        return cmdCreateCode(args, chatId);
      case "/deletecode":
        return cmdDeleteCode(args, chatId);
      case "/listcodes":
        return cmdListCodes(args, chatId);
      case "/listuser":
        return cmdListUser(args, chatId);
      case "/listprem":
        return cmdListPrem(args, chatId);
      case "/stats":
        return cmdStats(args, chatId);
      case "/userinfo":
        return cmdUserInfo(args, chatId);
      case "/addcoin":
        return cmdAddCoin(args, chatId);
      case "/grantpremium":
        return cmdGrantPremium(args, chatId);
      case "/revokepremium":
        return cmdRevokePremium(args, chatId);
      case "/ban":
        return cmdBan(args, chatId);
      case "/unban":
        return cmdUnban(args, chatId);
      default:
        // abaikan command gak dikenal
        return;
    }
  } catch (err) {
    console.error("[TG] Command error:", err.message);
    tgSend(chatId, `❌ Error: ${esc(err.message).slice(0, 200)}`);
  }
}

module.exports = { handleTelegramUpdate };
