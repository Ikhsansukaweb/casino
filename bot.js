'use strict'

// ==================== ISAN CASINO BOT (MULTI-BOT) ====================
// 3 akun Bedrock jalan bareng buat sistem casino via chat in-game.
// Server target : be.prownetwork.net -> otomatis /server ekonomi pas spawn
// Database      : JSON file (lihat db.js)
// Anti-spam     : balasan ke player dirotasi gantian antar 3 bot, dan tiap
//                 bot individu dikasih jeda minimal sebelum boleh chat lagi.

const bedrock = require('bedrock-protocol')
const path = require('path')
const readline = require('readline')
const fs0 = require('fs')
const db = require('./db')
const games = require('./games')

// ==================== CONFIG TERPUSAT ====================
// Semua angka ekonomi/permainan bisa diubah dari config.json tanpa edit kode.
const CFG_PATH = path.join(__dirname, 'config.json')
const CFG_DEFAULT = {
  ekonomi: {
    taruhanMin: 100, taruhanMax: 100000000, pajakCoinflip: 0.05, pajakTransfer: 0.02,
    hadiahDaily: 5000, gajiKerja: 2500, cooldownDailyMs: 86400000, cooldownKerjaMs: 300000,
    cooldownRampokMs: 600000, cooldownGachaMs: 3600000, dendaRampok: 0.25, peluangRampok: 0.3
  },
  permainan: {
    peluangMenangCasino: 0.45, peluangMenangSlot: 0.35, persenJackpot: 0.01, jackpotAwal: 100000,
    pengaliDadu: 5, pengaliTebak: 8, pengaliRouletteAngka: 36, pengaliRouletteHijau: 14,
    pengaliRouletteWarna: 2, pengaliTogel: 3000, pengaliHilo: 2
  },
  antiSpam: { maxCommandPer10Detik: 5, cooldownBalasanMs: 7000, maxPanjangPesan: 200 },
  sistem: { backupTiapMs: 3600000, backupSimpan: 24, auditLog: true },
  teks: { prefixDeposit: '/pay', pemilikSaldo: 'IsanKaramazv' }
}
function loadConfig () {
  try {
    const raw = JSON.parse(fs0.readFileSync(CFG_PATH, 'utf8'))
    // gabung dalam (shallow per-seksi) supaya field baru tetap punya default
    const out = {}
    for (const k of Object.keys(CFG_DEFAULT)) out[k] = { ...CFG_DEFAULT[k], ...(raw[k] || {}) }
    return out
  } catch (e) {
    console.log('⚠️ config.json gagal dibaca, pakai default:', e.message)
    return JSON.parse(JSON.stringify(CFG_DEFAULT))
  }
}
const CFG = loadConfig()

// Daftar admin awal dari config.json (dipasang otomatis kalau belum ada).
try {
  const awal = (CFG.admin && CFG.admin.daftarAwal) || []
  awal.forEach((a) => { if (a && !db.isAdmin(a)) db.addAdmin(a) })
} catch (_) {}

// ==================== KONFIGURASI ====================
const SERVER_HOST = 'javrocksmp.my.id'
const SERVER_PORT = 11039
const OFFLINE_MODE = false // false = login pakai akun Microsoft asli (device code / cache)
const WIN_CHANCE = 0.45 // peluang menang !casino (0-1), sisanya house edge
const COINFLIP_TAX = 0.05 // pajak 5% dari total pot buat "isan"
const SUBSERVER_COMMAND = process.env.CASINO_SUBSERVER || '/server survival' // diketik otomatis begitu bot spawn (ganti lewat env CASINO_SUBSERVER)
const DUEL_TIMEOUT_MS = 60000 // batas waktu !acc sebelum tantangan coinflip hangus

// ==================== ANTI RATE-LIMIT / ANTI NYANGKUT ====================
// Server ini (Geyser/Floodgate di belakang proxy) membatasi LOGIN PER-IP.
// Kalau semua bot nembak bareng, yang muncul: "You are logging in too fast, try
// again later." dan sebagian bot gagal total. Maka:
//   * LOGIN_GAP_MS     — jeda minimal antar percobaan login (satu bot sekali).
//   * INITIAL_STAGGER  — jarak antar bot saat start pertama.
//   * RECONNECT_*      — backoff eksponensial + jitter (jangan serempak).
//   * RATE_LIMIT_FLOOR — lantai tunggu kalau server bilang "too fast".
//   * WATCHDOG_MS      — kalau belum spawn sekian lama, paksa ulang (ini yang
//                        dulu bikin BOT2 nyangkut: library tidak emit 'close'
//                        di jalur "Connect timed out").
const LOGIN_GAP_MS = 10000
const INITIAL_STAGGER_MS = 5000
const RECONNECT_BASE_MS = 8000
const RECONNECT_MAX_MS = 90000
const RECONNECT_JITTER_MS = 5000
const RATE_LIMIT_FLOOR_MS = 30000
const WATCHDOG_MS = 40000
const CONNECT_TIMEOUT_MS = 20000

// Kosongkan (undefined) supaya bot ping server dulu & auto-deteksi versi yang
// benar. WAJIB jangan skip ping - kalau versi dipaksa tanpa ping, dan server
// (atau sub-server tujuan /server ekonomi) pakai versi Minecraft yang beda,
// semua paket bakal salah baca & bikin bot spam "Read error ... Invalid tag".
// Kalau auto-detect masih gagal, isi manual versi persis punya server.
const FORCED_VERSION = undefined
const SKIP_PING = false

// Log SEMUA chat publik yang diterima bot, biar kelihatan bot beneran "dengar"
// chat server (penting buat diagnosa kalau command nggak direspon). Matikan
// dengan env CASINO_CHAT_DEBUG=0 kalau chat-nya terlalu ramai.
const CHAT_DEBUG = process.env.CASINO_CHAT_DEBUG !== '0'

// Paket yang BUKAN chat pemain tapi ikut ke-emit lewat event 'text' di server
// ini (Geyser/JavRock). Dulu semua ini ikut dilog sebagai "CHAT MASUK" ->
// log banjir sampah (contoh: jukebox_popup berisi id lagu + jam dunia).
// Tambahkan jenis lain di sini kalau nanti muncul spam serupa.
const IGNORED_PACKET_TYPES = new Set([
  'jukebox_popup',
  'set_time',
  'set_difficulty',
  'animate',
  'level_event',
  'entity_event',
  'play_sound',
  'spawn_particle_effect',
  'level_sound_event'
])

// Paket ini tetap boleh lolos walau tipenya tidak dikenal (chat asli biasanya
// type 'chat' / 'whisper' / 'translation' / kosong di beberapa versi).
const CHAT_PACKET_TYPES = new Set(['chat', 'whisper', 'translation', 'popup', 'raw', 'tip', 'system'])


// Kalau dalam jendela waktu ini muncul error parsing beruntun sebanyak
// ERROR_BURST_LIMIT pada 1 bot, anggap koneksi bot itu desync total (biasanya
// abis pindah sub-server versi beda) - paksa putus & reconnect dari nol.
const ERROR_BURST_LIMIT = 5
const ERROR_BURST_WINDOW_MS = 3000

// Jeda minimal per-bot sebelum boleh kirim chat lagi (deteksi anti-spam server).
const PER_BOT_COOLDOWN_MS = 7000

// ==================== PERGERAKAN MINIMAL (biar bot boleh chat) ====================
// Server JavRock/Geyser menolak chat dari pemain yang BELUM BERGERAK:
//   "Sorry, but you have to move a little more before you can chat."
// Jadi tiap bot: (1) kirim player_auth_input tiap tick, (2) MUTER pelan di
// tempat terus-menerus. Muternya harus TERUSAN, bukan cuma 3 detik sekali —
// bot ini dipindah ke sub-server lain (/server survival) tepat setelah spawn,
// dan hitungan "sudah bergerak" di server baru mulai dari NOL lagi.
const TICK_MS = 50 // 1 tick Minecraft = 50ms (20 tick/detik)
const TICK_JITTER_MS = 4 // jitter kecil biar tidak presisi "robotik"
// Kecepatan jalan (block per tick). PENTING: harus kecepatan jalan NORMAL.
// Kalau posisi dipindah lebih jauh dari ini dalam 1 tick, server menganggapnya
// TELEPORT dan menolak (itulah kenapa bot kelihatan "diam" walau paket terkirim).
const MOVE_SPEED = 0.2
// Belokan arah per tick (radian). Bikin bot jalan muter lingkaran kecil.
const BELOK_PER_TICK = 0.06 // ~3.4 derajat per tick
// Diagnosa: tulis ke FILE terpisah (JANGAN ke terminal user) supaya terminal
// tetap bersih. Aktifkan dengan CASINO_GERAK_DEBUG=1.
const GERAK_DEBUG = process.env.CASINO_GERAK_DEBUG === '1'
const fs = require('fs')
const GERAK_LOG_FILE = process.env.CASINO_GERAK_LOG || '/tmp/gerak_diag.txt'
function gerakLog (bot, pesan) {
  if (!GERAK_DEBUG) return
  try {
    fs.appendFileSync(GERAK_LOG_FILE, `[${new Date().toISOString()}] [${bot.username}] ${pesan}\n`)
  } catch (_) {}
}


// 3 akun bot. role 'deposit' = akun yang nampung /pay dari player, satu-satunya
// 3 akun bot. role 'deposit' = akun yang nampung /pay dari player & yang boleh
// konfirmasi deposit/withdraw. SEMUA bot jadi "telinga" chat (biar command
// tetap kebaca walau bot deposit sedang offline), tapi tiap pesan publik
// diproses SEKALI saja - lihat sudahDiproses().
//
// PENTING: `username` = nama FOLDER auth (profil login Microsoft) di folder
// `auth/`. `gamertag` = nama yang MUNCUL di chat in-game. Keduanya sering beda
// (folder auth boleh "BOT1", tapi nama in-game bisa "IsanKaramazv"). Kalau
// `gamertag` salah, bot bisa salah kenali pesannya sendiri / pesan bot lain.
// Isi `gamertag` dengan nama in-game yang benar, atau biarkan kosong kalau
// memang sama dengan `username`.
const BOTS_CONFIG = [
  { username: 'BOT1', gamertag: process.env.CASINO_BOT1_TAG || 'BOT1', role: 'deposit' },
  { username: 'BOT2', gamertag: process.env.CASINO_BOT2_TAG || 'BOT2', role: 'helper' },
  { username: 'BOT3', gamertag: process.env.CASINO_BOT3_TAG || 'BOT3', role: 'helper' }
]

// ==================== STATE ====================
const bots = BOTS_CONFIG.map((cfg, index) => ({
  index,
  username: cfg.username,
  gamertag: cfg.gamertag || cfg.username,
  role: cfg.role,
  client: null,
  status: 'disconnected',
  reconnectAttempts: 0,
  errorTimestamps: [],
  lastChatAt: 0,
  // anti nyangkut / anti serempak
  connecting: false, // true selama percobaan connect berjalan
  lastConnectAt: 0, // kapan terakhir mulai connect (buat gate global)
  watchdog: null, // timer pemaksa kalau belum spawn
  reconnectTimer: null, // timer reconnect tertunda (biar tak dobel)
  everSpawned: false, // pernah berhasil spawn minimal 1x?
  rateLimited: false, // terakhir ditolak karena "too fast"?
  // ---- state pergerakan minimal (lihat PERGERAKAN MINIMAL di atas) ----
  bolehChat: false, // sudah jalan dikit? kalau belum, chat ditahan
  moveTimer: null, // timer loop player_auth_input
  authTick: 0n, // counter tick dunia (dari start_game.current_tick)
  pos: { x: 0, y: 64, z: 0 }, // posisi yang kita kirim (dikoreksi server)
  lastSentPos: { x: 0, y: 64, z: 0 },
  yaw: 0, // arah hadap (derajat); 0 = +Z
  pitch: 0,
  onGround: true,
  putaran: 0, // sudut putaran muter (radian)
  runtimeId: null // runtime_entity_id KITA (saring move_player pemain lain)
}))
const DEPOSIT_BOT = bots.find((b) => b.role === 'deposit')

// GATE LOGIN GLOBAL — pastikan HANYA SATU bot yang login pada satu waktu, dan
// ada jeda minimal LOGIN_GAP_MS antar login. Ini kunci biar server nggak
// bilang "You are logging in too fast". Semua bot antre lewat sini.
let lastLoginStartedAt = 0
const loginQueue = []
let loginQueueRunning = false

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Antre buat dapat izin login. Resolve setelah giliran tiba & jeda terpenuhi.
function acquireLoginSlot (bot) {
  return new Promise((resolve) => {
    loginQueue.push({ bot, resolve })
    pumpLoginQueue()
  })
}

