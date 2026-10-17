// Chem engine: port of SS14 ChemicalReactionSystem (Funky Station) + batch planner.
// Every reagent has SpecificHeat 1.0 in Funky's prototypes, so heat capacity == volume.
(function (root) {
  const ROOM = 293.15;
  const MAX_ITER = 20;
  const r2 = x => Math.round(x * 100) / 100;
  const BAD_EVENTS = ['ExplosionReactionEffect', 'AreaReactionEffect', 'EmpReactionEffect'];

  function makeEngine(DATA) {
    const RX = DATA.reactions;
    const RG = DATA.reagents;
    const DISP = new Set(DATA.dispenser);
    // Raw inputs that are easy to get without a reaction (sink, plasma sheet in the grinder, blood bag)
    const EASY = new Set(['Water', 'Plasma', 'Blood']);
    const byProduct = {}, byFirst = {}, byAny = {}, byId = {};
    RX.forEach(x => {
      byId[x.id] = x;
      x._keys = Object.keys(x.r);
      x._npc = Object.keys(x.p).length;
      x._events = (x.fx || []).map(f => f.__type);
      Object.keys(x.p).forEach(p => (byProduct[p] = byProduct[p] || []).push(x));
      (byFirst[x._keys[0]] = byFirst[x._keys[0]] || []).push(x);
      x._keys.forEach(k => (byAny[k] = byAny[k] || []).push(x));
    });
    // Same ordering as ReactionPrototype.CompareTo
    const cmp = (a, b) => (a.pri !== b.pri ? b.pri - a.pri : a._npc !== b._npc ? a._npc - b._npc : (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // ---------- Solution simulation ----------
    const newSol = () => ({ q: {}, T: ROOM, log: [], peak: 0 });
    const vol = s => Object.values(s.q).reduce((a, b) => a + b, 0);
    const cleanup = s => { for (const k in s.q) if (s.q[k] < 0.005) delete s.q[k]; };
    function canReact(s, x, mixer) {
      if (s.T < x.minT) return 0;
      if (x.maxT != null && s.T > x.maxT) return 0;
      if (x.mix && (!mixer || x.mix.some(m => !mixer.includes(m)))) return 0;
      let low = Infinity;
      for (const k of x._keys) {
        const [amt, cat] = x.r[k]; const have = s.q[k] || 0;
        if (have <= 0) return 0;
        if (cat) { if (x.q && have < amt) return 0; continue; }
        low = Math.min(low, have / amt);
      }
      if (low === Infinity) return 0;
      low = Math.floor(low * 100 + 1e-6) / 100;
      if (x.q) low = Math.floor(low + 1e-9);
      return low > 0 ? low : 0;
    }
    function perform(s, x, u) {
      const energy = x.ce ? vol(s) * s.T : 0;
      for (const k of x._keys) { const [amt, cat] = x.r[k]; if (!cat) s.q[k] = r2((s.q[k] || 0) - u * amt); }
      for (const p in x.p) s.q[p] = r2((s.q[p] || 0) + x.p[p] * u);
      cleanup(s);
      const before = s.T;
      if (x.ce) { const cap = vol(s); if (cap > 0) s.T = energy / cap; }
      s.log.push({ rx: x.id, u, Tbefore: before, Tafter: s.T, events: x._events.slice() });
      return Object.keys(x.p);
    }
    function fullyReact(s, mixer) {
      const set = new Map();
      const addAll = arr => (arr || []).forEach(x => set.set(x.id, x));
      Object.keys(s.q).forEach(k => addAll(byFirst[k]));
      for (let i = 0; i < MAX_ITER; i++) {
        const sorted = [...set.values()].sort(cmp);
        let did = null;
        for (const x of sorted) { const u = canReact(s, x, mixer); if (u > 0) { did = perform(s, x, u); break; } }
        if (!did) return true;
        did.forEach(p => addAll(byAny[p]));
      }
      s.log.push({ warn: 'Did not settle within 20 reaction loops' });
      return false;
    }
    function addMix(s, contents, T) {
      const addV = Object.values(contents).reduce((a, b) => a + b, 0);
      const cap = vol(s);
      s.T = (cap + addV) > 0 ? (cap * s.T + addV * T) / (cap + addV) : ROOM;
      for (const k in contents) s.q[k] = r2((s.q[k] || 0) + contents[k]);
      s.peak = Math.max(s.peak, vol(s));
      fullyReact(s, null);
      s.peak = Math.max(s.peak, vol(s)); // reactions that grow the volume can overflow too
    }
    function heatTo(s, target) {
      // hotplate: raise gradually so heat-gated side reactions fire in the right order
      while (s.T < target) { s.T = Math.min(target, s.T + 5); fullyReact(s, null); s.peak = Math.max(s.peak, vol(s)); }
    }

    // ---------- Recipe choice ----------
    const isLeaf = id => DISP.has(id) || EASY.has(id);
    const cost = {};
    function rxCost(x, prod) {
      if (x._keys.includes(prod)) return Infinity;
      if (x._events.some(e => BAD_EVENTS.includes(e))) return Infinity;
      let c = 1 + (x.mix ? 40 : 0) + (x._npc > 1 ? 4 : 0) + (x.minT > ROOM ? 1 : 0);
      for (const k of x._keys) c += (cost[k] == null ? 60 : cost[k]) * (x.r[k][1] ? 0.5 : 1);
      return c;
    }
    Object.keys(RG).forEach(id => cost[id] = isLeaf(id) ? 0 : 60);
    for (let it = 0; it < 40; it++) {
      let changed = false;
      for (const id in byProduct) {
        if (isLeaf(id)) continue;
        for (const x of byProduct[id]) { const c = rxCost(x, id); if (c < cost[id] - 1e-9) { cost[id] = c; changed = true; } }
      }
      if (!changed) break;
    }
    function recipesFor(id) {
      return (byProduct[id] || []).filter(x => !x._keys.includes(id) && !x._events.some(e => BAD_EVENTS.includes(e)))
        .sort((a, b) => rxCost(a, id) - rxCost(b, id));
    }
    // Default: never auto-pick a mixer-only recipe (centrifuge breakdowns etc.); the user can still choose one.
    function bestRecipe(id) { return recipesFor(id).find(x => !x.mix) || null; }
    const makeable = id => !!(byProduct[id] || []).length;

    // Smallest scale >= k that keeps every dispensed amount a whole number of units.
    function roundK(x, k) {
      const coefs = x._keys.filter(r => !x.r[r][1]).map(r => x.r[r][0]);
      if (coefs.every(c => Math.abs(c - Math.round(c)) < 1e-9)) return Math.ceil(k - 1e-9);
      for (const d of [1, 2, 4, 5, 10]) {
        const kr = Math.ceil(k * d - 1e-9) / d;
        if (coefs.every(c => Math.abs(c * kr - Math.round(c * kr)) < 1e-6) && kr <= k * 1.15 + 1) return kr;
      }
      return k; // per-reagent ceil happens at dispense time
    }

    // ---------- Planning ----------
    // opts: { targets:[{id,amt}], choice:{id:rxId|'raw'}, have:Set, heat:'flash'|'hotplate', margin:K, round:bool, combine:bool }
    function plan(opts) {
      const choice = opts.choice || {}, have = new Set(opts.have || []);
      const margin = opts.margin == null ? 10 : opts.margin;
      const doRound = opts.round !== false, combine = opts.combine !== false;
      const targetSet = new Set(opts.targets.map(t => t.id));
      const recipeOf = id => {
        if (have.has(id) || choice[id] === 'raw') return null;
        if (choice[id] && byId[choice[id]]) return byId[choice[id]];
        if (isLeaf(id)) return null;
        return bestRecipe(id);
      };
      const deps = {}, visiting = new Set(), order = [], warnings = [];
      (function () {
        function visit(id) {
          if (deps[id] !== undefined) return;
          if (visiting.has(id)) { warnings.push('Recipe loop through ' + nm(id) + '; it is treated as something you bring in.'); deps[id] = null; return; }
          visiting.add(id);
          const x = recipeOf(id);
          deps[id] = x;
          if (x) x._keys.forEach(visit);
          visiting.delete(id);
          order.push(id);
        }
        opts.targets.forEach(t => visit(t.id));
      })();
      // demand propagation, consumers first
      const demand = {}, uses = {}, scale = {};
      opts.targets.forEach(t => { demand[t.id] = (demand[t.id] || 0) + t.amt; (uses[t.id] = uses[t.id] || []).push({ to: null, amt: t.amt }); });
      for (let i = order.length - 1; i >= 0; i--) {
        const id = order[i], x = deps[id];
        if (!x || !demand[id]) continue;
        let k = demand[id] / x.p[id];
        if (doRound) k = roundK(x, k);
        scale[id] = k;
        for (const r of x._keys) {
          const [amt, cat] = x.r[r];
          let need = cat ? (x.q ? amt : Math.min(amt, 5) || 1) : amt * k;
          if (doRound) need = Math.ceil(need - 1e-6);
          need = r2(need);
          demand[r] = r2((demand[r] || 0) + need);
          (uses[r] = uses[r] || []).push({ to: id, amt: need, cat });
        }
      }
      // build batches bottom-up
      let batches = [];
      const batchOf = {};
      order.forEach(id => {
        const x = deps[id];
        if (!x || !demand[id]) return;
        const b = buildBatch(id, x, scale[id], uses, batchOf, opts.heat || 'flash', margin, doRound);
        batchOf[id] = b; batches.push(b);
      });
      // combine single-use, no-heat, no-mixer intermediates into their consumer's container when the sim stays clean
      if (combine) {
        for (const b of batches) {
          for (let pass = 0; pass < 4; pass++) {
            let changed = false;
            for (const it of b.order) {
              if (it.from == null || it.macro) continue;
              const c = it.from;
              const cu = uses[c.product] || [];
              if (cu.length !== 1 || targetSet.has(c.product) || c.heat || c.rx.mix || c.inlinedInto) continue;
              if (Math.abs(it.amt - c.yield) > 0.01) continue;
              const trial = b.items.map(i => i === it.srcItem ? { macro: true, product: c.product, from: c, seq: c.order, amt: it.amt } : i);
              const res = solveBatch(b, trial, margin);
              if (res && res.ok && res.side.length <= b.side.length && res.yield >= b.yield - 0.01) {
                Object.assign(b, res); b.items = trial; c.inlinedInto = b; changed = true; break;
              }
            }
            if (!changed) break;
          }
        }
        batches = batches.filter(b => !b.inlinedInto);
      }
      batches.forEach((b, i) => b.index = i + 1);
      // totals from what is actually poured
      const raw = {}, external = {};
      batches.forEach(b => flatten(b.order).forEach(a => {
        if (a.from) return;
        const bucket = DISP.has(a.id) ? raw : external;
        bucket[a.id] = r2((bucket[a.id] || 0) + a.amt);
      }));
      const surplus = {};
      batches.forEach(b => {
        const used = (uses[b.product] || []).reduce((s, u) => s + u.amt, 0);
        if (b.yield - used > 0.05) surplus[b.product] = r2(b.yield - used);
      });
      return { targets: opts.targets, batches, raw, external, surplus, uses, deps, warnings };
    }

    function flatten(seq) {
      const out = [];
      (seq || []).forEach(it => { if (it.macro) out.push(...flatten(it.seq)); else out.push(it); });
      return out;
    }

    function buildBatch(id, x, k, uses, batchOf, heatMode, margin, doRound) {
      const items = x._keys.map(r => {
        const [amt, cat] = x.r[r];
        let need = cat ? (x.q ? amt : Math.min(amt, 5) || 1) : amt * k;
        if (doRound) need = Math.ceil(need - 1e-6);
        need = r2(need);
        const src = batchOf[r];
        return { id: r, amt: need, cat, from: src || null };
      });
      items.forEach(i => i.srcItem = i);
      const b = { product: id, rx: x, scale: k, target: r2(x.p[id] * k), items, heatMode, notes: [] };
      Object.assign(b, solveBatch(b, items, margin));
      b.uses = (uses[id] || []).map(u => ({ to: u.to, amt: u.amt, cat: u.cat }));
      return b;
    }

    // Find an add order (and heat plan) for a batch. Returns result fields to merge into the batch.
    function solveBatch(b, items, margin) {
      const x = b.rx, prod = b.product, amount = b.target;
      const needsHeat = x.minT > ROOM + 0.01;
      const flashBlocked = ['Aluminium', 'Sulfur', 'Potassium'].some(e => x._keys.includes(e));
      const notes = [];
      let best;
      if (!needsHeat) best = searchOrder(items, null, x.mix, prod, amount);
      else if (b.heatMode === 'flash' && !flashBlocked) {
        best = searchFlash(items, x.minT + margin, x.mix, prod, amount);
        if (!best || !best.ok) {
          const hb = searchOrder(items, x.minT + margin, x.mix, prod, amount);
          if (hb && (!best || hb.score > best.score)) { best = hb; notes.push('Flash heating could not be made to work cleanly here, so this step uses a hotplate.'); }
        }
      } else {
        best = searchOrder(items, x.minT + margin, x.mix, prod, amount);
        if (flashBlocked && b.heatMode === 'flash') notes.push('This recipe uses aluminium, sulfur or potassium itself, so a flash would eat the reactants. Use a hotplate.');
      }
      if (!best) return null;
      const s = best.sol;
      const yieldAmt = r2(s.q[prod] || 0);
      if (yieldAmt < amount * 0.98) notes.push(`Simulated yield is ${yieldAmt}u of the ${amount}u planned. Try the other heat method or check the order.`);
      if (s.peak > 1000) notes.push('Peak volume is over 1000u. Split this into several batches.');
      const ownIds = new Set((byProduct[prod] || []).map(r => r.id));
      return {
        order: best.order, ok: best.ok, heat: best.heat, flash: best.flash,
        sol: s, finalT: s.T, finalVol: r2(vol(s)), peak: r2(s.peak), container: pickContainer(s.peak),
        yield: yieldAmt,
        leftover: Object.entries(s.q).filter(([k]) => k !== prod).map(([k, v]) => ({ id: k, amt: v })),
        events: s.log.flatMap(l => (l.events || []).map(e => ({ e, rx: l.rx }))),
        side: s.log.filter(l => l.rx && l.rx !== 'Flash' && !ownIds.has(l.rx) && !isInlinedRx(best.order, l.rx)).map(l => l.rx),
        notes: (b.notesBase || []).concat(notes),
      };
    }
    function isInlinedRx(order, rxId) {
      return flatten(order).length !== (order || []).length && (order || []).some(it => it.macro && macroRxIds(it).has(rxId));
    }
    function macroRxIds(it) {
      const s = new Set([it.from.rx.id]);
      (it.seq || []).forEach(c => { if (c.macro) macroRxIds(c).forEach(v => s.add(v)); });
      return s;
    }

    function pickContainer(v) {
      const c = Object.entries(DATA.containers).sort((a, b) => a[1] - b[1]).find(([, cap]) => cap >= v - 1e-6);
      return c ? { name: c[0], cap: c[1] } : { name: 'Split batch', cap: v };
    }
    function* perms(arr) {
      if (arr.length <= 1) { yield arr.slice(); return; }
      for (let i = 0; i < arr.length; i++) {
        const rest = arr.slice(0, i).concat(arr.slice(i + 1));
        for (const p of perms(rest)) yield [arr[i]].concat(p);
      }
    }
    function pour(s, it) {
      if (it.macro) { it.seq.forEach(c => pour(s, c)); return; }
      // intermediates are moved as the pure product (ChemMaster pull), at the temperature their batch ended at
      const T = it.from ? it.from.finalT : ROOM;
      addMix(s, { [it.id]: it.amt }, T);
    }
    function scaleSol(b, amt) {
      // transferring amt units out of batch b's finished container takes a proportional slice of everything in it
      const tot = vol(b.sol); const f = tot > 0 ? Math.min(1, amt / tot) : 0;
      const out = {}; for (const k in b.sol.q) out[k] = r2(b.sol.q[k] * f);
      return out;
    }
    const budget = { n: 0 };
    const sideSize = l => { const x = byId[l.rx]; return x ? l.u * x._keys.reduce((a, k) => a + (x.r[k][1] ? 0 : x.r[k][0]), 0) : 1; };
    function evalSeq(seq, heatTarget, mixer, prod, amount) {
      const s = newSol();
      for (const it of seq) pour(s, it);
      if (heatTarget) heatTo(s, Math.ceil(heatTarget));
      if (mixer) { fullyReact(s, mixer); s.peak = Math.max(s.peak, vol(s)); }
      const y = s.q[prod] || 0;
      const ownIds = new Set((byProduct[prod] || []).map(r => r.id));
      const allowed = new Set(); seq.forEach(it => { if (it.macro) macroRxIds(it).forEach(v => allowed.add(v)); });
      const side = s.log.filter(l => l.rx && l.rx !== 'Flash' && !ownIds.has(l.rx) && !allowed.has(l.rx) && sideSize(l) >= 0.5).length;
      budget.n++;
      const bad = s.log.some(l => (l.events || []).some(e => BAD_EVENTS.includes(e)));
      const ok = y >= amount * 0.98 && !bad && side === 0;
      const score = Math.min(y / amount, 1) * 100 - side * 5 - (bad ? 200 : 0);
      return { sol: s, ok, score };
    }
    const seedOrder = items => items.slice().sort((a, b) => ((b.from || b.macro) ? 1 : 0) - ((a.from || a.macro) ? 1 : 0));
    function searchOrder(items, heatTarget, mixer, prod, amount) {
      const seed = seedOrder(items);
      let best = null;
      const consider = seq => { const r = evalSeq(seq, heatTarget, mixer, prod, amount); if (!best || r.score > best.score + 1e-9) best = { ...r, order: seq }; };
      consider(seed);
      if (!(best.ok && best.score >= 100) && items.length <= 7) {
        const stop = budget.n + 2500;
        for (const p of perms(seed)) { consider(p); if ((best.ok && best.score >= 100) || budget.n > stop) break; }
      }
      return { ...best, heat: heatTarget ? { mode: 'hotplate', to: Math.ceil(heatTarget) } : null, flash: null };
    }
    function searchFlash(items, heatTarget, mixer, prod, amount) {
      const seed = seedOrder(items);
      const baseVol = items.reduce((a, i) => a + i.amt, 0);
      const fMin = Math.max(1, Math.ceil(baseVol * (heatTarget / ROOM - 1) / 3));
      let best = null;
      const mk = (id, f) => ({ id, amt: f, flash: true });
      const stop = budget.n + 3000;
      const tryF = (f, wide) => {
        const trio = ['Potassium', 'Sulfur', 'Aluminium'];
        const seqs = [];
        for (const trig of trio) {
          const pre = trio.filter(t => t !== trig).map(t => mk(t, f)), last = mk(trig, f);
          seqs.push(seed.concat(pre, [last]));
          if (wide && seed.length <= 4) for (const p of perms(seed.concat(pre))) seqs.push(p.concat([last]));
        }
        for (const seq of seqs) {
          const r = evalSeq(seq, null, mixer, prod, amount);
          const flashT = (r.sol.log.find(l => l.rx === 'Flash') || {}).Tafter || 0;
          const hot = flashT >= heatTarget;
          const sc = r.score - (hot ? 0 : 1);
          if (!best || sc > best.sc + 1e-9) best = { ...r, sc, order: seq, f, flashT };
          if (r.ok && hot) return true;
          if (budget.n > stop) return false;
        }
        return false;
      };
      // flash charge: f >= V*(T/T0 - 1)/3, nudged up if earlier reactions in the batch cooled it
      let done = false;
      for (let f = fMin; f <= fMin + 12 && !done; f++) done = tryF(f, false);
      for (let f = fMin; f <= fMin + 4 && !done && budget.n < stop; f++) done = tryF(f, true);
      if (!best) return null;
      return { ...best, heat: { mode: 'flash', f: best.f, to: Math.round(best.flashT) },
        flash: ['Aluminium', 'Sulfur', 'Potassium'].map(id => ({ id, amt: best.f })) };
    }

    function nm(id) { const r = RG[id]; const n = r ? r.n : id; return n.replace(/(^|\s|-)\w/g, c => c.toUpperCase()); }

    // ---------- Free-form beaker sandbox ----------
    function sandbox(steps) {
      // steps: [{id, amt}] or [{heat:K}] or [{mix:[cats]}]
      const s = newSol(); const trace = [];
      for (const st of steps) {
        const n0 = s.log.length;
        if (st.heat) heatTo(s, st.heat);
        else if (st.mix) fullyReact(s, st.mix);
        else addMix(s, { [st.id]: st.amt }, ROOM);
        trace.push({ step: st, T: s.T, q: Object.assign({}, s.q), rx: s.log.slice(n0) });
      }
      return { sol: s, trace };
    }

    // Largest order of `id` whose own batch (peak volume, flash charge included) fits in `cap` units.
    function maxFill(id, cap, opts) {
      const x = bestRecipeFor(id, opts);
      if (!x) return null;
      const step = x.p[id];
      const fits = amt => {
        const p = plan(Object.assign({}, opts, { targets: [{ id, amt }] }));
        const b = p.batches.find(z => z.product === id);
        return b && b.peak <= cap + 1e-6 && b.yield >= amt - 0.01;
      };
      let lo = 0, hi = Math.ceil(cap * 2 / step) + 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fits(mid * step)) lo = mid; else hi = mid; }
      return lo ? r2(lo * step) : null;
    }
    function bestRecipeFor(id, opts) {
      const ch = (opts && opts.choice) || {};
      if (ch[id] && byId[ch[id]]) return byId[ch[id]];
      return bestRecipe(id);
    }
    // Reactions that would fire if two or more of these chemicals meet (same container, patch or patient).
    function clashes(ids) {
      const set = new Set(ids), out = [], seen = new Set();
      ids.forEach(id => (byAny[id] || []).forEach(x => {
        if (seen.has(x.id)) return;
        const inSet = x._keys.filter(k => set.has(k));
        if (inSet.length >= 2 && x._keys.every(k => set.has(k) || x.r[k][1]) ) { seen.add(x.id); out.push({ rx: x, ids: inSet }); }
      }));
      return out;
    }

    // A jug that holds several finished medicines at fixed ratios, drawn off in shots.
    // parts: [{id, n}] (n = ratio weight), total: units in the container, shot: units per syringe/hypospray shot.
    // Overdose (OD) starts at >= the reagent's threshold, so a chemical is safe while (units delivered) < threshold.
    // Metabolism between shots is ignored: "safe shots" is the worst case before you re-check the patient.
    function mixPlan(parts, total, shot) {
      const list = (parts || []).filter(p => RG[p.id] && p.n > 0);
      total = Math.round(total); shot = +shot;
      if (!list.length || !(total > 0)) return null;
      const W = list.reduce((a, p) => a + p.n, 0);
      const raw = list.map(p => p.n / W * total), base = raw.map(Math.floor);
      let left = total - base.reduce((a, b) => a + b, 0);
      raw.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { base[i]++; left--; } });
      const letters = id => nm(id).replace(/[^A-Za-z]/g, '').toUpperCase();
      let L = 3; const ab = list.map(p => letters(p.id));
      while (L < 12 && new Set(ab.map(x => x.slice(0, L))).size < ab.length) L++;
      const rows = list.map((p, i) => {
        const share = p.n / W, perShot = shot * share, thr = RG[p.id].thr || null;
        const shots = thr && perShot > 0 ? Math.max(0, Math.ceil(thr / perShot - 1e-9) - 1) : null;
        return { id: p.id, n: p.n, share, amt: base[i], perShot, thr, shots, odShot: thr ? thr / share : null, abbr: ab[i].slice(0, L) };
      });
      const lim = rows.filter(r => r.thr);
      const safeShots = lim.length ? Math.min(...lim.map(r => r.shots)) : null;
      const first = lim.length ? lim.reduce((m, r) => (r.shots < m.shots || (r.shots === m.shots && r.thr < m.thr)) ? r : m) : null;
      const singleOD = lim.length ? Math.min(...lim.map(r => r.odShot)) : null;
      const jugShots = shot > 0 ? Math.floor(total / shot) : 0;
      const ids = rows.map(r => r.id);
      return { rows, total, shot, safeShots, limiting: first && first.id, singleOD, jugShots, clashes: clashes(ids), minThr: lim.length ? lim.reduce((m, r) => r.thr < m.thr ? r : m) : null };
    }

    return { plan, sandbox, maxFill, clashes, mixPlan, recipesFor, bestRecipe, makeable, nm, isLeaf, flatten, byProduct, byAny, byId, RX, RG, DISP, EASY, ROOM, rxCost };
  }
  root.makeEngine = makeEngine;
  if (typeof module !== 'undefined') module.exports = { makeEngine };
})(typeof window !== 'undefined' ? window : globalThis);
