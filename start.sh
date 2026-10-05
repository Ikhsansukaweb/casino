#!/usr/bin/env bash
# ==================== ISAN CASINO BOT — LAUNCHER ====================
# Jalankan bot di terminal ini, dan salin SEMUA log ke casino.log supaya bisa
# diperiksa juga dari luar terminal. Pakai:
#     ./start.sh
# Hentikan dengan Ctrl+C.
cd "$(dirname "$0")" || exit 1

echo "🎰 ISAN CASINO BOT — log langsung di sini"
echo "   (log juga disalin ke: $(pwd)/casino.log)"
echo "=================================================="
echo

# stdbuf biar output tidak nyangkut di buffer (penting untuk pantau realtime).
stdbuf -oL -eL node bot.js 2>&1 | tee casino.log