async function pumpLoginQueue () {
  if (loginQueueRunning) return
  loginQueueRunning = true
  try {
    while (loginQueue.length) {
      const item = loginQueue.shift()
      // Kalau bot sudah tidak perlu login (dimatikan), lewati.
      if (isShuttingDown) {
        item.resolve(false)
        continue
      }
      const sinceLast = Date.now() - lastLoginStartedAt
      const wait = LOGIN_GAP_MS - sinceLast
      if (wait > 0) await sleep(wait)
      lastLoginStartedAt = Date.now()
      item.resolve(true)
    }
  } finally {
    loginQueueRunning = false
  }
}

let rotationIndex = 0
const messageQueue = [] // { message, targetBotUsername | null }
let isShuttingDown = false
const duels = new Map() // key: target username lowercase -> { challenger, target, amount, pick, timeoutHandle }

// Gema chat KITA SENDIRI: server broadcast balik pesan bot ke semua client
// (termasuk bot itu sendiri). Kita catat teksnya sebentar supaya gema itu
// tidak salah dianggap command dari player, SEKALIGUS buat "belajar" nama
// in-game asli tiap bot (gamertag) otomatis tanpa perlu diisi manual.
const recentSelfChats = new Map() // teks pesan -> { botUsername, at }
const SELF_CHAT_TTL_MS = 20000

// Dedupe: karena SEMUA bot jadi "telinga", tiap pesan publik diterima 3x.
// Map ini memastikan satu pesan cuma diproses SEKALI oleh bot yang pertama
// mendengarnya.
const handledChatKeys = new Map()

function catatChatSendiri (bot, message) {
  const key = String(message || '').trim().replace(/\s+/g, ' ')
  if (!key) return
  recentSelfChats.set(key, { botUsername: bot.username, at: Date.now() })
}

function sudahDiproses (key, ttlMs) {
  const now = Date.now()
  for (const [k, t] of handledChatKeys) if (now - t > ttlMs) handledChatKeys.delete(k)
  if (handledChatKeys.has(key)) return true
  handledChatKeys.set(key, now)
  return false
}

// ==================== UTIL ====================
function nowStr () {
  return new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })
}

function log (...args) {
  console.log(`[${nowStr()}]`, ...args)
}

// ==================== JARING PENGAMAN GLOBAL ====================
// bedrock-protocol kadang nembak beberapa 'error' event beruntun DI TICK YANG
// SAMA waktu 1 chunk data isinya banyak paket dan salah satunya gagal parse
// (misal NBT rusak abis pindah sub-server versi beda). client.close() yang
// dipanggil circuit breaker di bawah bisa keburu removeAllListeners()
// sementara masih ada error susulan dari paket lain di loop yang sama -
// error susulan itu nembak ke listener yang udah nggak ada -> Node anggap
// "unhandled error" -> SELURUH proses (termasuk 3 bot lain yang sehat) ikut
// mati. Ini jaring pengaman terakhir: apapun yang lolos dari try/catch &
// circuit breaker per-bot, jangan sampai bikin proses mati total.
process.on('uncaughtException', (err) => {
  const m = err && err.message ? err.message : String(err)
  // Error parse NBT Geyser yang lolos (biasanya saat listener bot dilepas) —
  // aman, tidak perlu dilog berulang.
  if (/Invalid tag|Read error for|Read failure/i.test(m)) return
  log('🧯 Uncaught exception diamankan (bot lain tetap jalan):', m)
})
process.on('unhandledRejection', (err) => {
  log('🧯 Unhandled rejection diamankan:', err && err.message ? err.message : err)
})

// Buang semua kode warna/format Minecraft (§x) dari sebuah string.
function stripColor (s) {
  return String(s || '').replace(/§[0-9a-fk-or]/gi, '')
}

// Angka -> "1.5m" / "250k" / "2b" dst.
function formatCurrency (amount) {
  amount = Math.round(Number(amount) || 0)
  const sign = amount < 0 ? '-' : ''
  amount = Math.abs(amount)
  if (amount >= 1e9) return sign + trimZero(amount / 1e9) + 'b'
  if (amount >= 1e6) return sign + trimZero(amount / 1e6) + 'm'
  if (amount >= 1e3) return sign + trimZero(amount / 1e3) + 'k'
  return sign + amount.toString()
}
function trimZero (n) {
  return (Math.round(n * 100) / 100).toString()
}

// "1m" / "1.5k" / "1,000,000" / "1000" -> angka asli.
function parseCurrency (value) {
  let str = String(value || '').toUpperCase().trim().replace(/,/g, '')
  let mul = 1
  if (str.endsWith('B')) { mul = 1e9; str = str.slice(0, -1) } else if (str.endsWith('M')) { mul = 1e6; str = str.slice(0, -1) } else if (str.endsWith('K')) { mul = 1e3; str = str.slice(0, -1) }
  const n = parseFloat(str)
  if (isNaN(n)) return 0
  return Math.round(n * mul)
}

function isKnownBotUsername (name) {
  if (!name) return false
  const n = String(name).toLowerCase()
  return bots.some((b) => b.username.toLowerCase() === n || (b.gamertag || '').toLowerCase() === n)
}

// ==================== HELPER COMMAND BARU ====================
// Rate-limit per pemain: maks N command / 10 detik (cegah spam).
const ratePemain = new Map() // key -> [timestamps]
function kenaRateLimit (sender) {
  const key = String(sender).toLowerCase()
  const now = Date.now()
  const arr = (ratePemain.get(key) || []).filter((t) => now - t < 10000)
  arr.push(now)
  ratePemain.set(key, arr)
  return arr.length > (CFG.antiSpam.maxCommandPer10Detik || 5)
}

// Validasi taruhan: angka > 0, dalam batas min/max. Return {ok, amount, pesan}.
function validasiTaruhan (betStr) {
  const amount = parseCurrency(betStr)
  if (!(amount > 0)) return { ok: false, pesan: 'jumlah taruhan salah. Contoh: 1k / 500k / 1m' }
  if (amount < (CFG.ekonomi.taruhanMin || 100)) return { ok: false, pesan: `taruhan minimal ${formatCurrency(CFG.ekonomi.taruhanMin)}` }
  if (amount > (CFG.ekonomi.taruhanMax || 1e8)) return { ok: false, pesan: `taruhan maksimal ${formatCurrency(CFG.ekonomi.taruhanMax)}` }
  return { ok: true, amount }
}

// Cooldown: return sisa ms kalau masih cooldown, 0 kalau bebas.
function sisaCooldown (sender, jenis) {
  const sampai = db.getCooldown(sender, jenis)
  return Math.max(0, sampai - Date.now())
}
function formatDurasi (ms) {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s} detik`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} menit`
  const h = Math.floor(m / 60)
  const mm = m % 60
  return mm ? `${h} jam ${mm} menit` : `${h} jam`
}

// Ambil nama target dari argumen (buang '@').
function namaTarget (arg) {
  return String(arg || '').replace(/^@/, '').trim()
}

// ==================== ADMIN (lewat CHAT) ====================
// Command ini HANYA bisa dipakai gamertag yang terdaftar sebagai admin
// (lihat db.isAdmin / database.json -> field "admins").
const ADMIN_COMMANDS = new Set([
  'admin', 'addsaldo', 'setsaldo', 'resetuser', 'ban', 'unban', 'banlist',
  'setjackpot', 'globalstat', 'adminlist', 'addadmin', 'deladmin', 'bc'
])
function isAdminCommand (first) {
  return ADMIN_COMMANDS.has(first)
}

// Potong jackpot: tiap taruhan menyumbang persenJackpot ke pool jackpot.
function sumbangJackpot (bet) {
  const persen = CFG.permainan.persenJackpot || 0
  if (persen > 0) db.addJackpot(Math.round(bet * persen))
}

// Jalankan 1 putaran permainan: validasi taruhan -> potong saldo -> hitung ->
// bayar kalau menang -> catat statistik. Return { bet, hasil, saldoAkhir } atau
// null (kalau gagal; pesan error sudah dikirim).
function jalankanTaruhan (sender, betStr, namaGame, hitung) {
  const v = validasiTaruhan(betStr)
  if (!v.ok) { enqueue(`@${sender} ${v.pesan}`); return null }
  const bet = v.amount
  const saldo = db.getBalance(sender)
  if (saldo < bet) { enqueue(`@${sender} saldo kamu nggak cukup! saldo kamu ${formatCurrency(saldo)}`); return null }
  const after = db.subBalance(sender, bet, `${namaGame}_bet`, `taruhan ${namaGame}`)
  if (after === false) { enqueue(`@${sender} saldo kamu nggak cukup! saldo kamu ${formatCurrency(saldo)}`); return null }
  sumbangJackpot(bet)
  const hasil = hitung(bet)
  if (hasil && hasil.error) {
    // rollback kalau argumen ternyata salah
    db.addBalance(sender, bet, 'refund', `batal ${namaGame}`)
    enqueue(`@${sender} ${hasil.error}`)
    return null
  }
  let payout = 0
  if (hasil.menang) {
    payout = hasil.hadiah
    db.addBalance(sender, payout, `${namaGame}_win`, `menang ${namaGame}`)
  }
  db.recordBet(sender, bet, payout, !!hasil.menang, namaGame)
  return { bet, hasil, saldoAkhir: db.getBalance(sender), payout }
}

// Pembungkus jawaban standar menang/kalah.
function balasHasil (sender, r, teksMenang, teksKalah) {
  if (r.hasil.menang) {
    enqueue(`@${sender} ${teksMenang} — menang ${formatCurrency(r.payout)}! saldo ${formatCurrency(r.saldoAkhir)}`)
    log(`🎮 ${r.hasil.game || ''} ${sender} MENANG ${formatCurrency(r.payout)} -> ${formatCurrency(r.saldoAkhir)}`)
  } else {
    enqueue(`@${sender} ${teksKalah} — saldo kamu ${formatCurrency(r.saldoAkhir)}`)
    log(`🎮 ${sender} KALAH -> ${formatCurrency(r.saldoAkhir)}`)
  }
}

// ==================== KIRIM CHAT (per-bot, dipanggil dari dispatcher) ====================
// Persis pola chatSend() di botManager.js kamu (field `category` &
// `has_filtered_message` wajib ada supaya packet 'text' kebaca bener sama server).
function chatSendFrom (bot, message) {
  if (!bot.client || !message) return false
  try {
    bot.client.queue('text', {
      type: 'chat',
      category: 'authored',
      needs_translation: false,
      source_name: bot.gamertag || bot.username,
      xuid: '',
      platform_chat_id: '',
      has_filtered_message: false,
      message
    })
    // Catat supaya gema chat kita sendiri (server broadcast balik ke kita)
    // tidak diproses sebagai command dari player.
    catatChatSendiri(bot, message)
    log(`📤 [${bot.username}] KIRIM:`, message)
    return true
  } catch (err) {
    log(`❌ [${bot.username}] Gagal kirim chat:`, err.message)
    return false
  }
}

// ==================== DISPATCHER ANTRIAN + ROTASI 4 BOT ====================
// enqueue(message)                       -> dikirim lewat bot manapun yang gantian & lagi free
// enqueue(message, 'IsanKaramazv')       -> dipaksa lewat bot tertentu (dipakai buat deposit/withdraw)
// Pesan yang menunggu lebih lama dari ini dibuang (mis. bot mati total),
// biar antrian tidak menumpuk balasan basi.
const QUEUE_MAX_AGE_MS = 60000

function enqueue (message, targetBotUsername = null) {
  messageQueue.push({ message, targetBotUsername, at: Date.now() })
  processQueue()
}

function pickNextAvailableIndex () {
  const now = Date.now()
  for (let i = 0; i < bots.length; i++) {
    const idx = (rotationIndex + i) % bots.length
    const b = bots[idx]
    // WAJIB sudah bolehChat (sudah bergerak cukup) — kalau belum, server
    // menolak chat-nya dengan "you have to move a little more...".
    if (b.status === 'spawned' && b.bolehChat && (now - b.lastChatAt) >= PER_BOT_COOLDOWN_MS) return idx
  }
  return -1
}

