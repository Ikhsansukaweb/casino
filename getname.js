// Ambil nama in-game ASLI lewat Minecraft Services (READ-ONLY dari cache).
const fs = require('fs'), path = require('path')
const folders = ['BOT1','BOT2','BOT3','BOT4']
;(async () => {
  for (const f of folders) {
    const dir = path.join(__dirname, 'auth', f)
    const files = fs.readdirSync(dir).filter(x => x.endsWith('_xbl-cache.json'))
    const cache = JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))
    let tok = null
    for (const k of Object.keys(cache)) if (cache[k] && cache[k].XSTSToken) { tok = cache[k]; break }
    if (!tok) { console.log(f, '=> (no XSTS)'); continue }
    try {
      const r1 = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityToken: 'XBL3.0 x=' + tok.userHash + ';' + tok.XSTSToken })
      })
      const j1 = await r1.json()
      if (!j1.access_token) { console.log(f, '=> login_with_xbox gagal HTTP', r1.status, JSON.stringify(j1).slice(0,200)); continue }
      const r2 = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: 'Bearer ' + j1.access_token }
      })
      const j2 = await r2.json()
      console.log(f, '=> name =', j2.name, '| id =', j2.id, '| HTTP', r2.status)
    } catch (e) { console.log(f, '=> GAGAL:', e.message) }
  }
})()
