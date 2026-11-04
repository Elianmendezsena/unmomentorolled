/* Capa de datos de Caja Heladería.
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
  const snapOf = list => ({docs:list.map(r => ({id:r.id, data:() => JSON.parse(JSON.stringify(r.data)), exists:true})), size:list.length, empty:!list.length, metadata:{fromCache:false}});

  function create(sb){
    const lives = new Set();

    async function fetchRows(col, where, order, limit, onlyId){
      const build = () => {
        let q = sb.from(T).select('id,data').eq('col', col);
        if (onlyId) q = q.eq('id', onlyId);
        for (const [f, op, v] of where) q = q.filter(field(f), PGOP[op], v);
        if (order) q = q.order(field(order[0]), {ascending:order[1] !== 'desc'});
        else q = q.order('id', {ascending:true});
        return q;
      };
      if (limit) { const {data, error} = await build().limit(limit); if (error) throw toErr(error); return data || []; }
      const out = [], PAGE = 1000;                  // sin límite: se pide por páginas para no quedarse en las primeras 1000
      for (let from = 0; ; from += PAGE) {
        const {data, error} = await build().range(from, from + PAGE - 1); if (error) throw toErr(error);
        out.push(...(data || [])); if (!data || data.length < PAGE) break;
      }
      return out;
    }

    /* Consulta en vivo: carga inicial + cambios en tiempo real; vuelve a cargar al reconectar. */
    function live(col, where, order, limit, onList, onErr, onlyId){
      const rows = new Map(); let ready = false, queue = [], dead = false, emitT = 0;
      const list = () => {
        let l = [...rows.entries()].map(([id, data]) => ({id, data})).filter(r => matches(r.data, where));
        if (order) l.sort(sorter(order)); else l.sort((a, b) => (a.id < b.id ? -1 : 1));
        return limit ? l.slice(0, limit) : l;
      };
      const emit = () => { clearTimeout(emitT); emitT = setTimeout(() => { if (!dead) onList(list()); }, 25); };
      const apply = p => {
        const id = (p.new && p.new.id) || (p.old && p.old.id); if (!id || (onlyId && id !== onlyId)) return;
        if (p.eventType === 'DELETE') rows.delete(id); else if (p.new) rows.set(id, p.new.data || {});
      };
      const load = async () => {
        if (dead) return;
        try {
          const rs = await fetchRows(col, where, order, limit, onlyId);
          rows.clear(); rs.forEach(r => rows.set(r.id, r.data || {}));
          ready = true; queue.forEach(apply); queue = []; if (!dead) onList(list());
        } catch (e) { if (onErr) onErr(toErr(e)); }
      };
      const ch = sb.channel('l-' + col + '-' + newId())
        .on('postgres_changes', {event:'*', schema:'public', table:T, filter:'col=eq.' + col}, p => { if (!ready) { queue.push(p); return; } apply(p); emit(); });
      ch.subscribe(status => { if (status === 'SUBSCRIBED') load(); });
      const fallback = setTimeout(() => { if (!ready) load(); }, 4000);   // si el tiempo real no conecta, se carga igual
      const handle = {reload:load, stop(){ dead = true; clearTimeout(fallback); clearTimeout(emitT); lives.delete(handle); try { sb.removeChannel(ch); } catch {} }};
      lives.add(handle);
      return () => handle.stop();
    }

    function docRef(col, id){
      return {
        id,
        async set(data){
          const {error} = await sb.from(T).upsert({col, id, data}, {onConflict:'col,id', ignoreDuplicates:IMMUTABLE.has(col)});
          if (error) throw toErr(error);
        },
        async update(patch){
          const {error} = await sb.rpc('doc_merge', {p_col:col, p_id:id, p_patch:patch});
          if (error) throw toErr(error);
        },
        async delete(){
          const {error} = await sb.from(T).delete().eq('col', col).eq('id', id);
          if (error) throw toErr(error);
        },
        async get(){
          const rs = await fetchRows(col, [], null, 1, id);
          return {exists:!!rs.length, data:() => (rs[0] ? rs[0].data : undefined)};
        },
        onSnapshot(cb, err){
          return live(col, [], null, 1, l => { const r = l[0]; cb({exists:!!r, data:() => (r ? JSON.parse(JSON.stringify(r.data)) : undefined), metadata:{fromCache:false}}); }, err, id);
        }
      };
    }
    function query(col, where = [], order = null, limit = 0){
      return {
        where:(f, op, v) => query(col, [...where, [f, op, v]], order, limit),
        orderBy:(f, dir) => query(col, where, [f, dir || 'asc'], limit),
        limit:n => query(col, where, order, n),
        async get(){ return snapOf((await fetchRows(col, where, order, limit)).map(r => ({id:r.id, data:r.data || {}}))); },
        onSnapshot:(cb, err) => live(col, where, order, limit, l => cb(snapOf(l)), err),
        doc:id => docRef(col, id || newId())
      };
    }
    const db = {
      collection:n => query(n),
      doc:path => { const i = path.indexOf('/'); return docRef(path.slice(0, i), path.slice(i + 1)); },
      /* Funciones del servidor (códigos y PIN). Devuelve el resultado o lanza un error con .code */
      async rpc(name, args){ const {data, error} = await sb.rpc(name, args || {}); if (error) throw toErr(error); return data; },
      reloadAll(){ lives.forEach(h => h.reload()); }
    };
    if (root.addEventListener) {
      root.addEventListener('online', () => db.reloadAll());
      if (root.document) root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) db.reloadAll(); });
    }
    return db;
  }
  root.CajaDB = {create, toErr};
  if (typeof module !== 'undefined') module.exports = root.CajaDB;
})(typeof window !== 'undefined' ? window : globalThis);
