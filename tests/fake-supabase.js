/* Cliente Supabase simulado en memoria, solo para pruebas (no se usa en producción).
   Imita lo que la app necesita: tabla docs, filtros, tiempo real, funciones (RPC) y sesión. */
(function (root) {
  'use strict';
  function createFake(opts = {}) {
    const rows = new Map();                 // "col|id" -> {col,id,data,ts,day}
    const listeners = new Set();
    const state = {pin:null, codes:{}, attempts:{pin:0, code:0}, session:null, calls:[]};
    const users = opts.users || {'admin@test.local':{password:'admin123', role:'admin', name:'Admin'}, 'caja@test.local':{password:'caja123', role:'cajero', name:'Caja'}};
    const deny = opts.deny || (() => false);
    const who = () => (state.session ? {role:users[state.session.email].role, name:users[state.session.email].name} : null);
    const gen = d => ({ts:typeof d.ts === 'number' ? Math.floor(d.ts) : null, day:d.day ?? null});
    const clone = x => JSON.parse(JSON.stringify(x));
    const emit = (eventType, n, o) => { const r = n || o; listeners.forEach(l => { if (!l.col || l.col === r.col) setTimeout(() => l.cb({eventType, new:n ? clone(n) : null, old:o ? {col:o.col, id:o.id} : null}), 0); }); };
    const rls = e => ({code:'42501', message:'new row violates row-level security policy for table "docs" (' + e + ')'});
    const colVal = (r, c) => c === 'col' ? r.col : c === 'id' ? r.id : c === 'ts' ? r.ts : c === 'day' ? r.day : (c.startsWith('data->>') ? String(r.data[c.slice(7)]) : undefined);
    const OPS = {gte:(a, b) => a >= b, gt:(a, b) => a > b, lte:(a, b) => a <= b, lt:(a, b) => a < b, eq:(a, b) => a == b, neq:(a, b) => a != b};

    function builder(table) {
      const q = {op:'select', filters:[], order:null, limit:null, range:null, payload:null, o:{}};
      const run = async () => {
        if (!state.session && !opts.anon) return {data:null, error:{code:'PGRST301', message:'JWT required'}};
        state.calls.push(q.op + ':' + table);
        if (q.op === 'select') {
          let l = [...rows.values()].filter(r => q.filters.every(([c, op, v]) => OPS[op](colVal(r, c), v)));
          if (q.order) { const [c, asc] = q.order; l.sort((a, b) => { const x = colVal(a, c), y = colVal(b, c); return x === y ? 0 : ((x == null) ? 1 : (y == null) ? -1 : (x > y ? 1 : -1)) * (asc ? 1 : -1); }); }
          if (q.range) l = l.slice(q.range[0], q.range[1] + 1);
          if (q.limit) l = l.slice(0, q.limit);
          return {data:l.map(r => ({id:r.id, data:clone(r.data)})), error:null};
        }
        if (q.op === 'upsert') {
          const p = q.payload, k = p.col + '|' + p.id, old = rows.get(k);
          if (deny(old ? 'update' : 'insert', p.col)) return {data:null, error:rls(p.col)};
          if (old && q.o.ignoreDuplicates) return {data:null, error:null};
          const r = {col:p.col, id:p.id, data:clone(p.data), ...gen(p.data)}; rows.set(k, r); emit(old ? 'UPDATE' : 'INSERT', r); return {data:null, error:null};
        }
        if (q.op === 'delete') {
          const del = [...rows.values()].filter(r => q.filters.every(([c, op, v]) => OPS[op](colVal(r, c), v)));
          if (del.some(r => deny('delete', r.col))) return {data:null, error:rls('delete')};
          del.forEach(r => { rows.delete(r.col + '|' + r.id); emit('DELETE', null, r); }); return {data:null, error:null};
        }
      };
      const api = {
        select(){ return api; }, eq(c, v){ q.filters.push([c, 'eq', v]); return api; }, filter(c, op, v){ q.filters.push([c, op, v]); return api; },
        order(c, o){ q.order = [c, !o || o.ascending !== false]; return api; }, limit(n){ q.limit = n; return api; }, range(a, b){ q.range = [a, b]; return api; },
        upsert(p, o){ q.op = 'upsert'; q.payload = p; q.o = o || {}; return api; }, delete(){ q.op = 'delete'; return api; },
        then(res, rej){ return run().then(res, rej); }
      };
      return api;
    }
    const err = (code, message) => ({data:null, error:{code, message}});
    const need = (role) => { const w = who(); if (!w) return err('42501', 'forbidden'); if (role === 'admin' && w.role !== 'admin') return err('42501', 'forbidden'); return null; };
    async function rpc(name, a = {}) {
      state.calls.push('rpc:' + name);
      if (name === 'whoami') return {data:who(), error:null};
      let e = need(['set_admin_pin', 'set_cashier_code', 'delete_cashier_code'].includes(name) ? 'admin' : 'staff'); if (e) return e;
      if (name === 'doc_merge') {
        const k = a.p_col + '|' + a.p_id, r = rows.get(k);
        if (!r || deny('update', a.p_col)) return err('P0002', 'not_found');
        r.data = {...r.data, ...clone(a.p_patch)}; Object.assign(r, gen(r.data)); emit('UPDATE', r); return {data:null, error:null};
      }
      if (name === 'pin_status') return {data:!!state.pin, error:null};
      if (name === 'check_admin_pin') {
        if (state.attempts.pin >= 5) return err('P0001', 'locked');
        if (state.pin && a.p_pin === state.pin) { state.attempts.pin = 0; return {data:true, error:null}; }
        state.attempts.pin++; return {data:false, error:null};
      }
      if (name === 'set_admin_pin') { if (!/^\d{4,8}$/.test(a.p_pin)) return err('P0001', 'invalid_pin'); state.pin = a.p_pin; return {data:null, error:null}; }
      if (name === 'code_names') return {data:Object.keys(state.codes).sort(), error:null};
      if (name === 'verify_cashier_code') {
        if (state.attempts.code >= 5) return err('P0001', 'locked');
        const n = Object.keys(state.codes).find(k => state.codes[k] === a.p_code);
        if (n) { state.attempts.code = 0; return {data:n, error:null}; }
        state.attempts.code++; return {data:null, error:null};
      }
      if (name === 'set_cashier_code') {
        if (!/^\d{4,6}$/.test(a.p_code)) return err('P0001', 'invalid_code');
        if (Object.entries(state.codes).some(([k, v]) => k !== a.p_name && v === a.p_code)) return err('P0001', 'duplicate');
        state.codes[a.p_name] = a.p_code; return {data:null, error:null};
      }
      if (name === 'delete_cashier_code') { delete state.codes[a.p_name]; return {data:null, error:null}; }
      return err('42883', 'function not found: ' + name);
    }
    const authCbs = new Set();
    const auth = {
      async getSession(){ return {data:{session:state.session}, error:null}; },
      async signInWithPassword({email, password}){
        const u = users[email];
        if (!u || u.password !== password) return {data:{session:null}, error:{message:'Invalid login credentials'}};
        state.session = {email, user:{email}}; authCbs.forEach(cb => cb('SIGNED_IN', state.session)); return {data:{session:state.session}, error:null};
      },
      async signOut(){ state.session = null; authCbs.forEach(cb => cb('SIGNED_OUT', null)); return {error:null}; },
      onAuthStateChange(cb){ authCbs.add(cb); return {data:{subscription:{unsubscribe(){ authCbs.delete(cb); }}}}; }
    };
    const sb = {
      from:t => builder(t), rpc, auth,
      channel(name){
        const h = {name, evs:[], on(type, f, cb){ const m = /col=eq\.(.+)/.exec(f.filter || ''); h.evs.push({col:m && m[1], cb}); return h; },
          subscribe(cb){ h.evs.forEach(e => { e.l = e; listeners.add(e); }); if (cb) setTimeout(() => cb('SUBSCRIBED'), 0); return h; }};
        return h;
      },
      removeChannel(h){ h.evs.forEach(e => listeners.delete(e)); }
    };
    return {sb, rows, state, users,
      seed(col, id, data){ rows.set(col + '|' + id, {col, id, data:clone(data), ...gen(data)}); },
      get(col, id){ const r = rows.get(col + '|' + id); return r ? clone(r.data) : undefined; },
      all(col){ return [...rows.values()].filter(r => r.col === col).map(r => ({id:r.id, ...clone(r.data)})); }};
  }
  root.createFakeSupabase = createFake;
  if (typeof module !== 'undefined') module.exports = createFake;
})(typeof window !== 'undefined' ? window : globalThis);
