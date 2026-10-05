# 🎰 ISAN Casino Bot

Bot Minecraft Bedrock yang jalan di server **JavRock / Survival SMP** (`javrocksmp.my.id:11039`).
Bot ini jadi "telinga" chat in-game: membaca chat pemain, memproses command casino,
dan membalas lewat chat juga.

## ✨ Fitur

### 🎲 Permainan (`games.js`)
`slot` · `dadu` · `roulette` · `tebak` · `hilo` · `togel` · `crash` · `mines` ·
`gacha` · `spin` · `roll` · `8ball` · `quote` · `pantun` · `tarot` · `truth` · `dare`

### 💰 Ekonomi
`!saldo` · `!transfer @user <jml>` · `!top` · `!history` · `!stats` · `!profile` ·
`!daily` · `!kerja` · `!rampok` · `!voucher` · `!jackpot` · `!withdraw`

### 🛡️ Admin (khusus gamertag terdaftar)
Hanya gamertag di `database.json` → `admins` yang boleh pakai. Default: **`sannbets`**.

`!addsaldo` · `!setsaldo` · `!resetuser` · `!ban` · `!unban` · `!banlist` ·
`!setjackpot` · `!globalstat` · `!adminlist` · `!addadmin` · `!deladmin` · `!bc`

Gamertag lain yang coba → ditolak otomatis dan dicatat di log.

### ⚙️ Sistem
- Auto-reconnect dengan exponential backoff + watchdog
- Dedupe pesan (3 bot jadi "telinga" chat, 1 balasan)
- Rate-limit per pemain (anti-spam)
- Cooldown per command (`!daily` 24 jam, `!kerja` 5 mnt, `!gacha` 1 jam)
- Statistik pemain otomatis
- Progressive jackpot (1% tiap taruhan)
- Audit log transaksi → `transaksi.log`
- Backup database otomatis tiap jam
- Blacklist user

## 🚀 Cara Pakai

```bash
npm install
./start.sh          # jalankan bot (log juga disalin ke casino.log)
```

### Command terminal (saat bot jalan)
```
<pesan>                     kirim ke chat in-game lewat rotasi 3 bot
#send <bot> <pesan>         kirim lewat 1 bot tertentu
#saldo/#add/#set <user>     kelola saldo
#top / #stat                leaderboard & statistik global
#ban/#unban/#banlist        blacklist user
#admin [add|del] <user>     kelola admin
#jackpot [jml] / #export    jackpot & backup DB
#broadcast <pesan>          pengumuman ke chat
#status / #reconnect [all]  status & reconnect bot
#help / #quit
```

## 📁 Struktur

| File | Fungsi |
|---|---|
| `bot.js` | Program utama: koneksi, chat, command, admin gate |
| `games.js` | Mesin permainan (murni logika) |
| `db.js` | Database JSON: saldo, stats, admin, ban, jackpot, backup |
| `config.json` | Semua pengaturan (taruhan, pajak, hadiah, cooldown) |
| `PLANNING.md` | Rencana & catatan pengembangan |

## ⚠️ Keamanan

Folder **`auth/`** berisi cache token Xbox/Minecraft — **TIDAK PERNAH di-commit**
(sudah masuk `.gitignore`). File ini setara password akun bot.

## 📄 Lisensi

Privat — milik pribadi. All rights reserved.
