# Genera index.html a partir de la versión de Claude (artefacto). Uso: python3 port.py <artefacto.html> <salida index.html>
import sys, re
src = open(sys.argv[1], encoding='utf-8').read()
n_rep = 0
def rep(old, new, count=1):
    global src, n_rep
    c = src.count(old)
    if c != count: sys.exit('NO ENCONTRADO (%d veces, se esperaba %d): %s' % (c, count, old[:90]))
    src = src.replace(old, new); n_rep += 1

# ---- cabecera
head_end = src.index('<style>')
src = ('''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#3B2A20">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Caja">
<title>Caja Heladería</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/icon-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;800&family=Figtree:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap">
<script src="vendor/xlsx.full.min.js"></script>
<script src="vendor/supabase.js"></script>
<script src="config.js"></script>
<script src="js/db.js"></script>
''' + src[head_end:])

# ---- pantalla de entrada (login) + cierre del documento
rep('</style>\n', '''.gate{position:fixed;inset:0;z-index:9000;background:var(--bg);display:grid;place-items:center;padding:20px;overflow:auto}
.gate[hidden]{display:none}
.gate .box{width:100%;max-width:400px;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px 24px;box-shadow:0 10px 40px rgba(0,0,0,.08)}
.gate h1{font:800 26px var(--f-display);margin:0 0 4px}
.gate p{margin:0 0 16px;color:var(--muted)}
.gate .fld{margin-bottom:12px}
.gate .msg{min-height:20px;margin:6px 0 10px;color:#B3261E;font-size:14px}
.gate .btn{width:100%}
</style>
</head>
<body>
<div class="gate" id="gate" hidden></div>
''')
rep('</script>\n', '</script>\n</body>\n</html>\n') if src.count('</script>\n') == 1 else None
if not src.rstrip().endswith('</html>'): src = src.rstrip() + '\n</body>\n</html>\n'

# ---- estado
rep("db:null, user:null, dl:null, isAdmin:false, booting:true,", "db:null, sb:null, acct:null, dl:null, isAdmin:false, booting:true,")
rep("S.booting ? loading('Conectando con los datos de la caja…') : skeleton('<h2>No se pudo abrir la base de datos</h2><p>Abre este enlace con tu cuenta de Claude. Si ya lo hiciste, pide acceso de col", "S.booting ? loading('Conectando con los datos de la caja…') : skeleton('<h2>No se pudo abrir la base de datos</h2><p>Recarga la página. Si sigue igual, pide ayuda a quien administra la caja. (Detalle: col")

# ---- códigos: ahora se verifican en el servidor
rep('''async function codeOwner(v){
  if (!(window.crypto && crypto.subtle)) return '';
  for (const [n, c] of Object.entries(S.codes.users || {})) if ((S.shop.cashiers || []).includes(n) && (await hashPin(v, c.salt)) === c.hash) return n;
  return '';
}''', '''/* Devuelve el nombre, '' si el código no es de nadie, o null si no se pudo comprobar (ya se avisó). */
async function codeOwner(v){
  try { const n = await S.db.rpc('verify_cashier_code', {p_code:v}); return n && (S.shop.cashiers || []).includes(n) ? n : ''; }
  catch (e) { rpcErr(e); return null; }
}
function rpcErr(e){
  if (e && e.code === 'locked') { S.lockUntil = Date.now() + 60000; toast('Demasiados intentos. Espera un minuto.'); }
  else if (e && e.code === 'unavailable') toast('Sin conexión con el servidor. Revisa el internet.');
  else toast('No se pudo comprobar el código. Intenta otra vez.');
}
/* Vuelve a leer quién tiene PIN y qué cajeras tienen código (nunca llegan los códigos, solo los nombres). */
async function loadSecrets(){
  try {
    const [has, names] = await Promise.all([S.db.rpc('pin_status'), S.db.rpc('code_names')]);
    S.lock = has ? {has:true} : null;
    const u = {}; (names || []).forEach(n => { u[n] = true; }); S.codes = {users:u};
    S.loaded.lock = S.loaded.codes = true;
  } catch (e) { S.err = (e && e.code) || 'codes'; }
  render();
}
/* Un Promise.then para acciones que cambian códigos */
async function checkAdminPin(v){
  try { return !!(await S.db.rpc('check_admin_pin', {p_pin:v})); } catch (e) { rpcErr(e); return null; }
}''')
rep('''    const who = await codeOwner(v);
    if (!who) {
      S.fails++;
      if (S.fails >= 5) { S.fails = 0; S.lockUntil = Date.now() + 30000; toast('Demasiados intentos. Espera 30 segundos.'); } else toast('Código incorrecto.');
      if (inp) { inp.value = ''; inp.focus(); }
      return null;
    }''', '''    const who = await codeOwner(v);
    if (who === null) return null;
    if (!who) {
      toast('Código incorrecto.');
      if (inp) { inp.value = ''; inp.focus(); }
      return null;
    }''')
