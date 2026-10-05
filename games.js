'use strict'

// ==================== GAMES.JS ====================
// Kumpulan mesin permainan casino (murni logika, tanpa I/O).
// Semua fungsi return objek hasil yang sudah siap ditampilkan ke chat.

function rint (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pilih (arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

// ---------------- SLOT ----------------
// 3 reel. 3 simbol sama = x5, 2 sama = x1.5, sisanya kalah.
const REEL = ['🍒', '🍋', '🍇', '🔔', '💎', '7️⃣']
function mainSlot (bet) {
  const r = [pilih(REEL), pilih(REEL), pilih(REEL)]
  let pengali = 0
  if (r[0] === r[1] && r[1] === r[2]) pengali = 5
  else if (r[0] === r[1] || r[1] === r[2] || r[0] === r[2]) pengali = 1.5
  const menang = pengali > 0
  return { reels: r, pengali, menang, hadiah: Math.round(bet * pengali) }
}

// ---------------- DADU ----------------
// Tebak angka 1-6. Benar = x5.
function mainDadu (bet, tebakan, pengali = 5) {
  const hasil = rint(1, 6)
  const menang = Number(tebakan) === hasil
  return { hasil, tebakan: Number(tebakan), menang, hadiah: menang ? bet * pengali : 0, pengali }
}

// ---------------- ROULETTE ----------------
// taruhan: 'merah'|'hitam'|'hijau'|angka 0-36
const MERAH = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]
function mainRoulette (bet, pilihan, cfg = {}) {
  const angka = rint(0, 36)
  const warna = angka === 0 ? 'hijau' : (MERAH.includes(angka) ? 'merah' : 'hitam')
  const p = String(pilihan).toLowerCase()
  let menang = false
  let pengali = 0
  if (p === 'merah' || p === 'hitam') {
    menang = warna === p
    pengali = cfg.pengaliWarna || 2
  } else if (p === 'hijau' || p === '0') {
    menang = warna === 'hijau'
    pengali = cfg.pengaliHijau || 14
  } else if (/^\d+$/.test(p)) {
    menang = Number(p) === angka
    pengali = cfg.pengaliAngka || 36
  } else {
    return { error: 'pilihan salah (merah/hitam/hijau/0-36)' }
  }
  return { angka, warna, menang, pengali, hadiah: menang ? bet * pengali : 0 }
}

// ---------------- TEBAK ANGKA ----------------
function mainTebak (bet, tebakan, pengali = 8, maks = 10) {
  const hasil = rint(1, maks)
  const menang = Number(tebakan) === hasil
  return { hasil, tebakan: Number(tebakan), menang, hadiah: menang ? bet * pengali : 0, pengali }
}

// ---------------- HILO ----------------
// Tebak kartu berikutnya lebih tinggi/rendah. x2.
function mainHilo (bet, pilihan, pengali = 2) {
  const p = String(pilihan).toLowerCase()
  if (p !== 'tinggi' && p !== 'rendah' && p !== 'high' && p !== 'low') {
    return { error: 'pilihan salah (tinggi/rendah)' }
  }
  const kartu1 = rint(1, 13)
  let kartu2 = rint(1, 13)
  // hindari seri: ulang sampai beda
  let guard = 0
  while (kartu2 === kartu1 && guard < 20) { kartu2 = rint(1, 13); guard++ }
  const tinggi = p === 'tinggi' || p === 'high'
  const menang = tinggi ? kartu2 > kartu1 : kartu2 < kartu1
  return { kartu1, kartu2, pilihan: tinggi ? 'tinggi' : 'rendah', menang, hadiah: menang ? bet * pengali : 0, pengali }
}

// ---------------- TOGEL (4D) ----------------
function mainTogel (bet, tebakan, pengali = 3000) {
  const hasil = String(rint(0, 9999)).padStart(4, '0')
  const t = String(tebakan || '').replace(/\D/g, '')
  const menang = t === hasil
  return { hasil, tebakan: t, menang, hadiah: menang ? bet * pengali : 0, pengali }
}

// ---------------- CRASH ----------------
// Multiplier naik acak; makin tinggi makin berisiko bust.
function mainCrash (bet, target) {
  target = Number(target)
  if (!(target >= 1.01)) return { error: 'target minimal 1.01' }
  // titik bust acak (distribusi berat ke bawah)
  const bust = Math.max(1.0, 0.99 / Math.random())
  const menang = target <= bust
  const pengali = menang ? target : 0
  return { bust: Math.round(bust * 100) / 100, target, menang, pengali, hadiah: menang ? Math.round(bet * target) : 0 }
}

// ---------------- MINES ----------------
// Buka N kotak aman dari 25; makin banyak aman, pengali makin besar.
function mainMines (bet, jumlahBuka, cfg = {}) {
  const jumlahBom = cfg.bom || 3
  const total = 25
  let amanTerbuka = 0
  let kenaBom = false
  for (let i = 0; i < jumlahBuka; i++) {
    const peluangBom = jumlahBom / (total - i)
    if (Math.random() < peluangBom) { kenaBom = true; break }
    amanTerbuka++
  }
  // pengali = 1 + 0.5 * amanTerbuka (kasar)
  const pengali = kenaBom ? 0 : Math.round((1 + 0.5 * amanTerbuka) * 100) / 100
  const menang = !kenaBom && amanTerbuka > 0
  return { amanTerbuka, kenaBom, pengali, menang, hadiah: menang ? Math.round(bet * pengali) : 0 }
}

// ---------------- GACHA ----------------
const GACHA_ITEMS = [
  { nama: 'Sampah 🗑️', langka: 'biasa', bobot: 40 },
  { nama: 'Batu 🪨', langka: 'biasa', bobot: 25 },
  { nama: 'Pisang 🍌', langka: 'biasa', bobot: 15 },
  { nama: 'Berlian 💎', langka: 'langka', bobot: 12 },
  { nama: 'Pedang Emas 🗡️', langka: 'langka', bobot: 6 },
  { nama: 'Naga 🐉', langka: 'epik', bobot: 2 }
]
function mainGacha () {
  const total = GACHA_ITEMS.reduce((a, b) => a + b.bobot, 0)
  let r = Math.random() * total
  for (const it of GACHA_ITEMS) {
    r -= it.bobot
    if (r <= 0) return it
  }
  return GACHA_ITEMS[0]
}

// ---------------- SPIN (roda keberuntungan) ----------------
const SPIN_HADIAH = [
  { label: 'Zonk', pengali: 0, bobot: 40 },
  { label: 'x0.5', pengali: 0.5, bobot: 25 },
  { label: 'x1', pengali: 1, bobot: 20 },
  { label: 'x2', pengali: 2, bobot: 10 },
  { label: 'x5', pengali: 5, bobot: 4 },
  { label: 'JACKPOT', pengali: 10, bobot: 1 }
]
function mainSpin (bet) {
  const total = SPIN_HADIAH.reduce((a, b) => a + b.bobot, 0)
  let r = Math.random() * total
  let hasil = SPIN_HADIAH[0]
  for (const it of SPIN_HADIAH) {
    r -= it.bobot
    if (r <= 0) { hasil = it; break }
  }
  return { label: hasil.label, pengali: hasil.pengali, menang: hasil.pengali > 1, hadiah: Math.round(bet * hasil.pengali) }
}

// ---------------- RANDOM UTIL ----------------
const QUOTES = [
  'Rejeki nggak kemana, dek.',
  'Hoki hari ini milik yang berani.',
  'Yang penting senang, dek.',
  'Uang bukan segalanya, tapi segalanya butuh uang.',
  'Judi itu haram, tapi bot ini cuma game kok.'
]
const PANTUN = [
  'Makan nasi pakai ikan,\njangan lupa deposit ke isan.',
  'Pagi-pagi minum kopi,\nsaldo kamu tinggal sepi.',
  'Jalan-jalan ke kota Medan,\nmenang casino jangan lupa undang teman.'
]
const BOLA8 = [
  'Iya, pasti.', 'Tidak.', 'Mungkin saja.', 'Coba lagi nanti.',
  'Nasibmu sedang baik.', 'Jangan harap.', 'Tanya lagi kalau sudah deposit.'
]
const TRUTH = [
  'Siapa yang terakhir kamu chat?', 'Berapa saldo asli kamu?',
  'Pernah bohong ke orang tua?', 'Siapa gebetan kamu sekarang?'
]
const DARE = [
  'Kirim "aku ganteng" di chat 3x.', 'Deposit 10k ke bot isan.',
  'Puji admin server di chat.', 'Nyanyi satu bait di chat.'
]
function mainTruthOrDare (mode) {
  return String(mode).toLowerCase() === 'dare' ? pilih(DARE) : pilih(TRUTH)
}
function mainRoll (maks) {
  maks = Math.max(1, Math.floor(Number(maks) || 100))
  return rint(1, maks)
}
function main8ball () { return pilih(BOLA8) }
function mainQuote () { return pilih(QUOTES) }
function mainPantun () { return pilih(PANTUN).replace(/\n/g, ' | ') }
function mainTarot () {
  const kartu = ['The Fool', 'The Magician', 'The Lovers', 'The Wheel', 'Death', 'The Sun', 'The Moon', 'The Star']
  const arti = ['awal baru', 'kesempatan', 'cinta', 'keberuntungan berputar', 'perubahan besar', 'kebahagiaan', 'ilusi', 'harapan']
  const i = rint(0, kartu.length - 1)
  return { kartu: kartu[i], arti: arti[i] }
}

module.exports = {
  rint, pilih,
  mainSlot, mainDadu, mainRoulette, mainTebak, mainHilo, mainTogel,
  mainCrash, mainMines, mainGacha, mainSpin,
  mainTruthOrDare, mainRoll, main8ball, mainQuote, mainPantun, mainTarot,
  GACHA_ITEMS, SPIN_HADIAH
}
