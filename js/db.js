/* Capa de datos de Un Momento Rolled.
   La app habla con una interfaz sencilla (collection / doc / where / orderBy / limit / get / set / update / delete / onSnapshot).
   Aquí esa interfaz se traduce a Supabase: todo se guarda en la tabla "docs" (col, id, data) y los cambios llegan en tiempo real. */
(function (root) {
  'use strict';
  const T = 'docs';
  const IMMUTABLE = new Set(['sales']);          // una venta repetida (reintento) no pisa la ya guardada
  const COLS = {ts:'ts', day:'day'};             // campos con columna propia (con índice)
  const PGOP = {'>=':'gte', '>':'gt', '<=':'lte', '<':'lt', '==':'eq', '!=':'neq'};
  const CMP = {'>=':(a, b) => a >= b, '>':(a, b) => a > b, '<=':(a, b) => a <= b, '<':(a, b) => a < b, '==':(a, b) => a === b, '!=':(a, b) => a !== b};

  const newId = () => (root.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : Math.random().toString(36).slice(2) + Date.now().toString(36));
  function toErr(e){
    const c = (e && e.code) || '', msg = (e && e.message) || '';
    let code = 'unknown';
    if (c === '42501' || /row-level security|permission denied/i.test(msg)) code = 'invalid_argument';
    else if (c === 'P0002' || /not_found/.test(msg)) code = 'not_found';
    else if (/locked/.test(msg)) code = 'locked';
    else if (c === 'PGRST301' || /JWT/i.test(msg)) code = 'unauthenticated';
    else if (/Failed to fetch|NetworkError|Load failed|network/i.test(msg)) code = 'unavailable';
    const err = new Error(msg || code); err.code = code; err.raw = e; return err;
  }
  const field = f => { if (!/^[A-Za-z0-9_]+$/.test(f)) throw new Error('Campo no válido: ' + f); return COLS[f] || ('data->>' + f); };
  const matches = (data, where) => where.every(([f, op, v]) => { const x = data[f]; return x !== undefined && x !== null && CMP[op](x, v); });
  const sorter = order => (a, b) => {
    const x = a.data[order[0]], y = b.data[order[0]], d = order[1] === 'desc' ? -1 : 1;
    if (x === y) return 0; if (x === undefined || x === null) return 1; if (y === undefined || y === null) return -1;
    return (x > y ? 1 : -1) * d;
  };
  const snapOf = (list, fc) => ({docs:list.map(r => ({id:r.id, data:() => JSON.parse(JSON.stringify(r.data)), exists:true})), size:list.length, empty:!list.length, metadata:{fromCache:!!fc}});

  const applyOp = (rows, op, onlyId) => {       // aplica una escritura pendiente a una lista local
    if (onlyId && op.id !== onlyId) return;
    if (op.k === 'delete') rows.delete(op.id);
    else if (op.k === 'update') { const cur = rows.get(op.id); if (cur) rows.set(op.id, {...cur, ...op.data}); }
    else { if (IMMUTABLE.has(op.col) && rows.has(op.id)) return; const d = {...op.data}; delete d.authToken; rows.set(op.id, d); }
  };

  function create(sb, opts){
    opts = opts || {};
    const lives = new Set();
    let ls = opts.storage; if (ls === undefined) { try { ls = root.localStorage; } catch { ls = null; } }
    const lget = k => { try { return ls ? JSON.parse(ls.getItem(k)) : null; } catch { return null; } };
    const lset = (k, v) => { try { if (ls) ls.setItem(k, JSON.stringify(v)); } catch {} };

    /* Cola de escrituras: si no hay internet, lo que se guarda se queda en este equipo y se envía solo al volver la conexión. */
    let queue = lget('caja.q'); if (!Array.isArray(queue)) queue = [];
    let failed = lget('caja.failed'); if (!Array.isArray(failed)) failed = [];
    let netOk = !(root.navigator && root.navigator.onLine === false), flushing = false, flushT = 0, probeT = 0, seq = Date.now();
    const statusCbs = new Set();
    const status = () => ({online:netOk, pending:queue.length, failed:failed.length});
    const notify = () => { const st = status(); statusCbs.forEach(cb => { try { cb(st); } catch {} }); };
    const persist = () => { lset('caja.q', queue); lset('caja.failed', failed); };
    function setNet(ok){
      if (ok === netOk) return;
      netOk = ok; notify();
      if (ok) { scheduleFlush(300); if (!queue.length) db.reloadAll(); clearTimeout(probeT); probeT = 0; }
      else if (!probeT) probeT = setTimeout(probe, 8000);
    }
    async function probe(){
      probeT = 0;
      try { const {error} = await sb.from(T).select('id').limit(1); if (error && toErr(error).code === 'unavailable') throw error; setNet(true); }
      catch { probeT = setTimeout(probe, 8000); }
    }
    const seen = e => { if (e && e.code === 'unavailable') setNet(false); return e; };
    const timed = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({message:'timeout', code:'unavailable'}), ms))]);
    const raw = op => {
      if (op.k === 'delete') return sb.from(T).delete().eq('col', op.col).eq('id', op.id).then(r => r);
      if (op.k === 'update') return sb.rpc('doc_merge', {p_col:op.col, p_id:op.id, p_patch:op.data}).then(r => r);
      return sb.from(T).upsert({col:op.col, id:op.id, data:op.data}, {onConflict:'col,id', ignoreDuplicates:IMMUTABLE.has(op.col)}).then(r => r);
    };
    async function exec(op, ms){
      let r; try { r = await timed(raw(op), ms); } catch (e) { throw seen(toErr(e)); }
      if (r && r.error) throw seen(toErr(r.error));
      setNet(true);
    }
    function scheduleFlush(ms){ clearTimeout(flushT); flushT = setTimeout(flush, ms); }
    async function flush(){
      if (flushing || !queue.length) return;
      flushing = true;
      try {
        while (queue.length) {
          const op = queue[0];
          try { await exec(op, 15000); queue.shift(); persist(); notify(); }
          catch (e) {
            if (e.code === 'unavailable' || e.code === 'unauthenticated') { scheduleFlush(10000); break; }
            queue.shift(); failed.push({...op, error:e.code}); persist(); notify();      // el servidor lo rechazó: no se reintenta
          }
        }
      } finally { flushing = false; }
      if (!queue.length) db.reloadAll();
    }
    function enqueue(op){
      op.n = ++seq; queue.push(op); persist();
      lives.forEach(h => { if (h.col === op.col) h.local(op); });
      notify(); scheduleFlush(netOk ? 2000 : 10000);
    }
    /* Guarda ya si hay internet; si no (o tarda demasiado), lo deja en la cola y da la operación por hecha. */
    async function mutate(op){
      if (queue.length || !netOk) { enqueue(op); return; }
      try { await exec(op, 7000); }
      catch (e) { if (e.code === 'unavailable') { enqueue(op); return; } throw e; }
    }
    const cacheKey = (col, onlyId) => 'caja.c.' + col + (onlyId ? '/' + onlyId : '');

    async function fetchRows(col, where, order, limit, onlyId){
      const build = () => {
        let q = sb.from(T).select('id,data').eq('col', col);
        if (onlyId) q = q.eq('id', onlyId);
        for (const [f, op, v] of where) q = q.filter(field(f), PGOP[op], v);
        if (order) q = q.order(field(order[0]), {ascending:order[1] !== 'desc'});
        else q = q.order('id', {ascending:true});
        return q;
      };
      if (limit) { const {data, error} = await build().limit(limit); if (error) throw seen(toErr(error)); setNet(true); return data || []; }
      const out = [], PAGE = 1000;                  // sin límite: se pide por páginas para no quedarse en las primeras 1000
      for (let from = 0; ; from += PAGE) {
        const {data, error} = await build().range(from, from + PAGE - 1); if (error) throw seen(toErr(error));
        out.push(...(data || [])); if (!data || data.length < PAGE) break;
      }
      setNet(true);
      return out;
    }

    /* Un solo canal de tiempo real para toda la tabla: el servidor comprueba permisos una vez por cambio
       (antes eran 12 canales y cada cambio se comprobaba 12 veces) y aquí se reparte según la colección. */
    let shared = null, everSub = false;
    function ensureChannel(){
      if (shared) return;
      shared = sb.channel('docs-' + newId())
        .on('postgres_changes', {event:'*', schema:'public', table:T}, p => {
          const col = (p.new && p.new.col) || (p.old && p.old.col);
          lives.forEach(h => { if (h.col === col) h.push(p); });
        });
      shared.subscribe(status => {
        if (status === 'SUBSCRIBED') { if (everSub) lives.forEach(h => h.reload()); everSub = true; }   // al reconectar se vuelve a leer lo que pudo perderse
      });
    }

    /* Consulta en vivo: se lee de inmediato (sin esperar al tiempo real) y luego llegan los cambios. */
    function live(col, where, order, limit, onList, onErr, onlyId){
      const rows = new Map(); let ready = false, pend = [], dead = false, emitT = 0, sig = '', lastRaw = '', cached = false;
      const list = () => {
        let l = [...rows.entries()].map(([id, data]) => ({id, data})).filter(r => matches(r.data, where));
        if (order) l.sort(sorter(order)); else l.sort((a, b) => (a.id < b.id ? -1 : 1));
        return limit ? l.slice(0, limit) : l;
      };
      const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => { if (!dead) onList(list(), cached); }, 25); };
      const overlay = () => queue.forEach(op => { if (op.col === col) applyOp(rows, op, onlyId); });
      const apply = p => {
        const id = (p.new && p.new.id) || (p.old && p.old.id); if (!id || (onlyId && id !== onlyId)) return;
        if (p.eventType === 'DELETE') rows.delete(id); else if (p.new) rows.set(id, p.new.data || {});
      };
      const load = async () => {
        if (dead) return;
        try {
          const rs = await fetchRows(col, where, order, limit, onlyId);
          const rw = JSON.stringify(rs);
          if (rw !== lastRaw) { lastRaw = rw; lset(cacheKey(col, onlyId), rs); }
          rows.clear(); rs.forEach(r => rows.set(r.id, r.data || {}));
          overlay();
          const had = pend.length; ready = true; cached = false; pend.forEach(apply); pend = [];
          const nsig = JSON.stringify(list());
          if (!dead && (nsig !== sig || had)) { sig = nsig; onList(list(), false); }   // si nada cambió, no se repinta la pantalla
        } catch (e) {
          const er = toErr(e);
          if (er.code === 'unavailable') {                    // sin internet: se usa lo último que se vio en este equipo
            if (!ready) {
              const c = lget(cacheKey(col, onlyId));
              rows.clear(); (Array.isArray(c) ? c : []).forEach(r => rows.set(r.id, r.data || {}));
              overlay(); ready = true; cached = true; sig = JSON.stringify(list());
              if (!dead) onList(list(), true);
            }
            return;
          }
          if (onErr) onErr(er);
        }
      };
      const handle = {col, reload:load, local(op){ applyOp(rows, op, onlyId); if (ready) emit(); }, push(p){ if (!ready) { pend.push(p); return; } apply(p); emit(); },
        stop(){ dead = true; clearTimeout(emitT); lives.delete(handle); if (!lives.size && shared) { try { sb.removeChannel(shared); } catch {} shared = null; everSub = false; } }};
      lives.add(handle);
      ensureChannel();
      load();
      return () => handle.stop();
    }

    function docRef(col, id){
      return {
        id,
        async set(data){ await mutate({k:'set', col, id, data:JSON.parse(JSON.stringify(data))}); },
        async update(patch){ await mutate({k:'update', col, id, data:JSON.parse(JSON.stringify(patch))}); },
        async delete(){ await mutate({k:'delete', col, id}); },
        async get(){
          const rs = await fetchRows(col, [], null, 1, id);
          return {exists:!!rs.length, data:() => (rs[0] ? rs[0].data : undefined)};
        },
        onSnapshot(cb, err){
          return live(col, [], null, 1, (l, fc) => { const r = l[0]; cb({exists:!!r, data:() => (r ? JSON.parse(JSON.stringify(r.data)) : undefined), metadata:{fromCache:!!fc}}); }, err, id);
        }
      };
    }
    function query(col, where = [], order = null, limit = 0){
      return {
        where:(f, op, v) => query(col, [...where, [f, op, v]], order, limit),
        orderBy:(f, dir) => query(col, where, [f, dir || 'asc'], limit),
        limit:n => query(col, where, order, n),
        async get(){ return snapOf((await fetchRows(col, where, order, limit)).map(r => ({id:r.id, data:r.data || {}}))); },
        onSnapshot:(cb, err) => live(col, where, order, limit, (l, fc) => cb(snapOf(l, fc)), err),
        doc:id => docRef(col, id || newId())
      };
    }
    const db = {
      collection:n => query(n),
      doc:path => { const i = path.indexOf('/'); return docRef(path.slice(0, i), path.slice(i + 1)); },
      /* Funciones del servidor (códigos y PIN). Devuelve el resultado o lanza un error con .code */
      async rpc(name, args){
        let r; try { r = await timed(sb.rpc(name, args || {}).then(x => x), 12000); } catch (e) { throw seen(toErr(e)); }
        if (r.error) throw seen(toErr(r.error));
        setNet(true); return r.data;
      },
      status, onStatus(cb){ statusCbs.add(cb); return () => statusCbs.delete(cb); },
      flush:() => flush(),
      failedOps:() => failed.slice(),
      dropFailed(){ failed = []; persist(); notify(); },
      /* Al cerrar la sesión se borra lo guardado para leer sin internet; las ventas pendientes de enviar se conservan. */
      clearLocal(){ try { if (!ls) return; const ks = []; for (let i = 0; i < ls.length; i++) ks.push(ls.key(i)); ks.filter(k => k && k.startsWith('caja.c.')).forEach(k => ls.removeItem(k)); } catch {} },
      /* Relectura escalonada (no todas a la vez) para no trabar la pantalla. */
      reloadAll(){ let i = 0; lives.forEach(h => { setTimeout(() => h.reload(), 120 * i++); }); }
    };
    if (root.addEventListener) {
      root.addEventListener('online', () => { setNet(true); scheduleFlush(300); if (!queue.length) db.reloadAll(); });
      root.addEventListener('offline', () => setNet(false));
      /* Al volver a la pestaña solo se relee si estuvo oculta un buen rato; el tiempo real ya trae los cambios recientes. */
      let hiddenAt = 0;
      if (root.document) root.document.addEventListener('visibilitychange', () => {
        if (root.document.hidden) { hiddenAt = Date.now(); return; }
        if (hiddenAt && Date.now() - hiddenAt > 120000) db.reloadAll();
        hiddenAt = 0;
      });
    }
    return db;
  }
  root.CajaDB = {create, toErr};
  if (typeof module !== 'undefined') module.exports = root.CajaDB;
})(typeof window !== 'undefined' ? window : globalThis);