rep('''    if (!(window.crypto && crypto.subtle)) { toast('Este navegador no permite comprobar el código.'); return; }
    let who = '';
    for (const [n, c] of Object.entries(S.codes.users || {})) { if ((S.shop.cashiers || []).includes(n) && (await hashPin(v, c.salt)) === c.hash) { who = n; break; } }
    if (!who) {
      S.fails++;
      if (S.fails >= 5) { S.fails = 0; S.lockUntil = Date.now() + 30000; toast('Demasiados intentos. Espera 30 segundos.'); } else toast('Código incorrecto.');
      if (inp) { inp.value = ''; inp.focus(); }
      return;
    }''', '''    const who = await codeOwner(v);
    if (who === null) return;
    if (!who) {
      toast('Código incorrecto.');
      if (inp) { inp.value = ''; inp.focus(); }
      return;
    }''')
rep('''    if (!(window.crypto && crypto.subtle)) { toast('Este navegador no permite crear el código.'); return; }
    const users = {...((S.codes && S.codes.users) || {})};
    for (const [n, c] of Object.entries(users)) { if (n !== name && (await hashPin(v, c.salt)) === c.hash) { toast('Ese código ya lo usa otra persona. Elige otro.'); return; } }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    users[name] = {salt, hash:await hashPin(v, salt), ts:Date.now()};
    if (await write(() => S.db.doc('settings/codes').set({users}))) { toast('Código guardado para ' + name + '.'); paint(); }''', '''    try { await S.db.rpc('set_cashier_code', {p_name:name, p_code:v}); }
    catch (e) { toast(/duplicate/.test((e && e.message) || '') ? 'Ese código ya lo usa otra persona. Elige otro.' : 'No se pudo guardar el código.'); return; }
    await loadSecrets(); toast('Código guardado para ' + name + '.'); paint();''')
rep('''    const users = {...((S.codes && S.codes.users) || {})}; delete users[name];
    if (await write(() => S.db.doc('settings/codes').set({users}))) { toast('Código quitado a ' + name + '.'); paint(); }''', '''    try { await S.db.rpc('delete_cashier_code', {p_name:name}); } catch { toast('No se pudo quitar el código.'); return; }
    await loadSecrets(); toast('Código quitado a ' + name + '.'); paint();''')
rep('''    let ok = false;
    try { ok = (await hashPin(v, S.lock.salt)) === S.lock.hash; } catch { toast('No se pudo comprobar el código en este navegador.'); return; }
    if (!ok) {
      S.fails++;
      if (S.fails >= 5) { S.fails = 0; S.lockUntil = Date.now() + 30000; toast('Demasiados intentos. Espera 30 segundos.'); } else toast('Código incorrecto.');
      if (inp) { inp.value = ''; inp.focus(); }
      return;
    }
    S.fails = 0; closeModal(); a.cb();''', '''    const ok = await checkAdminPin(v);
    if (ok === null) return;
    if (!ok) { toast('Código incorrecto.'); if (inp) { inp.value = ''; inp.focus(); } return; }
    closeModal(); a.cb();''')
