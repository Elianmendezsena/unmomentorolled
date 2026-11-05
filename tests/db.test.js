const assert = require('assert');
const createFake = require('./fake-supabase.js');
const CajaDB = require('../js/db.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let n = 0; const ok = m => console.log('OK   ' + m);
(async () => {
  const f = createFake(); await f.sb.auth.signInWithPassword({email:'admin@test.local', password:'admin123'});
  const db = CajaDB.create(f.sb);
  // set / get / update / delete
  await db.doc('products/a').set({name:'Cono', price:60});
  assert.deepStrictEqual((await db.doc('products/a').get()).data(), {name:'Cono', price:60}); ok('set y get de un documento');
  await db.doc('products/a').update({price:70}); assert.strictEqual(f.get('products', 'a').price, 70); assert.strictEqual(f.get('products', 'a').name, 'Cono'); ok('update mezcla sin pisar el resto');
  await assert.rejects(db.doc('products/zz').update({x:1}), e => e.code === 'not_found'); ok('update de algo inexistente da not_found');
  // ventas inmutables
  await db.doc('sales/s1').set({ts:1000, day:'d0', total:10}); await db.doc('sales/s1').set({ts:1000, day:'d0', total:999});
  assert.strictEqual(f.get('sales', 's1').total, 10); ok('una venta repetida no pisa la guardada (reintento seguro)');
  // consultas
  for (let i = 1; i <= 5; i++) await db.collection('sales').doc('q' + i).set({ts:i * 100, day:i < 3 ? 'd1' : 'd2', total:i});
  let snap = await db.collection('sales').where('ts', '>=', 200).where('ts', '<', 500).orderBy('ts', 'desc').limit(2).get();
  assert.deepStrictEqual(snap.docs.map(d => d.id), ['q4', 'q3']); ok('where + orderBy desc + limit');
  snap = await db.collection('sales').where('day', '==', 'd1').orderBy('ts', 'asc').get();
  assert.deepStrictEqual(snap.docs.map(d => d.id), ['q1', 'q2']); ok('filtro por día');
  // paginación (>1000)
  for (let i = 0; i < 2300; i++) f.seed('waste', 'w' + String(i).padStart(5, '0'), {ts:i});
  snap = await db.collection('waste').get(); assert.strictEqual(snap.size, 2300); ok('sin límite trae más de 1000 filas (páginas)');
  snap = await db.collection('waste').orderBy('ts', 'desc').limit(500).get(); assert.strictEqual(snap.size, 500); ok('con límite respeta el límite');
  // tiempo real
  const seen = []; const stop = db.collection('cashouts').where('ts', '>=', 50).orderBy('ts', 'desc').limit(3).onSnapshot(s => seen.push(s.docs.map(d => d.id)));
  await sleep(60); assert.deepStrictEqual(seen.at(-1), []);
  await db.doc('cashouts/c1').set({ts:100}); await db.doc('cashouts/c2').set({ts:200}); await db.doc('cashouts/c0').set({ts:10}); await sleep(80);
  assert.deepStrictEqual(seen.at(-1), ['c2', 'c1']); ok('onSnapshot recibe altas y respeta el filtro');
  await db.doc('cashouts/c1').update({ts:300}); await sleep(80); assert.deepStrictEqual(seen.at(-1), ['c1', 'c2']); ok('onSnapshot recibe cambios y reordena');
  await db.doc('cashouts/c2').delete(); await sleep(80); assert.deepStrictEqual(seen.at(-1), ['c1']); ok('onSnapshot recibe borrados');
  stop(); const len = seen.length; await db.doc('cashouts/c9').set({ts:999}); await sleep(80); assert.strictEqual(seen.length, len); ok('al cancelar no llegan más cambios');
  // documento en vivo
  const docs = []; const stop2 = db.doc('settings/shop').onSnapshot(s => docs.push(s.exists ? s.data() : null)); await sleep(60);
  await db.doc('settings/shop').set({name:'Mi heladería'}); await db.doc('settings/other').set({name:'otro'}); await sleep(80);
  assert.deepStrictEqual(docs.at(-1), {name:'Mi heladería'}); assert.ok(docs.every(d => d === null || d.name === 'Mi heladería')); ok('doc en vivo ignora otros documentos de la colección'); stop2();
  // permisos → errores traducidos
  const f2 = createFake({deny:(op, col) => col === 'products'}); await f2.sb.auth.signInWithPassword({email:'caja@test.local', password:'caja123'});
  const db2 = CajaDB.create(f2.sb);
  await assert.rejects(db2.doc('products/a').set({x:1}), e => e.code === 'invalid_argument'); ok('permiso denegado se traduce a invalid_argument');
  // sin sesión
  const f3 = createFake(); const db3 = CajaDB.create(f3.sb);
  await assert.rejects(db3.collection('sales').get(), e => e.code === 'unauthenticated'); ok('sin sesión da unauthenticated');
  // rpc
  assert.strictEqual(await db.rpc('pin_status'), false); await db.rpc('set_admin_pin', {p_pin:'1234'}); assert.strictEqual(await db.rpc('check_admin_pin', {p_pin:'1234'}), true);
  await db.rpc('set_cashier_code', {p_name:'ANA', p_code:'1111'}); assert.strictEqual(await db.rpc('verify_cashier_code', {p_code:'1111'}), 'ANA');
  await assert.rejects(db.rpc('set_cashier_code', {p_name:'LUIS', p_code:'1111'}), /duplicate/); ok('funciones de códigos (PIN, cajeras, duplicado)');
  for (let i = 0; i < 5; i++) await db.rpc('verify_cashier_code', {p_code:'0000'});
  await assert.rejects(db.rpc('verify_cashier_code', {p_code:'1111'}), e => e.code === 'locked'); ok('el servidor frena tras 5 fallos (locked)');
  // un solo canal de tiempo real para toda la tabla
  const f4 = createFake(); await f4.sb.auth.signInWithPassword({email:'admin@test.local', password:'admin123'}); let canales = 0; const oc = f4.sb.channel; f4.sb.channel = n => { canales++; return oc(n); };
  const db4 = CajaDB.create(f4.sb); ['products', 'flavors', 'stock', 'sales', 'days'].forEach(c => db4.collection(c).onSnapshot(() => {})); await sleep(100);
  assert.strictEqual(canales, 1); ok('cinco consultas en vivo comparten un solo canal de tiempo real');
  // ── autorización en el servidor ──
  const f5 = createFake(); f5.state.pin = '1234'; await f5.sb.auth.signInWithPassword({email:'caja@test.local', password:'caja123'});
  const db5 = CajaDB.create(f5.sb, {storage:null});
  await db5.doc('sales/n1').set({ts:1, subtotal:100, total:100, discount:0}); ok('cajero guarda una venta sin descuento');
  await assert.rejects(db5.doc('sales/n2').set({ts:2, subtotal:100, total:90, discount:10}), e => e.code === 'invalid_argument'); ok('descuento sin autorización: el servidor lo rechaza');
  await assert.rejects(db5.doc('voids/n1').set({reason:'x'}), e => e.code === 'invalid_argument'); ok('anulación sin autorización: rechazada');
  assert.strictEqual(await db5.rpc('grant_auth', {p_pin:'0000', p_kind:'discount'}), null); ok('código incorrecto no da autorización');
  const tk = await db5.rpc('grant_auth', {p_pin:'1234', p_kind:'discount'});
  await db5.doc('sales/n2').set({ts:2, subtotal:100, total:90, discount:10, authToken:tk}); assert.strictEqual(f5.get('sales', 'n2').authToken, undefined); ok('con la autorización el descuento se guarda (y la ficha no queda)');
  await assert.rejects(db5.doc('sales/n3').set({ts:3, subtotal:100, total:90, discount:10, authToken:tk}), e => e.code === 'invalid_argument'); ok('la autorización es de un solo uso');
  const tv = await db5.rpc('grant_auth', {p_pin:'1234', p_kind:'void'});
  await assert.rejects(db5.doc('sales/n4').set({ts:4, subtotal:100, total:50, discount:50, authToken:tv}), e => e.code === 'invalid_argument'); ok('una ficha de anulación no sirve para un descuento');

  // ── modo sin internet ──
  const mem = {}; const storage = {getItem:k => (k in mem ? mem[k] : null), setItem:(k, v) => { mem[k] = String(v); }, removeItem:k => { delete mem[k]; }, key:i => Object.keys(mem)[i], get length(){ return Object.keys(mem).length; }};
  const f6 = createFake(); await f6.sb.auth.signInWithPassword({email:'caja@test.local', password:'caja123'}); f6.seed('products', 'p1', {name:'Cono', price:60});
  const db6 = CajaDB.create(f6.sb, {storage});
  let lastP = null, fromC = null; db6.collection('products').onSnapshot(s => { lastP = s.docs.map(d => d.id); fromC = s.metadata.fromCache; }); const sales6 = []; db6.collection('sales').orderBy('ts', 'desc').onSnapshot(s => sales6.push(s.docs.map(d => d.id)));
  await sleep(80); assert.deepStrictEqual(lastP, ['p1']); assert.ok(Object.keys(mem).some(k => k.startsWith('caja.c.products'))); ok('lo leído se guarda en el equipo para leerlo sin internet');
  f6.state.offline = true;
  await db6.doc('sales/o1').set({ts:10, subtotal:60, total:60, discount:0}); await db6.doc('sales/o2').set({ts:20, subtotal:60, total:60, discount:0}); await sleep(80);
  assert.strictEqual(db6.status().pending, 2); assert.strictEqual(db6.status().online, false); assert.deepStrictEqual(sales6.at(-1), ['o2', 'o1']); assert.strictEqual(f6.get('sales', 'o1'), undefined); ok('sin internet la venta se acepta, se ve en pantalla y queda pendiente');
  assert.ok(JSON.parse(mem['caja.q']).length === 2); ok('la cola se guarda en el equipo (sobrevive a recargar la página)');
  await db6.doc('stock/p1').set({base:5}); await db6.doc('stock/p1').update({base:4}); assert.strictEqual(db6.status().pending, 4); ok('también se encolan stock y cambios, en orden');
  // la página se recarga sin internet: lee de lo guardado
  const db7 = CajaDB.create(f6.sb, {storage}); let p7 = null, c7 = null; db7.collection('products').onSnapshot(s => { p7 = s.docs.map(d => d.id); c7 = s.metadata.fromCache; }); const s7 = []; db7.collection('sales').orderBy('ts', 'desc').onSnapshot(s => s7.push(s.docs.map(d => d.id)));
  await sleep(120); assert.deepStrictEqual(p7, ['p1']); assert.strictEqual(c7, true); assert.deepStrictEqual(s7.at(-1), ['o2', 'o1']); assert.strictEqual(db7.status().pending, 4); ok('al abrir sin internet se ve lo último guardado y las ventas pendientes');
  f6.state.offline = false;
  await db6.flush(); await sleep(150);
  assert.ok(f6.get('sales', 'o1') && f6.get('sales', 'o2')); assert.strictEqual(f6.get('stock', 'p1').base, 4); assert.strictEqual(db6.status().pending, 0); assert.strictEqual(db6.status().online, true); ok('al volver el internet todo se envía en orden y la cola queda vacía');
  await db6.doc('sales/o1').set({ts:10, subtotal:60, total:60, discount:0}); assert.strictEqual(f6.all('sales').filter(x => x.id === 'o1').length, 1); ok('reenviar una venta no la duplica');
  // el servidor rechaza una operación encolada
  f6.state.offline = true; await db6.doc('sales/o9').set({ts:90, subtotal:100, total:80, discount:20}); f6.state.offline = false; await db6.flush(); await sleep(60);
  assert.strictEqual(db6.status().pending, 0); assert.strictEqual(db6.status().failed, 1); ok('lo que el servidor rechaza se separa y avisa (no se reintenta para siempre)');
  console.log('\nTodas las pruebas de la capa de datos pasaron.');
  process.exit(0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