function processQueue () {
  const now = Date.now()
  for (let qi = 0; qi < messageQueue.length; qi++) {
    const item = messageQueue[qi]

    // Buang pesan yang sudah terlalu lama menunggu (bot mati total / nggak
    // ada yang spawn) supaya antrian tidak menumpuk balasan basi.
    if (item.at && (now - item.at) > QUEUE_MAX_AGE_MS) {
      log(`🗑️ Pesan kedaluwarsa dibuang: "${item.message}"`)
      messageQueue.splice(qi, 1)
      qi--
      continue
    }

    let bot = null

    if (item.targetBotUsername) {
      const want = item.targetBotUsername.toLowerCase()
      const found = bots.find((b) => b.username.toLowerCase() === want || (b.gamertag || '').toLowerCase() === want)
      if (found && found.status === 'spawned' && found.bolehChat && (now - found.lastChatAt) >= PER_BOT_COOLDOWN_MS) bot = found
    } else {
      const idx = pickNextAvailableIndex()
      if (idx !== -1) {
        bot = bots[idx]
        rotationIndex = (idx + 1) % bots.length
      }
    }

    if (!bot) continue // belum ada yang free, coba item berikutnya / nunggu ticker

    // Kalau ternyata GAGAL kirim (client belum siap), JANGAN buang pesannya -
    // biarkan di antrian buat dicoba lagi di tick berikutnya. Dulu pesan
    // dibuang diam-diam di sini, jadi balasan command bisa hilang tanpa jejak.
    const terkirim = chatSendFrom(bot, item.message)
    if (!terkirim) continue
    bot.lastChatAt = Date.now()
    messageQueue.splice(qi, 1)
    qi--
  }
}
setInterval(processQueue, 500)

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ==================== PARSING CHAT SERVER ====================
// PENTING (temuan 2026-10-04): server ini (JavRock/Geyser) memakai pemisah
// ">>", BUKAN "»". Format mentah asli dari server:
//   §r§8§l[§r§e§lNewbie§r§8§l] §r§f §r§8§l[]§r SannBets §b>> §r§f!help
// Setelah stripColor jadi:
//   [Newbie] [] SannBets >> !help
// Kode lama cuma nyari "»" -> SETIAP chat player gagal di-parse -> semua
// command (!help dll) tidak pernah diproses. Sekarang dua pemisah didukung.
//
// CATATAN PENTING KEDUA: `packet.source_name` di server ini SERING KOSONG
// (makanya di dashboard kelihatan "server:"), jadi nama pengirim WAJIB
// diambil dari TEKS chat-nya, bukan dari packet.source_name.
const CHAT_SEPARATORS = ['>>', '»']
const LEADING_TAGS_RE = /^(?:\[[^\]]*\]\s*)+/ // buang tag rank di depan: "[Newbie] [] "

// "…[Newbie] [] SannBets >> !help halo" -> { sender: 'SannBets', message: '!help halo' }
function parsePlayerChat (clean) {
  for (const sep of CHAT_SEPARATORS) {
    const i = clean.indexOf(sep)
    if (i === -1) continue
    const before = clean.slice(0, i)
    const after = clean.slice(i + sep.length)
    // Nama = sisa setelah tag rank dibuang (biar nama pakai spasi tetap utuh).
    const sender = before.replace(LEADING_TAGS_RE, '').trim()
    const message = after.trim()
    if (!sender || !message) continue
    return { sender, message }
  }
  return null
}

// Format notifikasi pembayaran ASLI (contoh mentah, broadcast publik):
//   §r§a$1,000,000§r§6 has been received from§r§a §r§7[§r§8RAKYAT§r§7] §r§fisann67§r§6.
// Setelah stripColor jadi (dan HARUS persis dari awal sampai akhir seperti ini):
//   $1,000,000 has been received from [RAKYAT] isann67.
const GENUINE_DEPOSIT_RE = /^\$\s*([\d,]+(?:\.\d+)?)\s+has been received from\s+(?:\[.*?\]\s*)*(\S+?)\.?\s*$/i

// KEAMANAN: player bisa coba tipu bot dengan /msg IsanKaramazv "$1,000,000 has
// been received from [rakyat] isann67" supaya nongol di chat bot mirip
// notifikasi asli. Pesan whisper/PM seperti itu kebungkus format beda
// ("PN | CHAT [pengirim > You] ..."), jadi:
//  1) regex di atas di-anchor ^...$ -> otomatis GAGAL match kalau ada
//     bungkus "PN | CHAT [...]" di depannya.
//  2) tetap kita blokir eksplisit juga kalau teksnya mengandung kata "chat"
//     atau pola whisper "[pengirim > You]", sebagai lapis pengaman kedua.
//  3) packet dengan type 'whisper' langsung diabaikan buat deteksi deposit,
//     cuma broadcast publik yang dianggap valid.
function looksLikeDepositExploit (clean) {
  return /chat/i.test(clean) || /\bpn\b/i.test(clean) || />\s*you\]/i.test(clean)
}

// ==================== AUTO SAPA WARP ====================
// Contoh chat server (dari user, 2026-10-04):
//   §r§f§lPLAYER§r§3§lWARPS§r§7 §r§8⏵ §r§fSannBets§r§7 has visited warp §r§fshop
// Setelah stripColor: "PLAYERWARPS ⏵ SannBets has visited warp shop"
// -> bot balas: "@SannBets selamat datang di warp shop, silakan belanja!"
// Sapaan khusus per-warp bisa diatur lewat env CASINO_WARP_GREET, format:
//   CASINO_WARP_GREET="shop=selamat datang di pw shop|afk=halo kak"
const WARP_VISIT_RE = /(?:⏵|▶|»|>)\s*(\S+)\s+has visited warp\s+(.+?)\s*$/i
const WARP_VISIT_FALLBACK_RE = /(\S+)\s+has visited warp\s+(.+?)\s*$/i