rep('''    if (!(window.crypto && crypto.subtle)) { toast('Este navegador no permite crear el código.'); return; }
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPin(a, salt);
    if (await write(() => S.db.doc('settings/lock').set({salt, hash, ts:Date.now()}))) { S.unlocked = true; toast('Código guardado.'); paint(); }''', '''    try { await S.db.rpc('set_admin_pin', {p_pin:a}); } catch { toast('No se pudo guardar el código.'); return; }
    await loadSecrets(); S.unlocked = true; toast('Código guardado.'); paint();''')
rep('''    let ok = false;
    try { ok = (await hashPin(v, S.lock.salt)) === S.lock.hash; } catch { toast('No se pudo comprobar el código en este navegador.'); return; }
    if (ok) { S.unlocked = true; S.fails = 0; paint(); return; }
    S.fails++;
    if (S.fails >= 5) { S.fails = 0; S.lockUntil = Date.now() + 30000; toast('Demasiados intentos. Espera 30 segundos.'); } else toast('Código incorrecto.');
    inp.value = ''; inp.focus();''', '''    const ok = await checkAdminPin(v);
    if (ok === null) return;
    if (ok) { S.unlocked = true; paint(); return; }
    toast('Código incorrecto.'); inp.value = ''; inp.focus();''')
rep('''if (gone && S.codes.users[gone]) { const us = {...S.codes.users}; delete us[gone]; S.db.doc('settings/codes').set({users:us}).catch(() => {}); }''', '''if (gone && S.codes.users[gone]) { S.db.rpc('delete_cashier_code', {p_name:gone}).then(loadSecrets).catch(() => {}); }''')
# quitar hashPin / hex
i = src.index("const hex = buf =>"); j = src.index("async function saveShop")
src = src[:i] + "\n" + src[j:]; n_rep += 1

# ---- descargas / impresión
rep('''    try { await S.dl.save({filename:'ticket-' + (s.code || 'venta') + '.html', data:html}); } catch (e) { if (!e || e.code !== 'declined') toast('No se pudo descargar el archivo.'); }''', '''    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else { toast('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes para este sitio.'); }''')
rep("Para imprimir: descarga el ticket con logo, ábrelo y se abre la ventana de impresión (elige la impresora térmica).", "Para imprimir: pulsa «Ticket con logo (imprimir)» y se abre la ventana de impresión (elige la impresora térmica).")

# ---- cerrar sesión de la cuenta
rep("  logout(){ S.session = ''; S.cashier = '';", '''  acctout(){
    const go = async () => { try { await S.sb.auth.signOut(); } catch {} location.reload(); };
    if (S.isAdmin) { go(); return; }
    askPin('Cerrar la sesión de este equipo', go, 'Solo quien administra puede cerrar la sesión de la caja. Escribe el código del administrador.');
  },
  logout(){ S.session = ''; S.cashier = '';''')
rep('''    </div><div class="stack">${alertsCard}</div></div></div>`;
}

/* ───────── Vista: Caja ───────── */''', '''    </div><div class="stack">${alertsCard}</div></div><p class="muted sm" style="margin-top:18px;text-align:center">Sesión: ${esc((S.acct && S.acct.name) || '')} · <button class="lnk" data-act="acctout">Cerrar sesión de este equipo</button></p></div>`;
}

/* ───────── Vista: Caja ───────── */''')

