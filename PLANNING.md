# 📋 PLANNING PENGEMBANGAN ISAN CASINO BOT

Tanggal: 2026-10-04 (diperbarui: implementasi tahap 1–4 SELESAI)
Status gerak: **DIHENTIKAN** (akan ditangani user pakai `tpahere`). Fokus: **fitur & command**.

---

## ✅ SUDAH DIKERJAKAN

### File baru
- **`config.json`** — konfigurasi terpusat (min/max taruhan, pajak, hadiah, pengali, cooldown, backup).
- **`games.js`** — mesin permainan murni: slot, dadu, roulette, tebak, hilo, togel, crash, mines, gacha, spin, roll, 8ball, quote, pantun, tarot, truth/dare.
- **`PLANNING.md`** — dokumen ini.

### `db.js` diperluas (API lama tetap jalan)
Statistik pemain, leaderboard (`getTop`), transfer antar pemain, cooldown, ban, **admin**, meta/jackpot, reset, backup otomatis, audit log ke `transaksi.log`.

### Command CHAT baru (semua sudah terpasang & teruji)
| Kelompok | Command |
|---|---|
| Umum | `!help` `!menu` `!rules` `!info` `!ping` `!jam` |
| Saldo | `!saldo [user]` `!withdraw` `!transfer @user <jml>` `!top` `!history` `!stats [user]` `!profile [user]` |
| Ekonomi | `!daily` `!kerja` `!rampok @user` `!voucher <kode>` `!jackpot` |
| Permainan | `!casino` `!slot` `!dadu` `!roulette` `!tebak` `!hilo` `!togel` `!crash` `!mines` `!coinflip` `!acc` `!gacha` `!spin` |
| Hiburan | `!roll` `!8ball` `!quote` `!pantun` `!tarot` `!truth` `!dare` |

### 🛡️ ADMIN lewat CHAT (permintaan user)
Hanya gamertag yang terdaftar di `database.json` → `admins` yang boleh. **Admin aktif: `sannbets`**.
| Command | Fungsi |
|---|---|
| `!admin` | daftar command admin |
| `!addsaldo <user> <jml>` | tambah saldo |
| `!setsaldo <user> <jml>` | set saldo |
| `!resetuser <user>` | reset saldo & history |
| `!ban` / `!unban <user>` | blokir / buka blokir |
| `!banlist` | daftar user diblokir |
| `!setjackpot <jml>` | set pool jackpot |
| `!globalstat` | statistik global |
| `!adminlist` | daftar admin |
| `!addadmin` / `!deladmin <user>` | tambah / hapus admin |
| `!bc <pesan>` | broadcast ke chat |

Gerbang keamanan di `routeCommand`, urutan: **ban → rate-limit → admin-gate → command biasa**.
Non-admin yang coba → dibalas `"command itu khusus admin, kamu nggak punya akses"` + dicatat `⛔ AKSES ADMIN DITOLAK`.

### Command TERMINAL admin baru
`#top` `#stat` `#reset <user>` `#ban/#unban <user>` `#banlist` `#admin [add|del] <user>` `#jackpot [jml]` `#export` `#broadcast <pesan>`.

### Fitur sistem
Rate-limit per pemain (5 cmd/10 detik), cooldown (`!daily` 24 jam, `!kerja` 5 mnt, `!rampok` 10 mnt, `!gacha` 1 jam), statistik otomatis tiap main, progressive jackpot (1% tiap taruhan), audit log, backup DB otomatis tiap jam (simpan 24 terakhir), blacklist user.

### 🐞 Fix bug penting
**BOT1 loop reconnect saat masuk overworld** — paket NBT Geyser (`block_entity_data`, id 0x38) gagal di-parse → dihitung "error beruntun" → circuit breaker memaksa reconnect → loop. Sekarang error `Invalid tag`/`Read error for` **diabaikan** (koneksi tetap sehat). Terbukti: 0 error setelah fix.

---

## 📌 BELUM DIKERJAKAN (opsional / lanjutan)
- `!pinjam` (sistem utang + bunga), `!donate`, `!tebakkata`, `!afk`, event terjadwal `#event`.
- Statistik menang/kalah per-jenis-game (sekarang agregat).
- Dashboard/web panel.
- **Gerak bot** (ditangani user via `tpahere`).

