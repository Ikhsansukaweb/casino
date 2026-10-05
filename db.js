'use strict'

// ==================== DB.JS ====================
// Database sederhana berbasis file JSON buat nyimpen saldo player casino.
// Semua fungsi di sini SYNC (fs.*Sync) supaya urutan baca-ubah-tulis saldo
// nggak keselip race condition antar command yang masuk hampir bersamaan.
//
// STRUKTUR database.json:
// {
//   users: {
//     <key>: {
//       username, balance, history[],
//       stats: { games, wins, losses, totalBet, totalWon, biggestWin },
//       cooldowns: { daily: <ms>, kerja: <ms>, rampok: <ms>, gacha: <ms> },
//       createdAt
//     }
//   },
//   meta: { jackpot, totalBet, totalPayout, totalDeposit, totalWithdraw },
//   banned: [ "nama1", "nama2" ]
// }

const fs = require('fs')
const path = require('path')

const DB_PATH = path.join(__dirname, 'database.json')
const AUDIT_PATH = path.join(__dirname, 'transaksi.log')
const HISTORY_LIMIT = 200

function defaultMeta () {
  return { jackpot: 0, totalBet: 0, totalPayout: 0, totalDeposit: 0, totalWithdraw: 0 }
}

function defaultUser (username) {
  return {
    username,
    balance: 0,
    history: [],
    stats: { games: 0, wins: 0, losses: 0, totalBet: 0, totalWon: 0, biggestWin: 0 },
    cooldowns: {},
    createdAt: new Date().toISOString()
  }
}

function loadDB () {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8')
    const db = JSON.parse(raw)
    if (!db.users) db.users = {}
    if (!db.meta) db.meta = defaultMeta()
    if (!Array.isArray(db.banned)) db.banned = []
    if (!Array.isArray(db.admins)) db.admins = []
    return db
  } catch (e) {
    return { users: {}, meta: defaultMeta(), banned: [], admins: [] }
  }
}

function saveDB (db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2))
}

// Tulis jejak audit ke file terpisah (buat cek sengketa). Tidak pernah melempar
// error supaya tidak mengganggu alur command.
function audit (entry) {
  try {
    const line = `[${new Date().toISOString()}] ${JSON.stringify(entry)}`
    fs.appendFileSync(AUDIT_PATH, line + '\n')
  } catch (_) {}
}

function keyOf (username) {
  return String(username || '').toLowerCase()
}

// Pastikan user ada + lengkapi field baru (buat DB lama yang belum punya stats).
function ensureUser (username) {
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) {
    db.users[key] = defaultUser(username)
    saveDB(db)
  } else {
    const u = db.users[key]
    if (!u.stats) u.stats = defaultUser(username).stats
    if (!u.cooldowns) u.cooldowns = {}
    if (!Array.isArray(u.history)) u.history = []
    if (!u.username) u.username = username
  }
  return db.users[key]
}

function getBalance (username) {
  return ensureUser(username).balance
}

function pushHistory (db, key, entry) {
  if (!db.users[key].history) db.users[key].history = []
  db.users[key].history.push({ ...entry, at: new Date().toISOString() })
  if (db.users[key].history.length > HISTORY_LIMIT) db.users[key].history.shift()
}

// Nambah saldo (deposit, hasil menang casino, dll). Selalu berhasil.
function addBalance (username, amount, type = 'deposit', note = '') {
  amount = Math.round(Number(amount) || 0)
  if (amount <= 0) return getBalance(username)
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) db.users[key] = defaultUser(username)
  db.users[key].username = username
  db.users[key].balance += amount
  pushHistory(db, key, { type, amount, balanceAfter: db.users[key].balance, note })
  saveDB(db)
  audit({ user: username, type, amount, balanceAfter: db.users[key].balance, note })
  return db.users[key].balance
}

// Kurangi saldo (withdraw, taruhan casino). Return `false` kalau saldo kurang,
// atau saldo baru (number) kalau sukses.
function subBalance (username, amount, type = 'withdraw', note = '') {
  amount = Math.round(Number(amount) || 0)
  if (amount <= 0) return false
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) db.users[key] = defaultUser(username)
  if (db.users[key].balance < amount) return false
  db.users[key].balance -= amount
  pushHistory(db, key, { type, amount: -amount, balanceAfter: db.users[key].balance, note })
  saveDB(db)
  audit({ user: username, type, amount: -amount, balanceAfter: db.users[key].balance, note })
  return db.users[key].balance
}