# ---- conexión: secretos por RPC; arranque con Supabase
rep("  db.doc('settings/codes').onSnapshot(snap => { S.codes = snap.exists ? snap.data() : {users:{}}; if (!S.codes.users) S.codes.users = {}; mark('codes', snap); }, err('codes'));\n", "  loadSecrets(); setInterval(loadSecrets, 60000); window.addEventListener('focus', loadSecrets);\n")
rep("  db.doc('settings/lock').onSnapshot(snap => { S.lock = snap.exists ? snap.data() : null; mark('lock', snap); }, err('lock'));\n", "")
i = src.index("async function boot(){"); j = src.index("/* La rueda del mouse")
src = src[:i] + r'''/* ───────── Entrada con cuenta (Supabase) ───────── */
function showGate(msg, opts){
  const g = $('#gate'); opts = opts || {};
  g.hidden = false;
  if (opts.noaccess) {
    g.innerHTML = `<div class="box"><h1>Sin permisos</h1><p>${esc(msg)}</p><button class="btn pri" id="g-out">Cerrar sesión</button></div>`;
    $('#g-out').onclick = async () => { try { await S.sb.auth.signOut(); } catch {} location.reload(); };
    return;
  }
  g.innerHTML = `<form class="box" id="g-form" autocomplete="on"><h1>Caja Heladería</h1><p>Entra con la cuenta de este equipo.</p>
    <div class="fld"><label for="g-mail">Correo</label><input class="in" id="g-mail" type="email" autocomplete="username" required></div>
    <div class="fld"><label for="g-pass">Contraseña</label><input class="in" id="g-pass" type="password" autocomplete="current-password" required></div>
    <div class="msg" id="g-msg" role="alert">${esc(msg || '')}</div>
    <button class="btn pri" id="g-go" type="submit">Entrar</button></form>`;
  $('#g-form').onsubmit = async ev => {
    ev.preventDefault();
    const b = $('#g-go'), m = $('#g-msg'); b.disabled = true; m.textContent = '';
    try {
      const {error} = await S.sb.auth.signInWithPassword({email:$('#g-mail').value.trim(), password:$('#g-pass').value});
      if (error) { m.textContent = /invalid/i.test(error.message) ? 'Correo o contraseña incorrectos.' : 'No se pudo entrar. Revisa el internet e intenta otra vez.'; b.disabled = false; return; }
      await enter();
    } catch { m.textContent = 'No se pudo entrar. Revisa el internet e intenta otra vez.'; b.disabled = false; }
  };
  setTimeout(() => { const e = $('#g-mail'); if (e) e.focus(); }, 50);
}
async function enter(){
  let w = null;
  try { w = await S.db.rpc('whoami'); } catch (e) { showGate('No se pudo conectar. Revisa el internet y recarga la página.', {noaccess:true}); return; }
  if (!w) { showGate('Esta cuenta no tiene acceso a la caja. Pide a quien administra que la habilite.', {noaccess:true}); return; }
  S.acct = w; S.isAdmin = w.role === 'admin';
  $('#gate').hidden = true; $('#gate').innerHTML = '';
  S.booting = false; listen(); paint();
}
async function boot(){
  paint();
  const cfg = window.CAJA_CONFIG, lib = window.supabase, CD = window.CajaDB;
  if (!cfg || !lib || !CD) { S.booting = false; showGate('Falta la configuración de la aplicación.', {noaccess:true}); return; }
  S.sb = lib.createClient(cfg.url, cfg.key, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false}});
  S.db = CD.create(S.sb);
  S.dl = {save: async ({filename, data}) => {
    const blob = new Blob([data], {type: /\.xlsx$/.test(filename) ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : /\.csv$/.test(filename) ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }};
  S.sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') setTimeout(() => location.reload(), 0); });
  let session = null;
  try { session = (await S.sb.auth.getSession()).data.session; } catch {}
  if (session) { await enter(); }
  else { S.booting = false; showGate(); }
}
''' + src[j:]
rep("boot();\n})();", "boot();\nif ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));\n})();")
open(sys.argv[2], 'w', encoding='utf-8').write(src)
print('ok,', n_rep, 'cambios')