---

## 1. KONDISI BOT SEKARANG (baseline)

**Koneksi:** 3 akun (`BOT1`=deposit/IsanKaramazv, `BOT2`, `BOT3`) → `javrocksmp.my.id:11039`.
Semua bot jadi "telinga" chat, dedupe pesan, auto-reconnect, watchdog, auto-sapa warp.

**Command chat yang ADA sekarang (7):**
| Command | Fungsi |
|---|---|
| `!help` | info singkat + cara deposit |
| `!menu` | daftar command |
| `!saldo` / `!balance` / `!bal` | lihat saldo |
| `!withdraw` / `!wd <jumlah>` | tarik saldo → `/pay` |
| `!casino <taruhan>` | 50/50 menang 2x |
| `!coinflip @lawan <taruhan> head\|tail` | tantang coinflip |
| `!acc` / `!accept` | terima tantangan coinflip |

**Command terminal admin yang ADA (7):** `#send`, `#saldo`, `#add`, `#set`, `#list`, `#status`, `#reconnect`, `#quit`, `#help`

**Database:** `database.json` — `{ users: { <key>: { username, balance, history[] } } }`
Fungsi: `ensureUser, getBalance, addBalance, subBalance, setBalance, listUsers, loadDB, saveDB`.
History maksimal 200 entri/user.

**Yang BELUM ada (celah):** statistik pemain, cooldown, leaderboard, transfer antar pemain, permainan selain 50/50 & coinflip, rate-limit per pemain, audit log, ekonomi harian.

---

## 2. USULAN COMMAND BARU

### 🎰 A. Permainan Casino (prioritas tinggi — ini inti "casino")
| Command | Deskripsi | Rumus/Detail |
|---|---|---|
| `!slot <taruhan>` | Mesin slot 3 reel (🍒🍋💎7️⃣) | 3 sama = 5x, 2 sama = 1.5x, sisanya kalah |
| `!dadu <taruhan> <angka 1-6>` | Tebak dadu | benar = 5x |
| `!roulette <taruhan> <merah\|hitam\|hijau\|0-36>` | Roulette | merah/hitam 2x, angka 36x, hijau 14x |
| `!jackpot` | Panggil progresif jackpot | jackpot naik dari potongan tiap taruhan |
| `!togel <taruhan> <4 angka>` | Tebak 4D | cocok penuh = 3000x |
| `!crash <taruhan>` | Cashout sebelum crash | multiplier naik, bisa bust |
| `!hilo <taruhan> <tinggi\|rendah>` | Tebak kartu lebih tinggi/rendah | 2x |
| `!tebak <taruhan> <angka 1-10>` | Tebak angka sederhana | 8x |
| `!mines <taruhan>` | Mines (buka kotak aman) | makin banyak aman makin besar |

### 💰 B. Ekonomi & Bank
| Command | Deskripsi |
|---|---|
| `!transfer @user <jumlah>` | Kirim saldo ke pemain lain (pajak 2%) |
| `!top` / `!richest` | Leaderboard 5 saldo terbesar |
| `!history` | 10 transaksi terakhir kamu |
| `!daily` | Bonus harian (sekali/24 jam, mis. 5rb) |
| `!kerja` / `!work` | Cari uang, cooldown 5 menit |
| `!rampok @user` | Rampok saldo (sukses 30%, gagal kena denda) |
| `!pinjam <jumlah>` | Pinjam saldo (bunga 10%, wajib balik) |
| `!donate @user <jumlah>` | Donasi (tanpa pajak) |
| `!hadiah` | Klaim hadiah / bonus event |
| `!voucher <kode>` | Tukar kode voucher → saldo |

### 🎲 C. Sosial & Utilitas
| Command | Deskripsi |
|---|---|
| `!ping` | Cek bot hidup + latency |
| `!info` | Info bot casino |
| `!stats [@user]` | Statistik menang/kalah/total taruhan |
| `!profile [@user]` | Kartu profil pemain |
| `!roll <maks>` | Angka acak 1..maks |
| `!8ball <pertanyaan>` | Bola ajaib |
| `!jam` | Waktu server (WIB) |
| `!quote` / `!motivasi` / `!pantun` | Kalimat random |
| `!rules` | Aturan casino |
| `!afk` | Tandai AFK |