// Dipakai admin lewat terminal buat set saldo manual.
function setBalance (username, amount) {
  amount = Math.round(Number(amount) || 0)
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) db.users[key] = defaultUser(username)
  db.users[key].username = username
  db.users[key].balance = amount
  pushHistory(db, key, { type: 'admin_set', amount, balanceAfter: amount, note: 'diset lewat terminal' })
  saveDB(db)
  audit({ user: username, type: 'admin_set', amount, balanceAfter: amount, note: 'terminal' })
  return db.users[key].balance
}

function listUsers () {
  const db = loadDB()
  return Object.values(db.users)
}

// ==================== STATISTIK ====================
// Catat hasil 1 permainan. `bet` = taruhan, `payout` = yang diterima kembali
// (0 kalau kalah), `won` = boolean.
function recordBet (username, bet, payout, won, game = '') {
  bet = Math.round(Number(bet) || 0)
  payout = Math.round(Number(payout) || 0)
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) db.users[key] = defaultUser(username)
  const s = db.users[key].stats
  s.games += 1
  s.totalBet += bet
  if (won) {
    s.wins += 1
    s.totalWon += payout
    if (payout - bet > s.biggestWin) s.biggestWin = payout - bet
  } else {
    s.losses += 1
  }
  db.meta.totalBet += bet
  db.meta.totalPayout += payout
  saveDB(db)
  audit({ user: username, type: 'game', game, bet, payout, won })
  return s
}

function getStats (username) {
  const u = ensureUser(username)
  const s = u.stats || {}
  const games = s.games || 0
  const wins = s.wins || 0
  return {
    ...s,
    games,
    wins,
    losses: s.losses || 0,
    totalBet: s.totalBet || 0,
    totalWon: s.totalWon || 0,
    biggestWin: s.biggestWin || 0,
    winrate: games > 0 ? Math.round((wins / games) * 100) : 0
  }
}

// ==================== LEADERBOARD ====================
function getTop (n = 5) {
  const db = loadDB()
  return Object.values(db.users)
    .filter((u) => Number(u.balance) > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, n)
}

// ==================== TRANSFER ====================
// Pindahkan saldo antar pemain (pajak dipotong dari jumlah kirim).
function transferBalance (from, to, amount, taxRate = 0) {
  amount = Math.round(Number(amount) || 0)
  if (amount <= 0) return { ok: false, reason: 'jumlah tidak valid' }
  if (keyOf(from) === keyOf(to)) return { ok: false, reason: 'tidak bisa transfer ke diri sendiri' }
  const db = loadDB()
  const kf = keyOf(from)
  const kt = keyOf(to)
  if (!db.users[kf]) db.users[kf] = defaultUser(from)
  if (!db.users[kt]) db.users[kt] = defaultUser(to)
  if (db.users[kf].balance < amount) return { ok: false, reason: 'saldo kurang' }
  const tax = Math.round(amount * (Number(taxRate) || 0))
  const diterima = amount - tax
  db.users[kf].balance -= amount
  pushHistory(db, kf, { type: 'transfer_keluar', amount: -amount, balanceAfter: db.users[kf].balance, note: `ke ${to}` })
  db.users[kt].username = to
  db.users[kt].balance += diterima
  pushHistory(db, kt, { type: 'transfer_masuk', amount: diterima, balanceAfter: db.users[kt].balance, note: `dari ${from}` })
  saveDB(db)
  audit({ user: from, type: 'transfer_keluar', amount: -amount, to, tax, balanceAfter: db.users[kf].balance })
  audit({ user: to, type: 'transfer_masuk', amount: diterima, from, balanceAfter: db.users[kt].balance })
  return { ok: true, tax, diterima, saldoPengirim: db.users[kf].balance, saldoPenerima: db.users[kt].balance }
}

// ==================== COOLDOWN ====================
// Return sisa waktu (ms) kalau masih cooldown, atau 0 kalau boleh dipakai.
function getCooldown (username, jenis) {
  const u = ensureUser(username)
  const last = (u.cooldowns || {})[jenis] || 0
  return Math.max(0, last)
}

