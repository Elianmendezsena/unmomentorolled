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
  console.log('\nTodas las pruebas de la capa de datos pasaron.');
  process.exit(0);
})().catch(e => { console.error('FALLO', e); process.exit(1); });