function parseWarpGreets () {
  const map = {}
  const raw = process.env.CASINO_WARP_GREET || ''
  raw.split('|').forEach((pair) => {
    const eq = pair.indexOf('=')
    if (eq > 0) map[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim()
  })
  return map
}
const WARP_GREETS = parseWarpGreets()

function handleWarpVisit (sender, warp) {
  if (isKnownBotUsername(sender)) return
  const key = warp.toLowerCase()
  const custom = WARP_GREETS[key]
  const msg = custom
    ? `@${sender} ${custom}`
    : `@${sender} selamat datang di warp ${warp}, silakan belanja sepuasnya!`
  log(`👋 SAPA WARP: ${sender} -> warp ${warp}`)
  enqueue(msg)
}

function handleIncomingChat (packet) {
  const rawMessage = packet.message
  const type = (packet.type || '').toLowerCase()
  const clean = stripColor(rawMessage).trim()
  if (!clean) return

  // ---- 0a. Buang paket NON-CHAT (jukebox_popup, set_time, dll) ----
  // Server ini menitipkan paket lain lewat event 'text' juga; tanpa filter ini
  // log banjir "CHAT MASUK [jukebox_popup]" terus-menerus.
  if (IGNORED_PACKET_TYPES.has(type)) return

  // Kalau tipenya JELAS bukan tipe chat yang dikenal, dan bukan tipe kosong
  // (beberapa versi tidak mengisi type), buang juga.
  if (type && !CHAT_PACKET_TYPES.has(type) && !IGNORED_PACKET_TYPES.has(type)) {
    // hanya log kalau debug, supaya kelihatan kalau ada tipe baru yang perlu
    // ditambahkan ke CHAT_PACKET_TYPES
    if (CHAT_DEBUG) log(`⏭️  Lewati paket non-chat [${type}]: ${clean.slice(0, 60)}`)
    return
  }

  // ---- 0. Log mentah (diagnosa) ----
  if (CHAT_DEBUG) log(`📥 CHAT MASUK [${packet.type || '?'}]: ${clean}`)

  // Parsing dasar dulu: siapa pengirim & apa isi pesannya (dari TEKS, karena
  // packet.source_name di server ini sering kosong).
  const parsed = parsePlayerChat(clean)

  // ---- 0b. Gema chat KITA SENDIRI -> sekalian belajar nama in-game asli ----
  // Server broadcast balik pesan bot ke semua client. Kalau ISI pesannya persis
  // salah satu yang baru kita kirim, ini gema kita sendiri: jangan diproses,
  // tapi CATAT nama pengirimnya sebagai gamertag bot itu (jadi nama in-game
  // terdeteksi otomatis tanpa perlu diisi manual).
  if (parsed) {
    const echoKey = parsed.message.replace(/\s+/g, ' ')
    const selfEcho = recentSelfChats.get(echoKey)
    if (selfEcho) {
      recentSelfChats.delete(echoKey)
      const bot = bots.find((b) => b.username === selfEcho.botUsername)
      if (bot && bot.gamertag === bot.username && !isKnownBotUsername(parsed.sender)) {
        bot.gamertag = parsed.sender
        log(`🏷️ [${bot.username}] Nama in-game terdeteksi otomatis: "${parsed.sender}"`)
      }
      return
    }
  }

  // ---- 0c. Auto-sapa player yang masuk warp ----
  if (packet.type !== 'whisper') {
    const warpMatch = clean.match(WARP_VISIT_RE) || clean.match(WARP_VISIT_FALLBACK_RE)
    if (warpMatch) {
      if (!sudahDiproses('warp|' + clean, 15000)) handleWarpVisit(warpMatch[1], warpMatch[2])
      return
    }
  }

  // ---- 1. Deteksi deposit (HANYA broadcast publik, whisper/PM ditolak mentah-mentah) ----
  if (packet.type !== 'whisper') {
    const payMatch = clean.match(GENUINE_DEPOSIT_RE)
    if (payMatch && !looksLikeDepositExploit(clean)) {
      const amount = parseInt(payMatch[1].replace(/,/g, ''), 10)
      const sender = payMatch[2]
      if (amount > 0 && sender && !isKnownBotUsername(sender)) {
        if (!sudahDiproses('dep|' + clean, 20000)) handleDeposit(sender, amount)
      }
      return
    }
    if (payMatch && looksLikeDepositExploit(clean)) {
      log(`🚫 Percobaan deposit palsu diblokir: "${clean}"`)
      return
    }
  }

  // ---- 2. Deteksi command "!" ----
  if (!parsed) return
  const { sender, message } = parsed
  if (message.startsWith('!') && !isKnownBotUsername(sender)) {
    // Dedupe: semua bot jadi "telinga", jadi 1 pesan bisa masuk 3x.
    if (sudahDiproses('cmd|' + clean, 10000)) return
    routeCommand(sender, message.slice(1).trim())
  }
}

// ==================== HANDLER COMMAND ====================
function routeCommand (sender, commandRaw) {
  const command = commandRaw.trim()
  const lower = command.toLowerCase()
  // Cocokkan berdasarkan KATA PERTAMA saja, supaya "!help halo" atau
  // "!saldo dong" tetap kena (pemain sering nambah teks setelah command).
  const first = lower.split(/\s+/)[0]
  const rest = command.split(/\s+/).slice(1).join(' ')

  // User yang diblokir: diemin aja.
  if (db.isBanned(sender)) return

  // Rate-limit anti-spam: kalau kebanyakan command, tegur sekali & stop.
  if (kenaRateLimit(sender)) {
    if (!sudahDiproses('rl|' + sender, 30000)) enqueue(`@${sender} santai dek, kebanyakan command. tunggu bentar ya`)
    return
  }

  log(`💬 Command dari ${sender}: "!${command}"`)

  // ---- ADMIN: cuma gamertag terdaftar admin yang boleh ----
  if (isAdminCommand(first)) {
    if (!db.isAdmin(sender)) {
      enqueue(`@${sender} command itu khusus admin, kamu nggak punya akses.`)
      log(`⛔ AKSES ADMIN DITOLAK: ${sender} coba "!${command}"`)
      return
    }
    return routeAdminCommand(sender, first, rest)
  }

  // ---- umum ----
  if (first === 'help') return handleHelp(sender)
  if (first === 'menu') return handleMenu(sender)
  if (first === 'rules' || first === 'aturan') return handleRules(sender)
  if (first === 'info') return handleInfo(sender)
  if (first === 'ping') return handlePing(sender)
  if (first === 'jam' || first === 'waktu') return handleJam(sender)
  if (first === 'saldo' || first === 'balance' || first === 'bal') return handleSaldo(sender, rest)
  if (first === 'withdraw' || first === 'wd') return handleWithdraw(sender, rest)
  if (first === 'top' || first === 'richest' || first === 'leaderboard') return handleTop(sender)
  if (first === 'history' || first === 'riwayat') return handleHistory(sender)
  if (first === 'stats' || first === 'statistik') return handleStats(sender, rest)
  if (first === 'profile' || first === 'profil') return handleProfile(sender, rest)
  if (first === 'transfer' || first === 'kirim') return handleTransfer(sender, rest)
  if (first === 'daily' || first === 'harian') return handleDaily(sender)
  if (first === 'kerja' || first === 'work') return handleKerja(sender)
  if (first === 'rampok' || first === 'rob') return handleRampok(sender, rest)
  if (first === 'voucher' || first === 'kode') return handleVoucher(sender, rest)
  if (first === 'jackpot') return handleJackpotInfo(sender)
  if (first === 'roll') return handleRoll(sender, rest)
  if (first === '8ball' || first === 'bola') return handle8ball(sender)
  if (first === 'quote' || first === 'motivasi') return handleQuote(sender)
  if (first === 'pantun') return handlePantun(sender)
  if (first === 'tarot') return handleTarot(sender)
  if (first === 'truth' || first === 'dare') return handleTruthDare(sender, first)

  // ---- permainan ----
  if (first === 'casino') return handleCasino(sender, rest)
  if (first === 'slot') return handleSlot(sender, rest)
  if (first === 'dadu' || first === 'dice') return handleDadu(sender, rest)
  if (first === 'roulette' || first === 'roul') return handleRoulette(sender, rest)
  if (first === 'tebak') return handleTebak(sender, rest)
  if (first === 'hilo') return handleHilo(sender, rest)
  if (first === 'togel') return handleTogel(sender, rest)
  if (first === 'crash') return handleCrash(sender, rest)
  if (first === 'mines' || first === 'tambang') return handleMines(sender, rest)
  if (first === 'gacha') return handleGacha(sender)
  if (first === 'spin') return handleSpin(sender, rest)

  // ---- coinflip ----
  if (first === 'coinflip') return handleCoinflipChallenge(sender, rest)
  if (first === 'acc' || first === 'accept') return handleCoinflipAccept(sender)

  // Command nggak dikenal -> diemin aja (jangan spam chat)
}

// ==================== HANDLER COMMAND ADMIN (via CHAT) ====================
function routeAdminCommand (sender, first, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  log(`🛡️  ADMIN ${sender}: "!${first} ${rest}"`)

  if (first === 'admin') {
    enqueue(`@${sender} 🛡️ Command admin: !addsaldo <user> <jml>, !setsaldo <user> <jml>, !resetuser <user>, !ban <user>, !unban <user>, !banlist, !setjackpot <jml>, !globalstat, !adminlist, !addadmin <user>, !deladmin <user>, !bc <pesan>`)
    return
  }
  if (first === 'addsaldo') {
    if (parts.length < 2) return enqueue(`@${sender} format: !addsaldo <user> <jumlah>`)
    const target = namaTarget(parts[0])
    const amount = parseCurrency(parts[1])
    if (amount <= 0) return enqueue(`@${sender} jumlah salah.`)
    const bal = db.addBalance(target, amount, 'admin_add', `oleh ${sender} via chat`)
    log(`🛡️  ADMIN ${sender} addsaldo ${target} +${formatCurrency(amount)} -> ${formatCurrency(bal)}`)
    return enqueue(`@${sender} ✅ saldo ${target} ditambah ${formatCurrency(amount)}, sekarang ${formatCurrency(bal)}`)
  }
  if (first === 'setsaldo') {
    if (parts.length < 2) return enqueue(`@${sender} format: !setsaldo <user> <jumlah>`)
    const target = namaTarget(parts[0])
    const amount = parseCurrency(parts[1])
    const bal = db.setBalance(target, amount)
    log(`🛡️  ADMIN ${sender} setsaldo ${target} -> ${formatCurrency(bal)}`)
    return enqueue(`@${sender} ✅ saldo ${target} diset ke ${formatCurrency(bal)}`)
  }
  if (first === 'resetuser') {
    if (!parts[0]) return enqueue(`@${sender} format: !resetuser <user>`)
    const target = namaTarget(parts[0])
    db.resetUser(target)
    log(`🛡️  ADMIN ${sender} reset ${target}`)
    return enqueue(`@${sender} ✅ saldo & history ${target} direset.`)
  }
  if (first === 'ban') {
    if (!parts[0]) return enqueue(`@${sender} format: !ban <user>`)
    const target = namaTarget(parts[0])
    db.banUser(target)
    log(`🛡️  ADMIN ${sender} ban ${target}`)
    return enqueue(`@${sender} 🚫 ${target} diblokir dari command.`)
  }
  if (first === 'unban') {
    if (!parts[0]) return enqueue(`@${sender} format: !unban <user>`)
    const target = namaTarget(parts[0])
    db.unbanUser(target)
    log(`🛡️  ADMIN ${sender} unban ${target}`)
    return enqueue(`@${sender} ✅ ${target} dibuka blokirnya.`)
  }
  if (first === 'banlist') {
    const b = db.listBanned()
    return enqueue(`@${sender} ${b.length ? '🚫 diblokir: ' + b.join(', ') : 'tidak ada user diblokir.'}`)
  }
  if (first === 'setjackpot') {
    const amount = parseCurrency(parts[0])
    if (amount < 0) return enqueue(`@${sender} jumlah salah.`)
    db.setJackpot(amount)
    log(`🛡️  ADMIN ${sender} setjackpot -> ${formatCurrency(amount)}`)
    return enqueue(`@${sender} ✅ jackpot diset ke ${formatCurrency(amount)}`)
  }
  if (first === 'globalstat') {
    const m = db.getMeta()
    const users = db.listUsers()
    const totalSaldo = users.reduce((a, u) => a + (u.balance || 0), 0)
    return enqueue(`@${sender} 📊 user ${users.length}, total saldo ${formatCurrency(totalSaldo)}, jackpot ${formatCurrency(m.jackpot)}, total taruhan ${formatCurrency(m.totalBet)}, total payout ${formatCurrency(m.totalPayout)}`)
  }
  if (first === 'adminlist') {
    const a = db.listAdmins()
    return enqueue(`@${sender} 🛡️ admin: ${a.length ? a.join(', ') : '(kosong)'}`)
  }
  if (first === 'addadmin') {
    if (!parts[0]) return enqueue(`@${sender} format: !addadmin <user>`)
    const target = namaTarget(parts[0])
    db.addAdmin(target)
    log(`🛡️  ADMIN ${sender} addadmin ${target}`)
    return enqueue(`@${sender} ✅ ${target} sekarang jadi admin.`)
  }
  if (first === 'deladmin') {
    if (!parts[0]) return enqueue(`@${sender} format: !deladmin <user>`)
    const target = namaTarget(parts[0])
    if (String(target).toLowerCase() === String(sender).toLowerCase()) return enqueue(`@${sender} nggak bisa hapus diri sendiri.`)
    db.removeAdmin(target)
    log(`🛡️  ADMIN ${sender} deladmin ${target}`)
    return enqueue(`@${sender} ✅ ${target} bukan admin lagi.`)
  }
  if (first === 'bc') {
    if (!rest.trim()) return enqueue(`@${sender} format: !bc <pesan>`)
    log(`🛡️  ADMIN ${sender} broadcast: ${rest}`)
    return enqueue(`📢 ${rest.trim()}`)
  }
}

function handleHelp (sender) {
  enqueue(`@${sender} Bot Casino ISAN, silakan /pay ${DEPOSIT_BOT.gamertag || DEPOSIT_BOT.username} (jumlah) untuk deposit saldo! ketik !menu buat liat semua command`)
}

function handleMenu (sender) {
  enqueue(`@${sender} Menu: !saldo, !withdraw, !transfer, !daily, !kerja, !top, !stats, !history, !profile, !rules, !info, !ping`)
  enqueue(`@${sender} Game: !casino, !slot, !dadu, !roulette, !tebak, !hilo, !togel, !crash, !mines, !coinflip, !gacha, !spin, !jackpot`)
  enqueue(`@${sender} Hiburan: !roll, !8ball, !quote, !pantun, !tarot, !truth, !dare`)
}

function handleRules (sender) {
  enqueue(`@${sender} Aturan: 1) deposit lewat /pay ${DEPOSIT_BOT.gamertag || DEPOSIT_BOT.username}. 2) taruhan min ${formatCurrency(CFG.ekonomi.taruhanMin)}, maks ${formatCurrency(CFG.ekonomi.taruhanMax)}. 3) withdraw lewat !withdraw. 4) jangan spam command. 5) yang curang/exploit kena ban.`)
}

function handleInfo (sender) {
  enqueue(`@${sender} ISAN Casino Bot — server ${SERVER_HOST}:${SERVER_PORT}, 3 akun bot. Jackpot saat ini ${formatCurrency(db.getMeta().jackpot)}.`)
}

function handlePing (sender) {
  const online = bots.filter((b) => b.status === 'spawned').length
  enqueue(`@${sender} pong! 🏓 bot online ${online}/${bots.length}`)
}

function handleJam (sender) {
  const wib = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  enqueue(`@${sender} jam sekarang (WIB) ${wib}`)
}

function handleSaldo (sender, rest) {
  const target = rest ? namaTarget(rest) : sender
  if (rest && target.toLowerCase() !== sender.toLowerCase() && !db.getBalance(target)) {
    // tetap tampilkan (mungkin 0)
  }
  const bal = db.getBalance(target)
  enqueue(`@${sender} saldo ${target} = ${formatCurrency(bal)}`)
}

function handleTop (sender) {
  const top = db.getTop(5)
  if (!top.length) { enqueue(`@${sender} belum ada yang punya saldo.`); return }
  const list = top.map((u, i) => `${i + 1}. ${u.username} (${formatCurrency(u.balance)})`).join(' | ')
  enqueue(`@${sender} 🏆 Top 5: ${list}`)
}

function handleHistory (sender) {
  const u = db.ensureUser(sender)
  const h = (u.history || []).slice(-5).reverse()
  if (!h.length) { enqueue(`@${sender} belum ada riwayat transaksi.`); return }
  const list = h.map((e) => `${e.type} ${e.amount > 0 ? '+' : ''}${formatCurrency(e.amount)}`).join(' | ')
  enqueue(`@${sender} 5 transaksi terakhir: ${list}`)
}

function handleStats (sender, rest) {
  const target = rest ? namaTarget(rest) : sender
  const s = db.getStats(target)
  enqueue(`@${sender} stats ${target}: main ${s.games}x, menang ${s.wins}, kalah ${s.losses}, winrate ${s.winrate}%, total taruhan ${formatCurrency(s.totalBet)}, biggest win ${formatCurrency(s.biggestWin)}`)
}

function handleProfile (sender, rest) {
  const target = rest ? namaTarget(rest) : sender
  const s = db.getStats(target)
  const bal = db.getBalance(target)
  enqueue(`@${sender} 👤 ${target} | saldo ${formatCurrency(bal)} | main ${s.games}x | winrate ${s.winrate}% | biggest win ${formatCurrency(s.biggestWin)}`)
}

function handleTransfer (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) { enqueue(`@${sender} format: !transfer @nama 1k`); return }
  const target = namaTarget(parts[0])
  const amount = parseCurrency(parts[1])
  if (!target || amount <= 0) { enqueue(`@${sender} format: !transfer @nama 1k`); return }
  if (isKnownBotUsername(target)) { enqueue(`@${sender} nggak bisa transfer ke bot wkwk`); return }
  const pajak = CFG.ekonomi.pajakTransfer || 0
  const r = db.transferBalance(sender, target, amount, pajak)
  if (!r.ok) { enqueue(`@${sender} transfer gagal: ${r.reason}`); return }
  log(`🔁 TRANSFER ${sender} -> ${target} ${formatCurrency(amount)} (pajak ${formatCurrency(r.tax)})`)
  enqueue(`@${sender} berhasil kirim ${formatCurrency(amount)} ke ${target} (pajak ${formatCurrency(r.tax)}, diterima ${formatCurrency(r.diterima)}). saldo kamu ${formatCurrency(r.saldoPengirim)}`)
}

function handleDaily (sender) {
  const sisa = sisaCooldown(sender, 'daily')
  if (sisa > 0) { enqueue(`@${sender} bonus harian udah kamu ambil. coba lagi ${formatDurasi(sisa)} lagi.`); return }
  const hadiah = CFG.ekonomi.hadiahDaily || 5000
  db.setCooldown(sender, 'daily', CFG.ekonomi.cooldownDailyMs || 86400000)
  const bal = db.addBalance(sender, hadiah, 'daily', 'bonus harian')
  log(`🎁 DAILY ${sender} +${formatCurrency(hadiah)} -> ${formatCurrency(bal)}`)
  enqueue(`@${sender} bonus harian ${formatCurrency(hadiah)}! saldo kamu ${formatCurrency(bal)}`)
}