function setCooldown (username, jenis, durasiMs) {
  const db = loadDB()
  const key = keyOf(username)
  if (!db.users[key]) db.users[key] = defaultUser(username)
  if (!db.users[key].cooldowns) db.users[key].cooldowns = {}
  db.users[key].cooldowns[jenis] = Date.now() + durasiMs
  saveDB(db)
  return db.users[key].cooldowns[jenis]
}

// ==================== BAN ====================
function isBanned (username) {
  const db = loadDB()
  return db.banned.includes(keyOf(username))
}

function banUser (username) {
  const db = loadDB()
  const key = keyOf(username)
  if (!db.banned.includes(key)) db.banned.push(key)
  saveDB(db)
  audit({ user: username, type: 'ban' })
  return true
}

function unbanUser (username) {
  const db = loadDB()
  const key = keyOf(username)
  db.banned = db.banned.filter((b) => b !== key)
  saveDB(db)
  audit({ user: username, type: 'unban' })
  return true
}

function listBanned () {
  return loadDB().banned.slice()
}

// ==================== ADMIN ====================
// Admin = gamertag yang boleh pakai command admin LEWAT CHAT (mis. "sannbets").
// Disimpan lowercase di database.json -> field `admins`.
function isAdmin (username) {
  if (!username) return false
  const db = loadDB()
  return db.admins.includes(keyOf(username))
}

function addAdmin (username) {
  const db = loadDB()
  const key = keyOf(username)
  if (!db.admins.includes(key)) db.admins.push(key)
  saveDB(db)
  audit({ user: username, type: 'admin_add' })
  return db.admins.slice()
}

function removeAdmin (username) {
  const db = loadDB()
  const key = keyOf(username)
  db.admins = db.admins.filter((a) => a !== key)
  saveDB(db)
  audit({ user: username, type: 'admin_remove' })
  return db.admins.slice()
}

function listAdmins () {
  return loadDB().admins.slice()
}

// ==================== META / JACKPOT ====================
function getMeta () {
  const db = loadDB()
  return db.meta || defaultMeta()
}

function addJackpot (amount) {
  amount = Math.round(Number(amount) || 0)
  if (amount <= 0) return getMeta().jackpot
  const db = loadDB()
  db.meta.jackpot += amount
  saveDB(db)
  return db.meta.jackpot
}

// Ambil seluruh jackpot (dipakai saat ada pemenang). Return jumlah yang diambil.
function takeJackpot () {
  const db = loadDB()
  const jp = db.meta.jackpot || 0
  db.meta.jackpot = 0
  saveDB(db)
  return jp
}

// Set langsung nilai jackpot (admin).
function setJackpot (amount) {
  amount = Math.round(Number(amount) || 0)
  if (amount < 0) amount = 0
  const db = loadDB()
  db.meta.jackpot = amount
  saveDB(db)
  audit({ type: 'set_jackpot', amount })
  return db.meta.jackpot
}

// ==================== RESET ====================
function resetUser (username) {
  const db = loadDB()
  const key = keyOf(username)
  if (db.users[key]) {
    db.users[key] = defaultUser(db.users[key].username || username)
    saveDB(db)
  }
  audit({ user: username, type: 'reset' })
  return true
}

// ==================== BACKUP ====================
function backupDB (dir, maxSimpan = 24) {
  try {
    if (!fs.existsSync(dir)) return null
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = path.join(dir, `database.bak-${stamp}.json`)
    fs.copyFileSync(DB_PATH, target)
    // Buang backup lama kalau sudah lebih dari maxSimpan.
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('database.bak-')).sort()
    while (files.length > maxSimpan) {
      const lama = files.shift()
      try { fs.unlinkSync(path.join(dir, lama)) } catch (_) {}
    }
    return target
  } catch (_) {
    return null
  }
}

module.exports = {
  // lama (tetap dipertahankan)
  ensureUser,
  getBalance,
  addBalance,
  subBalance,
  setBalance,
  listUsers,
  loadDB,
  saveDB,
  // baru
  recordBet,
  getStats,
  getTop,
  transferBalance,
  getCooldown,
  setCooldown,
  isBanned,
  banUser,
  unbanUser,
  listBanned,
  isAdmin,
  addAdmin,
  removeAdmin,
  listAdmins,
  getMeta,
  addJackpot,
  takeJackpot,
  setJackpot,
  resetUser,
  backupDB,
  audit
}
