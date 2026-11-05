/* Prueba de punta a punta: la app real (index.html) contra un servidor Supabase simulado en memoria. */
const { chromium } = require('playwright'); const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.join(__dirname, '..'); const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALLO') + ' ' + m); if (!c) process.exitCode = 1; };
const MIME = {'.html':'text/html', '.js':'text/javascript', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json'};
const srv = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/\/$/, '/index.html')); fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, {'content-type':MIME[path.extname(f)] || 'application/octet-stream'}); r.end(b); } }); });
const stub = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8') + `
;(function(){
  const k = window.sessionStorage.getItem('fk');                   // el "servidor" vive en localStorage para sobrevivir a recargas
  const f = createFakeSupabase();
  const saved = JSON.parse(localStorage.getItem('fake-db') || 'null');
  if (saved) { saved.rows.forEach(r => f.rows.set(r.col + '|' + r.id, r)); Object.assign(f.state, saved.state, {calls:[]}); }
  else {
    const today = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
    f.seed('products', 'pop', {name:'Palomitas', cat:'palomitas', price:60, order:40, active:true});
    f.seed('products', 'cono', {name:'Helado 1 bola', cat:'helados', price:60, order:10, active:true, scoops:1});
    f.seed('settings', 'shop', {name:'Heladería', footer:'', cashiers:['Ana']});
    f.seed('days', today, {day:today, fondo:1500, opened:true, openedAt:Date.now() - 3000e3, openedBy:'Ana'});
  }
  const persist = () => localStorage.setItem('fake-db', JSON.stringify({rows:[...f.rows.values()], state:{pin:f.state.pin, codes:f.state.codes}}));
  setInterval(persist, 100); window.__f = f; window.__persist = persist;
  const sess = JSON.parse(localStorage.getItem('fake-session') || 'null'); if (sess) f.state.session = sess;
  const oi = f.sb.auth.signInWithPassword, oo = f.sb.auth.signOut;
  f.sb.auth.signInWithPassword = async a => { const r = await oi(a); localStorage.setItem('fake-session', JSON.stringify(f.state.session)); return r; };
  f.sb.auth.signOut = async () => { const r = await oo(); localStorage.removeItem('fake-session'); return r; };
  window.supabase = {createClient: () => f.sb};
})();`;
(async () => {
  await new Promise(r => srv.listen(0, r)); const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const b = await chromium.launch(); const ctx = await b.newContext({viewport:{width:1200, height:900}, serviceWorkers:'block'}); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('**/*', r => { const u = r.request().url(); if (u.endsWith('vendor/supabase.js')) return r.fulfill({status:200, contentType:'text/javascript', body:stub}); if (u.startsWith(base)) return r.continue(); return r.fulfill({status:200, contentType:'text/css', body:''}); });
  await page.goto(base); await page.waitForSelector('#gate:not([hidden])');
  ok(await page.locator('#g-mail').isVisible(), 'sin sesión aparece la pantalla de entrada');
  await page.fill('#g-mail', 'admin@test.local'); await page.fill('#g-pass', 'mal'); await page.click('#g-go'); await page.waitForTimeout(300);
  ok((await page.textContent('#g-msg')).includes('incorrectos'), 'contraseña mala: ' + (await page.textContent('#g-msg')));
  await page.fill('#g-pass', 'admin123'); await page.click('#g-go'); await page.waitForSelector('#gate', {state:'hidden'}); await page.waitForTimeout(800);
  ok((await page.textContent('#nav')).includes('Ajustes'), 'el administrador ve Ajustes');
  ok((await page.textContent('#status')).length > 0 && await page.locator('#view').isVisible(), 'la app carga los datos');

  // PIN y código de cajera (funciones del servidor)
  await page.goto(base + '#ajustes'); await page.waitForTimeout(600);
  await page.fill('#pin1', '1234'); await page.fill('#pin2', '1234'); await page.click('[data-act="pinsave"]'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.__f.state.pin === '1234'), 'el PIN se guarda en el servidor (nunca en la página)');
  ok(!(await page.evaluate(() => document.body.innerText + JSON.stringify(Object.keys(window).filter(k => /pin|hash|code/i.test(k))))).includes('1234'), 'el PIN no queda visible en la página');
  const cc = page.locator('[data-cc="0"]'); await cc.waitFor({timeout:3000}); await cc.fill('4321'); await page.click('[data-act="ccsave"][data-i="0"]'); await page.waitForTimeout(700);
  ok(await page.evaluate(() => window.__f.state.codes.Ana === '4321'), 'el código de Ana queda en el servidor');
  // respaldo completo (descarga de un archivo con todos los datos)
  const [dlf] = await Promise.all([page.waitForEvent('download', {timeout:8000}), page.click('[data-act="backup"]')]);
  const bk = JSON.parse(fs.readFileSync(await dlf.path(), 'utf8'));
  console.log('   archivo:', dlf.suggestedFilename(), JSON.stringify(bk.docs.map(d => d.col)));
  ok(/^respaldo-un-momento-rolled-\d{4}-\d\d-\d\d\.json$/.test(dlf.suggestedFilename()) && bk.docs.some(d => d.col === 'products') && bk.docs.some(d => d.col === 'settings'), 'el respaldo se descarga con todos los datos (' + bk.count + ' registros)');
  await page.waitForTimeout(500);
  ok(await page.evaluate(() => !!window.__f.get('settings', 'shop').lastBackup), 'queda anotada la fecha del último respaldo');
  await page.evaluate(() => window.__persist());

  // cerrar sesión (admin directo) y entrar con la cuenta de la caja
  await page.goto(base); await page.waitForTimeout(700);
  await page.evaluate(() => { location.hash = '#inicio'; }); await page.waitForTimeout(300);
  await page.locator('#outbtn').click(); await page.waitForSelector('#g-mail', {timeout:5000});
  ok(true, 'cerrar sesión devuelve a la pantalla de entrada');
  await page.fill('#g-mail', 'caja@test.local'); await page.fill('#g-pass', 'caja123'); await page.click('#g-go'); await page.waitForSelector('#gate', {state:'hidden'}); await page.waitForTimeout(800);
  ok(!(await page.textContent('#nav')).includes('Ajustes'), 'la cuenta de caja NO ve Ajustes');
  await page.goto(base + '#ajustes'); await page.waitForTimeout(500);
  ok((await page.textContent('#view')).includes('administradores'), 'y si abre #ajustes ve el aviso');

  // identificarse con código personal y cobrar
  await page.goto(base + '#caja'); await page.waitForTimeout(800);
  const needLogin = await page.locator('[data-act="login"]').count();
  if (needLogin) { await page.click('[data-act="login"]'); await page.fill('#lcode', '0000'); await page.click('[data-act="loginok"]'); await page.waitForTimeout(500); ok((await page.textContent('#toast')).includes('incorrecto'), 'código mal escrito se rechaza'); await page.fill('#lcode', '4321'); await page.click('[data-act="loginok"]'); await page.waitForTimeout(600); }
  ok(needLogin > 0, 'con códigos activados se pide entrar con el código');
  await page.click('[data-add="pop"]'); await page.click('.order [data-act="pay"]'); await page.waitForTimeout(300);
  await page.click('[data-pm="cash"]'); await page.fill('#recv', '100'); await page.click('#confirm'); await page.waitForTimeout(900);
  const sales = await page.evaluate(() => window.__f.all('sales'));
  ok(sales.length === 1 && sales[0].total === 60 && sales[0].cashier === 'Ana' && sales[0].change === 40, 'la venta llegó al servidor a nombre de Ana: ' + JSON.stringify(sales.map(s => [s.total, s.cashier, s.change])));
  await page.click('[data-act="tdlh"]'); await page.waitForTimeout(800);
  ok(ctx.pages().length === 1 && await page.locator('#printframe').count() === 1, 'imprimir usa la misma pestaña (marco oculto, sin ventana nueva)');
  ok((await page.locator('#printframe').getAttribute('srcdoc')).includes('Palomitas'), 'el marco contiene el ticket');
  await page.click('[data-act="mclose"]').catch(() => {}); await page.waitForTimeout(300);

  // descuento: exige el código del administrador y el servidor lo comprueba
  await page.click('[data-add="pop"]'); await page.click('[data-act="discask"]'); await page.waitForSelector('#apin');
  await page.fill('#apin', '0000'); await page.click('[data-act="authgo"]'); await page.waitForTimeout(400);
  ok((await page.textContent('#toast')).includes('incorrecto'), 'descuento con código malo se rechaza');
  await page.fill('#apin', '1234'); await page.click('[data-act="authgo"]'); await page.waitForSelector('#disc'); await page.fill('#disc', '10'); await page.waitForTimeout(200);
  await page.click('.order [data-act="pay"]'); await page.waitForTimeout(300); await page.click('[data-pm="cash"]'); await page.fill('#recv', '100'); await page.click('#confirm'); await page.waitForTimeout(900);
  const dsale = await page.evaluate(() => window.__f.all('sales').find(s => s.discount > 0));
  ok(dsale && dsale.total === 50 && dsale.authToken === undefined, 'la venta con descuento se guardó con autorización: ' + JSON.stringify(dsale && [dsale.discount, dsale.total]));
  await page.click('[data-act="mclose"]').catch(() => {}); await page.waitForTimeout(300);

  // sin internet: se cobra igual y se envía solo al volver
  await page.evaluate(() => { window.__f.state.offline = true; window.dispatchEvent(new Event('offline')); }); await page.waitForTimeout(200);
  await page.click('[data-add="pop"]'); await page.click('.order [data-act="pay"]'); await page.waitForTimeout(300); await page.click('[data-pm="cash"]'); await page.fill('#recv', '100'); await page.click('#confirm'); await page.waitForTimeout(900);
  ok(await page.locator('.dlg, [role="dialog"]').count() > 0 && (await page.textContent('#status')).includes('por enviar'), 'sin internet la venta se acepta y queda por enviar: ' + (await page.textContent('#status')));
  ok((await page.textContent('#banner')).includes('Sin internet'), 'sale el aviso de que no hay internet');
  ok(await page.evaluate(() => window.__f.all('sales').length) === 2, 'todavía no llegó al servidor');
  await page.click('[data-act="mclose"]').catch(() => {});
  await page.evaluate(() => { window.__f.state.offline = false; window.dispatchEvent(new Event('online')); }); await page.waitForTimeout(2500);
  ok(await page.evaluate(() => window.__f.all('sales').length) === 3, 'al volver el internet la venta llegó sola');
  ok(!(await page.textContent('#status')).includes('por enviar') && !(await page.textContent('#banner')).includes('Sin internet'), 'el aviso desaparece');

  // la cuenta de caja cierra sesión directamente (sin pedir PIN)
  await page.goto(base + '#cierre'); await page.waitForTimeout(700);
  const vend = (await page.textContent('#view')).replace(/\s+/g, ' ');
  ok(/Vendido/.test(vend) && /RD\$\s?170\.00/.test(vend) && /3 tickets/.test(vend), 'el cuadre muestra cuánto se vendió (RD$ 170.00, 3 tickets)');
  // cerrar el día y mandar el resumen por WhatsApp
  await page.fill('#counted', '1660'); await page.fill('#cwho', '4321').catch(() => {}); await page.click('[data-act="closeday"]'); await page.waitForTimeout(900);
  await page.evaluate(() => { window.__wa = ''; window.open = u => { window.__wa = u; return null; }; });
  await page.click('[data-act="wa"]'); await page.waitForTimeout(200);
  const wurl = await page.evaluate(() => window.__wa);
  ok(/wa\.me/.test(wurl) && decodeURIComponent(wurl).includes('Cierre del') && decodeURIComponent(wurl).includes('Ventas:'), 'el resumen de WhatsApp se arma con los totales: ' + decodeURIComponent(wurl).slice(0, 140).replace(/\n/g, ' | '));
  await page.locator('#outbtn').click(); await page.waitForSelector('#g-mail', {timeout:5000});
  ok(await page.locator('#apin').count() === 0, 'la cuenta de caja cierra sesión sin pedir el PIN');
  ok(await page.locator('.gate .glogo').count() === 1 && await page.locator('.gate .glogo').evaluate(i => i.complete && i.naturalWidth > 0), 'el logo aparece en la pantalla de entrada');
  ok(errs.length === 0, 'sin errores de JavaScript' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close(); srv.close();
})().catch(e => { console.error('FALLO', e); process.exit(1); });