function handleKerja (sender) {
  const sisa = sisaCooldown(sender, 'kerja')
  if (sisa > 0) { enqueue(`@${sender} kamu capek, istirahat dulu ${formatDurasi(sisa)} lagi.`); return }
  const gaji = CFG.ekonomi.gajiKerja || 2500
  db.setCooldown(sender, 'kerja', CFG.ekonomi.cooldownKerjaMs || 300000)
  const bal = db.addBalance(sender, gaji, 'kerja', 'cari uang')
  log(`💼 KERJA ${sender} +${formatCurrency(gaji)} -> ${formatCurrency(bal)}`)
  enqueue(`@${sender} kamu kerja dan dapat ${formatCurrency(gaji)}! saldo kamu ${formatCurrency(bal)}`)
}

function handleRampok (sender, rest) {
  const target = namaTarget(rest)
  if (!target) { enqueue(`@${sender} format: !rampok @nama`); return }
  if (isKnownBotUsername(target)) { enqueue(`@${sender} nggak bisa rampok bot wkwk`); return }
  if (target.toLowerCase() === sender.toLowerCase()) { enqueue(`@${sender} masa rampok diri sendiri wkwk`); return }
  const sisa = sisaCooldown(sender, 'rampok')
  if (sisa > 0) { enqueue(`@${sender} polisi masih jaga, tunggu ${formatDurasi(sisa)} lagi.`); return }
  db.setCooldown(sender, 'rampok', CFG.ekonomi.cooldownRampokMs || 600000)
  const targetBal = db.getBalance(target)
  const peluang = CFG.ekonomi.peluangRampok || 0.3
  if (targetBal <= 0) { enqueue(`@${sender} ${target} nggak punya saldo, rampok gagal.`); return }
  if (Math.random() < peluang) {
    const curian = Math.max(1, Math.round(targetBal * 0.2))
    db.subBalance(target, curian, 'dirampok', `dirampok ${sender}`)
    const bal = db.addBalance(sender, curian, 'rampok', `rampok ${target}`)
    log(`🥷 RAMPOK ${sender} -> ${target} sukses ${formatCurrency(curian)}`)
    enqueue(`@${sender} berhasil rampok ${target}! dapet ${formatCurrency(curian)}, saldo kamu ${formatCurrency(bal)}`)
  } else {
    const denda = Math.max(1, Math.round(db.getBalance(sender) * (CFG.ekonomi.dendaRampok || 0.25)))
    const bal = db.subBalance(sender, denda, 'denda_rampok', 'gagal rampok')
    log(`🚨 RAMPOK ${sender} gagal, denda ${formatCurrency(denda)}`)
    enqueue(`@${sender} rampok gagal, kamu ketangkep! denda ${formatCurrency(denda)}, saldo kamu ${formatCurrency(bal === false ? db.getBalance(sender) : bal)}`)
  }
}

function handleVoucher (sender, rest) {
  const kode = String(rest || '').trim().toUpperCase()
  const vouchers = { ISAN2026: 10000, GRATIS: 5000, JACKPOT: 25000 }
  if (!kode) { enqueue(`@${sender} format: !voucher <kode>`); return }
  if (!vouchers[kode]) { enqueue(`@${sender} kode voucher salah atau udah kedaluwarsa.`); return }
  if (sisaCooldown(sender, 'voucher_' + kode) > 0) { enqueue(`@${sender} kode ${kode} udah kamu pakai.`); return }
  db.setCooldown(sender, 'voucher_' + kode, 315360000000) // ~10 tahun = sekali pakai
  const bal = db.addBalance(sender, vouchers[kode], 'voucher', `kode ${kode}`)
  log(`🎟️ VOUCHER ${sender} ${kode} +${formatCurrency(vouchers[kode])}`)
  enqueue(`@${sender} voucher ${kode} berhasil! dapet ${formatCurrency(vouchers[kode])}, saldo kamu ${formatCurrency(bal)}`)
}

function handleJackpotInfo (sender) {
  enqueue(`@${sender} 💰 JACKPOT saat ini ${formatCurrency(db.getMeta().jackpot)}! menang !slot 3 sama persis buat kesempatan ambil jackpot.`)
}

function handleRoll (sender, rest) {
  const maks = parseInt(rest, 10)
  const hasil = games.mainRoll(maks)
  enqueue(`@${sender} 🎲 kamu dapet ${hasil}`)
}

function handle8ball (sender) {
  enqueue(`@${sender} 🎱 ${games.main8ball()}`)
}

function handleQuote (sender) {
  enqueue(`@${sender} 💬 ${games.mainQuote()}`)
}

function handlePantun (sender) {
  enqueue(`@${sender} 📜 ${games.mainPantun()}`)
}

function handleTarot (sender) {
  const t = games.mainTarot()
  enqueue(`@${sender} 🔮 kartu kamu: ${t.kartu} (${t.arti})`)
}

function handleTruthDare (sender, mode) {
  enqueue(`@${sender} ${mode === 'dare' ? '😈 DARE' : '😇 TRUTH'}: ${games.mainTruthOrDare(mode)}`)
}

// ---- Permainan ----
function handleSlot (sender, rest) {
  const r = jalankanTaruhan(sender, rest, 'slot', (bet) => games.mainSlot(bet))
  if (!r) return
  const reels = r.hasil.reels.join(' ')
  if (r.hasil.menang) {
    enqueue(`@${sender} 🎰 [ ${reels} ] menang x${r.hasil.pengali}! +${formatCurrency(r.payout)} saldo ${formatCurrency(r.saldoAkhir)}`)
    log(`🎰 SLOT ${sender} MENANG x${r.hasil.pengali} +${formatCurrency(r.payout)}`)
  } else {
    enqueue(`@${sender} 🎰 [ ${reels} ] zonk! saldo kamu ${formatCurrency(r.saldoAkhir)}`)
  }
}