### 🎉 D. Hiburan / Random
| Command | Deskripsi |
|---|---|
| `!gacha` | Gacha karakter/item (cooldown) |
| `!tarot` | Ramalan tarot |
| `!truth` / `!dare` | Truth or dare |
| `!tebakkata` | Mini-game tebak kata |
| `!spin` | Roda keberuntungan (hadiah kecil) |

### 🛠️ E. Terminal Admin (baru)
| Command | Deskripsi |
|---|---|
| `#top` | Leaderboard dari terminal |
| `#reset <user>` | Reset saldo+history user |
| `#ban` / `#unban <user>` | Blokir user dari command |
| `#stat` | Statistik global (total taruhan, payout, jackpot) |
| `#event <nama>` | Mulai event casino |
| `#broadcast <pesan>` | Kirim pengumuman ke chat in-game |
| `#export` | Backup database ke file timestamp |
| `#give <user> <jumlah>` | Alias `#add` |

---

## 3. FITUR SISTEM (non-command)

1. **Cooldown per command** — `!daily` 24 jam, `!kerja` 5 menit, `!rampok` 10 menit, `!gacha` 1 jam.
2. **Rate-limit per pemain** — maks N command / 10 detik, cegah spam.
3. **Statistik pemain** — simpan di DB: `wins, losses, totalBet, totalWon, biggestWin`.
4. **Statistik global** — total taruhan, total payout, jackpot terkumpul (tampil di `#stat`).
5. **Audit log** — file `transaksi.log` (semua deposit/withdraw/bet) untuk cek sengketa.
6. **Progressive jackpot** — potong 1% tiap taruhan → masuk pool jackpot, bisa dipecah di `!jackpot`.
7. **Anti-exploit deposit** — sudah ada (`looksLikeDepositExploit`), perluas.
8. **Backup DB otomatis** — tiap 1 jam → `database.bak-<jam>.json`, simpan 24 terakhir.
9. **Blacklist/whitelist** — daftar user diblokir (`banned.json`).
10. **Konfigurasi terpusat** — file `config.json` (taruhan min/max, pajak, hadiah daily) biar gampang diubah tanpa edit kode.

---

## 4. URUTAN PENGERJAAN (diusulkan)

**Tahap 1 — Fondasi (wajib duluan):**
- `config.json` (min/max bet, pajak, hadiah) + loader.
- Perluas `db.js`: statistik pemain, cooldown, leaderboard, transfer.
- Rate-limit + cooldown helper.
- Backup DB otomatis.

**Tahap 2 — Permainan (inti casino):**
- `!slot`, `!dadu`, `!roulette`, `!tebak`, `!hilo`, `!jackpot`.
- Statistik otomatis ter-update tiap main.

**Tahap 3 — Ekonomi:**
- `!transfer`, `!top`, `!history`, `!daily`, `!kerja`, `!rampok`.

**Tahap 4 — Sosial & Admin:**
- `!ping`, `!info`, `!stats`, `!profile`, `!rules`, `!roll`, `!8ball`, `!jam`.
- Terminal: `#top`, `#reset`, `#stat`, `#export`, `#broadcast`.

**Tahap 5 — Hiburan (opsional):**
- `!gacha`, `!tarot`, `!spin`, `!truth/!dare`, `!voucher`, `#event`.

---

## 5. CATATAN TEKNIS
- Semua command masuk lewat `routeCommand(sender, commandRaw)` (bot.js baris ~561) → tambah cabang `if (first === 'xxx')`.
- Balasan pakai `enqueue(pesan, [botUsername])` — rotasi 3 bot; command sensitif (deposit/withdraw) WAJIB dari `DEPOSIT_BOT`.
- `db.js` semua SYNC (`fs.*Sync`) supaya aman dari race condition.
- Jangan ganggu fungsi koneksi/watchdog yang sudah stabil.
- Tiap perubahan: `node --check bot.js` + backup `bot.js.bakN-<jam>`.