function handleDadu (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  const tebakan = parseInt(parts[1], 10)
  if (!(tebakan >= 1 && tebakan <= 6)) { enqueue(`@${sender} format: !dadu 1k 3 (tebak angka 1-6)`); return }
  const r = jalankanTaruhan(sender, parts[0], 'dadu', (bet) => games.mainDadu(bet, tebakan, CFG.permainan.pengaliDadu))
  if (!r) return
  enqueue(`@${sender} 🎲 dadu keluar ${r.hasil.hasil} (tebakanmu ${tebakan}) ${r.hasil.menang ? `menang x${r.hasil.pengali}! +${formatCurrency(r.payout)}` : 'zonk!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleRoulette (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) { enqueue(`@${sender} format: !roulette 1k merah|hitam|hijau|0-36`); return }
  const r = jalankanTaruhan(sender, parts[0], 'roulette', (bet) => games.mainRoulette(bet, parts[1], {
    pengaliAngka: CFG.permainan.pengaliRouletteAngka, pengaliHijau: CFG.permainan.pengaliRouletteHijau, pengaliWarna: CFG.permainan.pengaliRouletteWarna
  }))
  if (!r) return
  enqueue(`@${sender} 🎡 bola jatuh di ${r.hasil.angka} (${r.hasil.warna}) ${r.hasil.menang ? `menang x${r.hasil.pengali}! +${formatCurrency(r.payout)}` : 'zonk!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleTebak (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  const tebakan = parseInt(parts[1], 10)
  if (!(tebakan >= 1 && tebakan <= 10)) { enqueue(`@${sender} format: !tebak 1k 7 (tebak angka 1-10)`); return }
  const r = jalankanTaruhan(sender, parts[0], 'tebak', (bet) => games.mainTebak(bet, tebakan, CFG.permainan.pengaliTebak))
  if (!r) return
  enqueue(`@${sender} 🔢 angkanya ${r.hasil.hasil} ${r.hasil.menang ? `menang x${r.hasil.pengali}! +${formatCurrency(r.payout)}` : 'zonk!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleHilo (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) { enqueue(`@${sender} format: !hilo 1k tinggi|rendah`); return }
  const r = jalankanTaruhan(sender, parts[0], 'hilo', (bet) => games.mainHilo(bet, parts[1], CFG.permainan.pengaliHilo))
  if (!r) return
  enqueue(`@${sender} 🃏 kartu ${r.hasil.kartu1} -> ${r.hasil.kartu2} (kamu pilih ${r.hasil.pilihan}) ${r.hasil.menang ? `menang x${r.hasil.pengali}! +${formatCurrency(r.payout)}` : 'zonk!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleTogel (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 2) { enqueue(`@${sender} format: !togel 1k 1234 (4 angka)`); return }
  const r = jalankanTaruhan(sender, parts[0], 'togel', (bet) => games.mainTogel(bet, parts[1], CFG.permainan.pengaliTogel))
  if (!r) return
  enqueue(`@${sender} 🎯 togel keluar ${r.hasil.hasil} ${r.hasil.menang ? `JACKPOT x${r.hasil.pengali}! +${formatCurrency(r.payout)}` : 'belum hoki!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleCrash (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  const target = parseFloat(parts[1])
  if (!(target >= 1.01)) { enqueue(`@${sender} format: !crash 1k 2 (target multiplier, min 1.01)`); return }
  const r = jalankanTaruhan(sender, parts[0], 'crash', (bet) => games.mainCrash(bet, target))
  if (!r) return
  enqueue(`@${sender} 📈 crash di x${r.hasil.bust} (targetmu x${r.hasil.target}) ${r.hasil.menang ? `menang! +${formatCurrency(r.payout)}` : 'bust!'} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleMines (sender, rest) {
  const parts = rest.trim().split(/\s+/).filter(Boolean)
  const buka = parseInt(parts[1], 10)
  if (!(buka >= 1 && buka <= 10)) { enqueue(`@${sender} format: !mines 1k 3 (buka 1-10 kotak, ada 3 bom)`); return }
  const r = jalankanTaruhan(sender, parts[0], 'mines', (bet) => games.mainMines(bet, buka, { bom: 3 }))
  if (!r) return
  enqueue(`@${sender} 💣 kamu buka ${r.hasil.amanTerbuka} kotak aman ${r.hasil.kenaBom ? 'tapi kena bom!' : `pengali x${r.hasil.pengali}!`} ${r.hasil.menang ? `+${formatCurrency(r.payout)}` : ''} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleGacha (sender) {
  const sisa = sisaCooldown(sender, 'gacha')
  if (sisa > 0) { enqueue(`@${sender} gacha cooldown, tunggu ${formatDurasi(sisa)} lagi.`); return }
  db.setCooldown(sender, 'gacha', CFG.ekonomi.cooldownGachaMs || 3600000)
  const it = games.mainGacha()
  log(`🎁 GACHA ${sender} dapat ${it.nama} (${it.langka})`)
  enqueue(`@${sender} 🎁 gacha: kamu dapat ${it.nama} [${it.langka}]!`)
}

function handleSpin (sender, rest) {
  const r = jalankanTaruhan(sender, rest, 'spin', (bet) => games.mainSpin(bet))
  if (!r) return
  enqueue(`@${sender} 🎡 roda berhenti di ${r.hasil.label} ${r.hasil.menang ? `+${formatCurrency(r.payout)}` : ''} saldo ${formatCurrency(r.saldoAkhir)}`)
}

function handleDeposit (sender, amount) {
  const newBal = db.addBalance(sender, amount, 'deposit', 'via /pay in-game')
  log(`✅ DEPOSIT ${sender} +${formatCurrency(amount)} -> saldo baru ${formatCurrency(newBal)}`)
  // Konfirmasi deposit HARUS tetap dari akun IsanKaramazv (pemegang saldo).
  enqueue(`@${sender} berhasil deposit ${formatCurrency(amount)}! saldo kamu sekarang ${formatCurrency(newBal)}`, DEPOSIT_BOT.username)
}

function handleWithdraw (sender, amountStr) {
  const amount = parseCurrency(amountStr)
  if (amount <= 0) {
    enqueue(`@${sender} format salah. Contoh: !withdraw 1m`)
    return
  }
  const balanceBefore = db.getBalance(sender)
  if (balanceBefore < amount) {
    enqueue(`@${sender} saldo kamu nggak cukup! saldo kamu ${formatCurrency(balanceBefore)}`)
    return
  }
  const newBal = db.subBalance(sender, amount, 'withdraw', 'via chat command')
  if (newBal === false) {
    enqueue(`@${sender} saldo kamu nggak cukup! saldo kamu ${formatCurrency(balanceBefore)}`)
    return
  }
  // /pay dan konfirmasi withdraw HARUS tetap dari akun IsanKaramazv (pemegang saldo).
  enqueue(`/pay ${sender} ${amount}`, DEPOSIT_BOT.username)
  enqueue(`@${sender} berhasil withdraw ${formatCurrency(amount)}! saldo kamu sekarang ${formatCurrency(newBal)}`, DEPOSIT_BOT.username)
  log(`💸 WITHDRAW ${sender} -${formatCurrency(amount)} -> saldo baru ${formatCurrency(newBal)}`)
}

function handleCasino (sender, betStr) {
  const bet = parseCurrency(betStr)
  if (bet <= 0) {
    enqueue(`@${sender} format salah. Contoh: !casino 1m`)
    return
  }
  const balanceBefore = db.getBalance(sender)
  if (balanceBefore < bet) {
    enqueue(`@${sender} saldo kamu nggak cukup buat taruhan segitu! saldo kamu ${formatCurrency(balanceBefore)}`)
    return
  }

  const afterBet = db.subBalance(sender, bet, 'casino_bet', 'taruhan casino')
  if (afterBet === false) {
    enqueue(`@${sender} saldo kamu nggak cukup buat taruhan segitu! saldo kamu ${formatCurrency(balanceBefore)}`)
    return
  }

  const menang = Math.random() < WIN_CHANCE
  if (menang) {
    const hadiah = bet * 2
    const newBal = db.addBalance(sender, hadiah, 'casino_win', 'menang casino')
    log(`🎰 CASINO ${sender} MENANG taruhan ${formatCurrency(bet)} -> saldo ${formatCurrency(newBal)}`)
    enqueue(`@${sender} menang hoki dek! saldo kamu jadi ${formatCurrency(newBal)}`)
  } else {
    log(`🎰 CASINO ${sender} KALAH taruhan ${formatCurrency(bet)} -> saldo ${formatCurrency(afterBet)}`)
    enqueue(`@${sender} yah lawak, kalah! saldo kamu jadi ${formatCurrency(afterBet)}`)
  }
}

// ---- Coinflip: !coinflip @lawan 1m head|tail  ->  lawan ketik !acc ----
function normalizePick (p) {
  p = String(p || '').toLowerCase()
  if (p === 'head' || p === 'heads') return 'head'
  if (p === 'tail' || p === 'tails') return 'tail'
  return null
}

function handleCoinflipChallenge (sender, argsStr) {
  const parts = argsStr.trim().split(/\s+/).filter(Boolean)
  if (parts.length < 3) {
    enqueue(`@${sender} format salah! Contoh: !coinflip @nama 1m head`)
    return
  }
  const target = parts[0].replace(/^@/, '')
  const amount = parseCurrency(parts[1])
  const pick = normalizePick(parts[2])

  if (!pick) {
    enqueue(`@${sender} pilih head atau tail ya! Contoh: !coinflip @nama 1m head`)
    return
  }
  if (amount <= 0) {
    enqueue(`@${sender} jumlah taruhan salah.`)
    return
  }
  if (target.toLowerCase() === sender.toLowerCase()) {
    enqueue(`@${sender} nggak bisa coinflip lawan diri sendiri wkwk`)
    return
  }
  if (isKnownBotUsername(target)) {
    enqueue(`@${sender} nggak bisa coinflip lawan bot wkwk`)
    return
  }
  const bal = db.getBalance(sender)
  if (bal < amount) {
    enqueue(`@${sender} saldo kamu nggak cukup buat taruhan ${formatCurrency(amount)}! saldo kamu ${formatCurrency(bal)}`)
    return
  }

  const key = target.toLowerCase()
  const existing = duels.get(key)
  if (existing) clearTimeout(existing.timeoutHandle)

  const timeoutHandle = setTimeout(() => {
    const d = duels.get(key)
    if (d && d.challenger.toLowerCase() === sender.toLowerCase()) {
      duels.delete(key)
      enqueue(`@${sender} tantangan coinflip ke @${target} nggak diterima dalam waktu, dibatalin.`)
    }
  }, DUEL_TIMEOUT_MS)

  duels.set(key, { challenger: sender, target, amount, pick, timeoutHandle })
  log(`🎲 COINFLIP challenge: ${sender} -> ${target} taruhan ${formatCurrency(amount)} pilih ${pick}`)
  enqueue(`@${target} woi lu ditantang coinflip ama @${sender} taruhan ${formatCurrency(amount)}! ketik !acc buat nerima (60 detik)`)
}

function handleCoinflipAccept (sender) {
  const key = sender.toLowerCase()
  const duel = duels.get(key)
  if (!duel) {
    enqueue(`@${sender} nggak ada tantangan coinflip buat kamu.`)
    return
  }
  clearTimeout(duel.timeoutHandle)
  duels.delete(key)

  const { challenger, amount, pick } = duel
  const challengerBal = db.getBalance(challenger)
  const targetBal = db.getBalance(sender)

  if (challengerBal < amount) {
    enqueue(`@${sender} yah, saldo @${challenger} udah nggak cukup, coinflip batal.`)
    return
  }
  if (targetBal < amount) {
    enqueue(`@${sender} saldo kamu nggak cukup buat terima taruhan ${formatCurrency(amount)}!`)
    return
  }

  const subChallenger = db.subBalance(challenger, amount, 'coinflip_bet', `vs ${sender}`)
  const subTarget = db.subBalance(sender, amount, 'coinflip_bet', `vs ${challenger}`)
  if (subChallenger === false || subTarget === false) {
    if (subChallenger !== false) db.addBalance(challenger, amount, 'refund', 'rollback coinflip')
    if (subTarget !== false) db.addBalance(sender, amount, 'refund', 'rollback coinflip')
    enqueue(`@${sender} coinflip gagal, saldo berubah pas mau mulai. coba lagi ya.`)
    return
  }

  const result = Math.random() < 0.5 ? 'head' : 'tail'
  const winnerIsChallenger = result === pick
  const winnerName = winnerIsChallenger ? challenger : sender
  const loserName = winnerIsChallenger ? sender : challenger

  const pot = amount * 2
  const tax = Math.round(pot * COINFLIP_TAX)
  const payout = pot - tax

  const newWinnerBal = db.addBalance(winnerName, payout, 'coinflip_win', `vs ${loserName}`)
  const loserBal = db.getBalance(loserName)

  log(`🎲 COINFLIP hasil: ${result.toUpperCase()} | menang: ${winnerName} (+${formatCurrency(payout)}) saldo ${formatCurrency(newWinnerBal)} | kalah: ${loserName} saldo ${formatCurrency(loserBal)}`)
  enqueue(`🪙 Coinflip ${challenger} vs ${sender}: hasilnya ${result.toUpperCase()}!`)
  enqueue(`@${winnerName} lu menang coinflip! pajak buat isan 5% ya dek, jadi lu dapet ${formatCurrency(payout)}`)
  enqueue(`@${loserName} yah lu kalah coinflip, saldo kamu jadi ${formatCurrency(loserBal)}`)
}

// ==================== KONEKSI PER-BOT ====================
// ==================== PERGERAKAN MINIMAL (player_auth_input) ====================
// Server menolak chat dari pemain yang belum bergerak ("you have to move a
// little more before you can chat"), jadi tiap bot:
//   1) kirim `player_auth_input` tiap tick (wajib di Bedrock modern), dan
//   2) jalan maju 3 detik saat spawn supaya ambang anti-spam itu terlewati.
// Setelah itu bot diam & cuma bales chat seperti biasa.


function mulaiGerakLoop (bot) {
  if (bot.moveTimer) return
  const loop = () => {
    try { kirimAuthInput(bot) } catch (err) {
      log(`❌ [${bot.username}] kirim player_auth_input:`, err.message)
    }
    // Jitter kecil: klien asli tidak pernah presisi 50.000ms.
    const jitter = Math.floor(Math.random() * (TICK_JITTER_MS * 2 + 1)) - TICK_JITTER_MS
    bot.moveTimer = setTimeout(loop, TICK_MS + jitter)
  }
  bot.moveTimer = setTimeout(loop, TICK_MS)
}

function hentikanGerakLoop (bot) {
  if (bot.moveTimer) { clearTimeout(bot.moveTimer); bot.moveTimer = null }
}


function kirimAuthInput (bot) {
  if (bot.status !== 'spawned' || !bot.client) return

  // Muter: `yaw` diputar pelan tiap tick, dan bot SELALU "maju"
  // (move_vector lokal {x:0, z:1}). PENTING: `move_vector` itu vektor LOKAL
  // relatif arah hadap, BUKAN vektor dunia — kalau diisi vektor dunia, server
  // menghitung arah ngawur dan menolak gerakan (sudah diuji: gerakan ditolak
  // total). Dengan yaw berputar + maju lokal, bot berjalan melingkar kecil.
  bot.putaran = (bot.putaran || 0) + BELOK_PER_TICK
  const rad = bot.putaran
  bot.yaw = ((rad * 180) / Math.PI) % 360

  const mx = 0 // lokal: tidak geser samping
  const mz = 1 // lokal: maju
  // Perpindahan dunia mengikuti arah hadap (yaw): 0 rad = +Z.
  bot.pos.x += Math.sin(rad) * MOVE_SPEED
  bot.pos.z += Math.cos(rad) * MOVE_SPEED

  const delta = {
    x: bot.pos.x - bot.lastSentPos.x,
    y: bot.pos.y - bot.lastSentPos.y,
    z: bot.pos.z - bot.lastSentPos.z
  }
  bot.lastSentPos = { ...bot.pos }
  bot.authTick += 1n

  // input_data untuk versi server ini (1.26.45) bertipe ARRAY of InputData
  // (mapper zigzag32), BUKAN object bitflags. Kalau dikirim sebagai object,
  // protodef menuliskannya sebagai array KOSONG tanpa error -> server tidak
  // pernah tahu kita jalan. Jadi kirim array nama flag.
  const packet = {
    pitch: bot.pitch,
    yaw: bot.yaw,
    position: { ...bot.pos },
    move_vector: { x: mx, z: mz },
    head_yaw: bot.yaw,
    input_data: ['up'],
    input_mode: 'mouse',
    play_mode: 'normal',
    interaction_model: 'crosshair',
    interact_rotation: { x: bot.pitch, z: bot.yaw },
    tick: bot.authTick,
    delta,
    analogue_move_vector: { x: mx, z: mz },
    camera_orientation: { x: 0, y: 0, z: 0 },
    raw_move_vector: { x: mx, z: mz }
  }

  try {
    bot.client.queue('player_auth_input', packet)
    // Diagnosa sementara (aktifkan dengan CASINO_GERAK_DEBUG=1): lihat posisi
    // yang kita kirim & apakah server mengoreksinya.
    if (GERAK_DEBUG && Date.now() - (bot.lastGerakLog || 0) > 2000) {
      bot.lastGerakLog = Date.now()
      gerakLog(bot, `KIRIM pos=(${bot.pos.x.toFixed(2)},${bot.pos.z.toFixed(2)}) yaw=${bot.yaw.toFixed(0)} tick=${bot.authTick} runtimeId=${bot.runtimeId}`)
    }
  } catch (err) {
    const now = Date.now()
    if (!bot.lastTickErrorAt || now - bot.lastTickErrorAt > 5000) {
      bot.lastTickErrorAt = now
      log(`❌ [${bot.username}] player_auth_input gagal:`, err.message)
    }
  }
}

function clearBotTimers (bot) {
  if (bot.watchdog) { clearTimeout(bot.watchdog); bot.watchdog = null }
  if (bot.reconnectTimer) { clearTimeout(bot.reconnectTimer); bot.reconnectTimer = null }
  hentikanGerakLoop(bot)
}

// Tutup client dengan aman: pasang penampung 'error' kosong dulu supaya error
// susulan (dari paket di tick yang sama) tidak jadi unhandled error.
function safeCloseClient (bot) {
  const c = bot.client
  bot.client = null
  hentikanGerakLoop(bot)
  if (!c) return
  try {
    c.removeAllListeners()
    c.on('error', () => {})
  } catch (_) {}
  try { c.close() } catch (_) {}
}

async function connectBot (bot) {
  if (isShuttingDown) return
  // Jangan dobel: kalau masih ada percobaan connect berjalan atau sudah online.
  if (bot.connecting || bot.status === 'spawned' || bot.status === 'joined') return
  bot.connecting = true
  clearBotTimers(bot)

  // Tunggu giliran login (gate global) — ini yang mencegah "logging in too fast".
  const boleh = await acquireLoginSlot(bot)
  if (!boleh || isShuttingDown) { bot.connecting = false; return }

  log(`🚀 [${bot.username}] Menghubungkan ke ${SERVER_HOST}:${SERVER_PORT} (percobaan ke-${bot.reconnectAttempts + 1})...`)
  bot.status = 'connecting'
  bot.lastConnectAt = Date.now()

  const opts = {
    host: SERVER_HOST,
    port: SERVER_PORT,
    username: bot.username,
    offline: OFFLINE_MODE,
    skipPing: SKIP_PING,
    connectTimeout: CONNECT_TIMEOUT_MS,
    profilesFolder: path.join(__dirname, 'auth', bot.username),
    onMsaCode: (data) => {
      bot.status = 'awaiting_auth'
      log(`🔐 [${bot.username}] LOGIN MICROSOFT DIPERLUKAN (kalau cache auth udah kepasang bener, ini seharusnya nggak muncul)`)
      log(`   Buka: ${data.verification_uri || 'https://microsoft.com/link'}`)
      log(`   Masukkan kode: ${data.user_code}`)
    }
  }
  if (FORCED_VERSION) opts.version = FORCED_VERSION

  let client
  try {
    client = bedrock.createClient(opts)
  } catch (err) {
    log(`❌ [${bot.username}] Gagal bikin client:`, err.message)
    bot.connecting = false
    scheduleReconnect(bot)
    return
  }
  bot.client = client

  // Satu percobaan connect hanya boleh memicu SATU penjadwalan ulang. Kalau
  // 'error' dan 'close' dua-duanya nembak (umum di bedrock-protocol), kita
  // tidak mau dobel reconnect.
  let sudahDijadwalkan = false
  const tandaiGagal = (alasan) => {
    if (sudahDijadwalkan) return
    sudahDijadwalkan = true
    bot.connecting = false
    clearBotTimers(bot)
    // PENTING: setelah removeAllListeners(), kalau masih ada 'error' susulan
    // dari paket di tick yang sama, Node bakal anggap unhandled error dan
    // MEMATIKAN seluruh proses (3 bot lain ikut mati). Jadi pasang dulu
    // listener error kosong sebagai penampung sebelum melepas yang lain.
    try {
      client.removeAllListeners()
      client.on('error', () => {})
    } catch (_) {}
    try { if (client) client.close() } catch (_) {}
    bot.client = null
    bot.status = 'disconnected'
    scheduleReconnect(bot, alasan)
  }

  // WATCHDOG: kalau dalam WATCHDOG_MS belum spawn (dan belum joined), paksa
  // ulang. Ini penambal bug library: jalur "Connect timed out" TIDAK emit
  // 'close', jadi tanpa watchdog bot nyangkut di 'connecting' selamanya
  // (inilah yang dulu bikin BOT2 nggak pernah masuk).
  bot.watchdog = setTimeout(() => {
    if (bot.status !== 'spawned') {
      log(`⏱️ [${bot.username}] Belum spawn setelah ${WATCHDOG_MS / 1000}s (status: ${bot.status}) — paksa ulang.`)
      tandaiGagal('watchdog: belum spawn')
    }
  }, WATCHDOG_MS)

  client.on('session', () => {
    bot.status = 'authenticated'
    log(`✅ [${bot.username}] Login Microsoft berhasil (dari cache/device code).`)
  })

  client.on('join', () => {
    bot.status = 'joined'
    log(`✅ [${bot.username}] Berhasil join server, menunggu spawn...`)
  })

  // Ambil posisi awal & tick dunia dari start_game. Tick WAJIB nyambung dengan
  // tick server (bukan mulai dari 0), kalau tidak server mengabaikan input
  // pergerakan kita.
  client.on('start_game', (packet) => {
    try {
      // ID runtime KITA — dipakai buat menyaring packet move_player milik
      // pemain/mob lain (kalau tidak, posisi orang lain dipakai sebagai posisi
      // kita, bot jadi "melompat-lompat").
      if (packet.runtime_entity_id != null) bot.runtimeId = BigInt(packet.runtime_entity_id)
      if (packet.player_position) {
        bot.pos = { ...packet.player_position }
        bot.lastSentPos = { ...bot.pos }
      }
      if (packet.rotation) {
        bot.pitch = packet.rotation.x || 0
        bot.yaw = packet.rotation.y || 0
      }
      // PENTING: server JavRock mengirim `current_tick = -1` (belum diset / bukan
      // tick dunia asli). Kalau kita pakai -1 sebagai basis, tick kita jadi
      // negatif dan server menganggapnya tidak valid -> gerakan diabaikan.
      // Jadi HANYA pakai kalau nilainya > 0 (positif); kalau tidak, biarkan
      // counter mulai dari 0 dan naik 1 tiap tick (server tetap memproses
      // karena tick hanya perlu konsisten naik, lihat catatan di kirimAuthInput).
      if (packet.current_tick != null) {
        try {
          const t = BigInt(packet.current_tick)
          if (t > 0n) bot.authTick = t
        } catch (_) {}
      }
      gerakLog(bot, `START_GAME runtimeId=${bot.runtimeId} current_tick=${packet.current_tick} authTick=${bot.authTick} pos=(${bot.pos.x.toFixed(2)},${bot.pos.z.toFixed(2)})`)
    } catch (e) { gerakLog(bot, 'START_GAME error: ' + e.message) }
  })

  // Posisi otoritatif dari server. WAJIB DITIMPA ke bot.pos setiap kali datang.
  //
  // INI BUG UTAMA yang bikin gerakan (dan akhirnya chat) ditolak:
  // `player_position` di start_game server ini KOSONG -> (0, 69, 0), padahal
  // posisi asli bot di server mis. (157, -32, 164). Kalau kita jalan dari
  // (0,69,0), server menganggap posisi kita tidak masuk akal dan MENGABAIKAN
  // semua input pergerakan -> bot "diam" -> GriefPrevention menolak chat
  // ("you have to move a little more"). Sama persis dengan pola bot lama
  // (isanc): this.position = packet.position.
  const terapkanPosisiServer = (position, onGround) => {
    if (position) {
      const lompat = Math.hypot(position.x - bot.pos.x, position.z - bot.pos.z)
      bot.pos = { x: position.x, y: position.y, z: position.z }
      bot.lastSentPos = { ...bot.pos }
      if (lompat > 8) {
        gerakLog(bot, `PINDAH LOKASI server=(${position.x.toFixed(1)},${position.y.toFixed(1)},${position.z.toFixed(1)}) tick=${bot.authTick}`)
      } else if (Date.now() - (bot.lastKoreksiLog || 0) > 2000) {
        bot.lastKoreksiLog = Date.now()
        gerakLog(bot, `POSISI server=(${position.x.toFixed(2)},${position.z.toFixed(2)}) on_ground=${onGround}`)
      }
    }
    if (typeof onGround === 'boolean') bot.onGround = onGround
  }

  client.on('move_player', (packet) => {
    try {
      // packet_move_player dikirim untuk SEMUA entity yang bergerak. Hanya pakai
      // yang runtime_id-nya milik kita. runtime_id bertipe varint (Number),
      // runtimeId kita BigInt — `Number === BigInt` selalu false, jadi samakan
      // dulu tipenya.
      if (bot.runtimeId != null && BigInt(packet.runtime_id) !== bot.runtimeId) return
      terapkanPosisiServer(packet.position, packet.on_ground)
      if (typeof packet.pitch === 'number') bot.pitch = packet.pitch
      if (typeof packet.yaw === 'number') bot.yaw = packet.yaw
    } catch (_) {}
  })

  client.on('correct_player_move_prediction', (packet) => {
    try {
      terapkanPosisiServer(packet.position, packet.on_ground)
    } catch (_) {}
  })

  client.on('spawn', () => {
    bot.status = 'spawned'
    bot.connecting = false
    bot.reconnectAttempts = 0
    bot.everSpawned = true
    bot.rateLimited = false
    bot.errorTimestamps = []
    clearBotTimers(bot)
    bot.putaran = 0
    // Chat ditahan sampai bot benar-benar sudah bergerak di server tujuan
    // (lihat urutan di bawah).
    bot.bolehChat = false
    log(`✅ [${bot.username}] Sudah spawn di dunia.`)
    const stagger = bot.index * 800
    setTimeout(() => {
      if (bot.status !== 'spawned') return
      // 1) Pindah ke sub-server (survival) DULU. Command "/server ..." tidak
      //    kena filter anti-spam chat, jadi aman dikirim duluan.
      chatSendFrom(bot, SUBSERVER_COMMAND)
      bot.lastChatAt = Date.now()

      // 2) BARU mulai gerak — setelah pindah sub-server. Ini penting: plugin
      //    anti-spam (GriefPrevention "NoChatUntilMove") mencatat titik login
      //    di SERVER TUJUAN, jadi bot harus bergerak SETELAH sampai di sana,
      //    bukan saat masih di hub. Kalau gerak di hub, begitu pindah server
      //    hitungannya di-reset dan chat tetap ditolak.
      setTimeout(() => {
        if (bot.status !== 'spawned') return
        mulaiGerakLoop(bot)
        bot.bolehChat = true
        log(`🚶 [${bot.username}] Mulai bergerak (setelah ${SUBSERVER_COMMAND}).`)

        // 3) Bot deposit memperkenalkan diri SEKALI per proses (sekalian bikin
        //    server menggemakan chat-nya -> nama in-game terdeteksi otomatis).
        if (bot.role === 'deposit' && !bot.sudahPerkenalan) {
          bot.sudahPerkenalan = true
          chatSendFrom(bot, `ISAN Casino bot siap! ketik !help buat lihat command, atau /pay ${bot.gamertag} (jumlah) buat deposit.`)
          bot.lastChatAt = Date.now()
        }
      }, 4000)
    }, stagger)
  })

  // SEMUA bot jadi "telinga" chat. Ini penting: dulu cuma bot deposit (BOT1)
  // yang dengerin, jadi begitu BOT1 kena "already logged in" / offline,
  // SELURUH command (!help dll) ikut mati. Sekarang siapa pun yang online
  // bisa nangkap command; tiap pesan publik cuma diproses SEKALI
  // (lihat sudahDiproses() di handleIncomingChat).
  client.on('text', (packet) => {
    try {
      if (isKnownBotUsername(packet.source_name)) return
      handleIncomingChat(packet)
    } catch (err) {
      log(`❌ [${bot.username}] Error handle chat:`, err.message)
    }
  })

  client.on('disconnect', (packet) => {
    const msg = packet && packet.message ? stripColor(packet.message) : ''
    if (msg) log(`⚠️ [${bot.username}] Disconnect:`, msg)
    // Deteksi rate-limit: server minta kita melambat.
    if (/too fast|try again later|logging in/i.test(msg)) {
      bot.rateLimited = true
      log(`🐢 [${bot.username}] Server membatasi login (rate-limit). Perlambat.`)
    }
  })

  client.on('close', () => {
    // Jangan biarkan event ini menimpa status 'spawned' kalau penutupan ini
    // bagian dari penggantian (mis. kita sendiri yang menutup).
    if (bot.status === 'spawned' && !isShuttingDown) {
      log(`🔌 [${bot.username}] Koneksi tertutup.`)
    }
    tandaiGagal('koneksi tertutup')
  })

  client.on('error', (err) => {
    const m = err && err.message ? err.message : String(err)

    // PENTING (fix "BOT1 loop reconnect pas masuk overworld"):
    // Paket NBT dari Geyser (block_entity_data / chest / sign, id 0x38 dst)
    // TIDAK bisa di-parse library di server ini -> muncul
    //   "Read error for undefined : Invalid tag: 119 > 20"
    // Tapi framing paket tetap UTUH (library sudah selesai baca 1 paket),
    // jadi koneksi TIDAK rusak. Dulu error ini ikut dihitung sebagai "error
    // beruntun" -> circuit breaker memaksa reconnect -> begitu masuk overworld
    // (banyak block entity) langsung error lagi -> loop tak berujung.
    // Sekarang: cukup dicatat, TIDAK memicu reconnect.
    if (/Invalid tag|Read error for|Read failure/i.test(m)) {
      bot.nbtErrorCount = (bot.nbtErrorCount || 0) + 1
      if (bot.nbtErrorCount <= 2 || bot.nbtErrorCount % 200 === 0) {
        log(`⚠️ [${bot.username}] Paket NBT tidak dikenal diabaikan (normal di Geyser) x${bot.nbtErrorCount}`)
      }
      return
    }

    log(`❌ [${bot.username}] Client error:`, m)
    // "Connect timed out" = library TIDAK emit 'close' → wajib kita tangani.
    if (/timed out|ECONN|ETIMEDOUT|socket|refused/i.test(m)) {
      tandaiGagal('connect gagal: ' + m)
      return
    }
    const now = Date.now()
    bot.errorTimestamps.push(now)
    bot.errorTimestamps = bot.errorTimestamps.filter((t) => now - t < ERROR_BURST_WINDOW_MS)
    if (bot.errorTimestamps.length >= ERROR_BURST_LIMIT) {
      log(`🧨 [${bot.username}] Error beruntun terdeteksi (kemungkinan desync abis pindah server), paksa reconnect...`)
      bot.errorTimestamps = []
      tandaiGagal('error beruntun')
    }
  })
}

function scheduleReconnect (bot, alasan = '') {
  if (isShuttingDown) return
  if (bot.reconnectTimer) return // sudah ada jadwal, jangan dobel
  bot.reconnectAttempts++
  // Backoff eksponensial + jitter biar bot nggak reconnect serempak.
  const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, bot.reconnectAttempts - 1))
  const jitter = Math.floor(Math.random() * RECONNECT_JITTER_MS)
  let wait = exp + jitter
  // Kalau terakhir ditolak karena "too fast", kasih lantai tunggu lebih lama.
  if (bot.rateLimited) wait = Math.max(wait, RATE_LIMIT_FLOOR_MS + jitter)
  const suffix = alasan ? ` (${alasan})` : ''
  log(`🔁 [${bot.username}] Reconnect ke-${bot.reconnectAttempts} dalam ${(wait / 1000).toFixed(1)} detik...${suffix}`)
  bot.reconnectTimer = setTimeout(() => {
    bot.reconnectTimer = null
    connectBot(bot)
  }, wait)
}

// ==================== KONTROL LEWAT TERMINAL ====================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function printTerminalHelp () {
  console.log(`
Perintah terminal:
  <pesan/command>               kirim ke chat in-game lewat rotasi 3 bot
  #send <botUsername> <pesan>   kirim lewat 1 bot tertentu aja
                                 contoh: #send BOT1 /pay isann67 1000
  #saldo <user>                  lihat saldo player di database
  #add <user> <jumlah>           tambah saldo manual, contoh: #add isann67 1m
  #set <user> <jumlah>           set saldo manual, contoh: #set isann67 500k
  #list                          daftar semua user di database
  #top                           leaderboard 10 saldo terbesar
  #stat                          statistik global (saldo, jackpot, total taruhan)
  #reset <user>                  reset saldo & history user ke 0
  #ban / #unban <user>           blokir / buka blokir user dari command
  #banlist                       daftar user yang diblokir
  #admin [add|del] <user>        lihat / tambah / hapus admin (boleh command via chat)
  #jackpot [jumlah]              lihat / tambah pool jackpot
  #export                        backup database ke file
  #broadcast <pesan>             kirim pengumuman ke chat in-game
  #status                        status koneksi semua bot
  #reconnect [bot|all]           paksa connect ulang 1 bot / semua bot
  #help                          tampilkan pesan ini
  #quit                          keluar
`)
}

function printStatus () {
  console.log(`Server: ${SERVER_HOST}:${SERVER_PORT}`)
  const now = Date.now()
  bots.forEach((b) => {
    const tag = b.gamertag && b.gamertag !== b.username ? ` (in-game: ${b.gamertag})` : ''
    const sejak = b.lastConnectAt ? ` · ${Math.round((now - b.lastConnectAt) / 1000)}s lalu` : ''
    console.log(`  [${b.role === 'deposit' ? 'DEPOSIT' : 'helper'}] ${b.username}${tag}: ${b.status}${sejak}`)
  })
}

function askTerminal () {
  rl.question('> ', (inputRaw) => {
    const input = inputRaw.trim()
    if (!input) return askTerminal()

    if (input.startsWith('#')) {
      const afterHash = input.slice(1).trim()
      const parts = afterHash.split(/\s+/)
      const cmd = (parts[0] || '').toLowerCase()

      if (cmd === 'quit' || cmd === 'exit') {
        shutdown()
        rl.close()
        process.exit(0)
        return
      } else if (cmd === 'send' && parts[1] && parts.length > 2) {
        const botUsername = parts[1]
        const msg = afterHash.slice(afterHash.indexOf(parts[1]) + parts[1].length).trim()
        if (!isKnownBotUsername(botUsername)) {
          console.log(`Bot "${botUsername}" nggak dikenal. Pilihan: ${bots.map((b) => b.username).join(', ')}`)
        } else {
          enqueue(msg, botUsername)
        }
      } else if (cmd === 'saldo' && parts[1]) {
        console.log(`Saldo ${parts[1]}: ${formatCurrency(db.getBalance(parts[1]))}`)
      } else if (cmd === 'add' && parts[1] && parts[2]) {
        const newBal = db.addBalance(parts[1], parseCurrency(parts[2]), 'admin_add', 'manual via terminal')
        console.log(`Saldo ${parts[1]} sekarang: ${formatCurrency(newBal)}`)
      } else if (cmd === 'set' && parts[1] && parts[2]) {
        const newBal = db.setBalance(parts[1], parseCurrency(parts[2]))
        console.log(`Saldo ${parts[1]} diset ke: ${formatCurrency(newBal)}`)
      } else if (cmd === 'list') {
        const users = db.listUsers()
        if (!users.length) console.log('Belum ada user di database.')
        users.forEach((u) => console.log(`  ${u.username}: ${formatCurrency(u.balance)}`))
      } else if (cmd === 'top') {
        const top = db.getTop(10)
        if (!top.length) console.log('Belum ada yang punya saldo.')
        top.forEach((u, i) => console.log(`  ${i + 1}. ${u.username}: ${formatCurrency(u.balance)}`))
      } else if (cmd === 'stat') {
        const m = db.getMeta()
        const users = db.listUsers()
        const totalSaldo = users.reduce((a, u) => a + (u.balance || 0), 0)
        console.log('📊 STATISTIK GLOBAL')
        console.log(`   User terdaftar : ${users.length}`)
        console.log(`   Total saldo    : ${formatCurrency(totalSaldo)}`)
        console.log(`   Jackpot        : ${formatCurrency(m.jackpot)}`)
        console.log(`   Total taruhan  : ${formatCurrency(m.totalBet)}`)
        console.log(`   Total payout   : ${formatCurrency(m.totalPayout)}`)
        const gameUsers = users.map((u) => ({ n: u.username, g: (u.stats && u.stats.games) || 0 })).filter((x) => x.g > 0).sort((a, b) => b.g - a.g)
        if (gameUsers.length) console.log(`   Paling aktif   : ${gameUsers.slice(0, 3).map((x) => `${x.n} (${x.g}x)`).join(', ')}`)
      } else if (cmd === 'reset' && parts[1]) {
        db.resetUser(parts[1])
        console.log(`♻️  Saldo & history ${parts[1]} direset ke 0.`)
      } else if (cmd === 'ban' && parts[1]) {
        db.banUser(parts[1])
        console.log(`🚫 ${parts[1]} diblokir dari command.`)
      } else if (cmd === 'unban' && parts[1]) {
        db.unbanUser(parts[1])
        console.log(`✅ ${parts[1]} dibuka blokirnya.`)
      } else if (cmd === 'banlist') {
        const b = db.listBanned()
        console.log(b.length ? `🚫 Diblokir: ${b.join(', ')}` : 'Tidak ada user diblokir.')
      } else if (cmd === 'admin') {
        const sub = (parts[1] || '').toLowerCase()
        if (sub === 'add' && parts[2]) {
          db.addAdmin(parts[2])
          console.log(`🛡️  Admin sekarang: ${db.listAdmins().join(', ')}`)
        } else if (sub === 'del' && parts[2]) {
          db.removeAdmin(parts[2])
          console.log(`🛡️  Admin sekarang: ${db.listAdmins().join(', ') || '(kosong)'}`)
        } else {
          console.log(`🛡️  Admin terdaftar: ${db.listAdmins().join(', ') || '(kosong)'}`)
          console.log('   Pakai: #admin add <user> | #admin del <user>')
        }
      } else if (cmd === 'jackpot') {
        if (parts[1]) {
          const n = db.addJackpot(parseCurrency(parts[1]))
          console.log(`💰 Jackpot ditambah -> ${formatCurrency(n)}`)
        } else {
          console.log(`💰 Jackpot saat ini: ${formatCurrency(db.getMeta().jackpot)}`)
        }
      } else if (cmd === 'export') {
        const f = db.backupDB(__dirname, CFG.sistem.backupSimpan || 24)
        console.log(f ? `💾 Backup dibuat: ${f}` : '❌ Backup gagal.')
      } else if (cmd === 'broadcast' && parts.length > 1) {
        const msg = afterHash.slice(afterHash.indexOf(parts[1]))
        enqueue(msg)
        console.log(`📢 Broadcast dikirim: ${msg}`)
      } else if (cmd === 'status') {
        printStatus()
      } else if (cmd === 'reconnect') {
        const target = parts[1]
        if (target && target.toLowerCase() !== 'all') {
          const bot = bots.find((b) => b.username.toLowerCase() === target.toLowerCase())
          if (!bot) {
            console.log(`Bot "${target}" nggak dikenal. Pilihan: ${bots.map((b) => b.username).join(', ')}`)
          } else {
            clearBotTimers(bot)
            bot.connecting = false
            bot.reconnectAttempts = 0
            bot.rateLimited = false
            safeCloseClient(bot)
            bot.status = 'disconnected'
            console.log(`🔁 Paksa reconnect ${bot.username}...`)
            connectBot(bot)
          }
        } else {
          console.log('🔁 Paksa reconnect semua bot (bertahap)...')
          bots.forEach((bot, i) => {
            clearBotTimers(bot)
            bot.connecting = false
            bot.reconnectAttempts = 0
            bot.rateLimited = false
            safeCloseClient(bot)
            bot.status = 'disconnected'
            setTimeout(() => connectBot(bot), i * INITIAL_STAGGER_MS)
          })
        }
      } else {
        printTerminalHelp()
      }
    } else {
      // Kirim ke chat in-game lewat rotasi 3 bot
      const anyReady = bots.some((b) => b.status === 'spawned')
      if (!anyReady) console.log('⚠️ Belum ada bot yang spawn, pesan diantrikan dulu.')
      enqueue(input)
    }
    askTerminal()
  })
}

// ==================== MAIN ====================
console.log('🎰 ISAN CASINO BOT (3 akun)')
console.log(`Server: ${SERVER_HOST}:${SERVER_PORT}`)
console.log(`Bot: ${bots.map((b) => `${b.username}${b.role === 'deposit' ? ' (deposit)' : ''}`).join(', ')}`)
console.log('='.repeat(50))
printTerminalHelp()

// Start pertama: JANGAN connect serempak. Beri jarak INITIAL_STAGGER_MS antar
// bot supaya server nggak bilang "You are logging in too fast".
bots.forEach((bot, i) => {
  setTimeout(() => connectBot(bot), i * INITIAL_STAGGER_MS)
})

// Backup database otomatis berkala (biar saldo nggak hilang kalau file rusak).
setInterval(() => {
  if (isShuttingDown) return
  const f = db.backupDB(__dirname, CFG.sistem.backupSimpan || 24)
  if (f) log(`💾 Backup database otomatis: ${path.basename(f)}`)
}, CFG.sistem.backupTiapMs || 3600000)

// Pemeriksa kesehatan berkala: kalau ada bot yang lama tidak 'spawned' dan
// tidak punya timer reconnect, paksa connect lagi. Ini jaring pengaman terakhir
// supaya bot TIDAK PERNAH nyangkut diam seperti BOT2 dulu.
setInterval(() => {
  if (isShuttingDown) return
  const now = Date.now()
  bots.forEach((bot) => {
    const nyangkut = bot.status !== 'spawned' && !bot.connecting && !bot.reconnectTimer
    const lamaDiam = (now - bot.lastConnectAt) > (WATCHDOG_MS * 2)
    if (nyangkut && lamaDiam) {
      log(`🩺 [${bot.username}] Terdeteksi diam (status: ${bot.status}) — coba connect lagi.`)
      connectBot(bot)
    }
  })
}, 30000)

askTerminal()

function shutdown () {
  isShuttingDown = true
  bots.forEach((b) => {
    clearBotTimers(b)
    safeCloseClient(b)
  })
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
