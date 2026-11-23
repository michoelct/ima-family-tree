/*
 * views.js — the extra ways of showing the family. Pure (numbers in, numbers out), like layout.js.
 *  - branchMap: which of the root's children's families everyone belongs to (for the branch colours);
 *  - layoutFamily: one person in the middle, their parents above, brothers and sisters, then children and
 *    grandchildren — wrapped to the width of the screen, so a phone reads it at full size;
 *  - layoutSun: the whole family as a circle — the root couple in the middle, each generation a ring further
 *    out, every family a slice of the circle, cards pointing outwards like the rays of the sun.
 * Both return the same shape as layoutTree (mode, nodes, lines, marriages, toggles, rows, unlinked, width,
 * height, opts) so the app draws them the same way. Extra fields: node.rot (degrees, sun), labels, line.cls.
 */
(function (root) {
  'use strict';

  const onTree = p => p && p.onTree !== false && p.kind !== 'friend';
  const byOrder = people => (a, b) => (people.get(a).order || 0) - (people.get(b).order || 0);

  /** id -> the root child whose family they are in (the root couple and unlinked people have none). */
  function branchMap(people, rootId) {
    const out = new Map();
    const rootP = people.get(rootId);
    if (!rootP) return out;
    const walk = (id, b, seen) => {
      if (seen.has(id) || !people.has(id)) return;
      seen.add(id);
      if (!out.has(id)) out.set(id, b);
      const p = people.get(id);
      if (p.spouse && people.has(p.spouse) && !out.has(p.spouse) && p.spouse !== rootId && p.spouse !== rootP.spouse) out.set(p.spouse, b);
      p.children.forEach(c => walk(c, b, seen));
      if (p.spouse && people.has(p.spouse)) people.get(p.spouse).children.forEach(c => walk(c, b, seen));
    };
    rootP.children.slice().sort(byOrder(people)).forEach(c => walk(c, c, new Set([rootId])));
    return out;
  }

  // ---------------------------------------------------------------- family view
  function layoutFamily(people, focusId, opts) {
    const o = Object.assign({ cardW: 150, cardH: 68, coupleGap: 10, gap: 14, rowGap: 16, sectionGap: 22, labelH: 22,
      padX: 12, padY: 14, padR: 12, maxW: 340, maxGrandkids: 30 }, opts || {});
    const P = id => people.get(id);
    const f = P(focusId);
    const nodes = [], marriages = [], lines = [], labels = [];
    if (!f) return { mode: 'family', focus: focusId, nodes, marriages, lines, toggles: [], rows: [], unlinked: [], labels, width: 0, height: 0, opts: o };
    const used = new Set();
    const pair = id => { // a person and their spouse, once each
      const m = [id]; used.add(id);
      const p = P(id);
      if (p.spouse && P(p.spouse) && onTree(P(p.spouse)) && !used.has(p.spouse)) { m.push(p.spouse); used.add(p.spouse); }
      return m;
    };
    const unitW = m => m.length * o.cardW + (m.length - 1) * o.coupleGap;
    const sections = [];
    const parents = f.parents.filter(id => P(id) && onTree(P(id)));
    // only one parent in the sheet: show their husband or wife beside them, as the family sees it
    if (parents.length === 1) { const sp = P(parents[0]).spouse; if (sp && P(sp) && onTree(P(sp)) && sp !== focusId) parents.push(sp); }
    if (parents.length) {
      parents.forEach(id => used.add(id));
      sections.push({ key: 'parents', title: parents.length > 1 ? 'Parents' : 'Parent', units: [parents] });
    }
    sections.push({ key: 'focus', title: null, units: [pair(focusId)] });
    const sibs = [];
    parents.forEach(pid => P(pid).children.forEach(c => { if (c !== focusId && !sibs.includes(c) && onTree(P(c))) sibs.push(c); }));
    sibs.sort(byOrder(people));
    const kids = [];
    [focusId, f.spouse].filter(Boolean).forEach(id => P(id) && P(id).children.forEach(c => { if (!kids.includes(c) && onTree(P(c))) kids.push(c); }));
    kids.sort(byOrder(people));
    if (kids.length) sections.push({ key: 'kids', title: kids.length > 1 ? 'Children' : 'Child', units: kids.filter(c => !used.has(c)).map(pair) });
    const gkids = [];
    kids.forEach(k => { const p = P(k); [k, p.spouse].filter(Boolean).forEach(id => P(id) && P(id).children.forEach(c => { if (!gkids.includes(c) && onTree(P(c))) gkids.push(c); })); });
    gkids.sort(byOrder(people));
    let moreGrand = 0;
    if (gkids.length && gkids.length <= o.maxGrandkids) sections.push({ key: 'gkids', title: 'Grandchildren', units: gkids.filter(c => !used.has(c)).map(pair) });
    else moreGrand = gkids.length;
    if (sibs.length) sections.push({ key: 'sibs', title: 'Brothers & sisters', units: sibs.filter(c => !used.has(c)).map(pair) });

    // wrap each section's units into rows no wider than maxW (a couple always stays together)
    const maxW = Math.max(o.maxW, o.cardW * 2 + o.coupleGap);
    let y = 0, width = 0;
    const placed = [];
    sections.forEach((s, si) => {
      if (si) y += o.sectionGap;
      if (s.title) { labels.push({ text: s.title, y, key: s.key }); y += o.labelH; }
      const rows = [];
      let cur = [], w = 0;
      s.units.forEach(u => {
        const uw = unitW(u);
        if (cur.length && w + o.gap + uw > maxW) { rows.push({ units: cur, w }); cur = []; w = 0; }
        w += (cur.length ? o.gap : 0) + uw; cur.push(u);
      });
      if (cur.length) rows.push({ units: cur, w });
      s.top = y;
      rows.forEach((r, ri) => {
        if (ri) y += o.rowGap;
        r.y = y; y += o.cardH;
        width = Math.max(width, r.w);
      });
      s.rows = rows; s.bottom = y;
      placed.push(s);
    });
    width = Math.max(width, maxW);
    placed.forEach(s => s.rows.forEach(r => {
      let x = (width - r.w) / 2;
      r.units.forEach(u => {
        u.forEach((id, i) => nodes.push({ id, x: x + i * (o.cardW + o.coupleGap), y: r.y, gen: P(id).gen, section: s.key, focus: id === focusId }));
        if (u.length === 2) marriages.push({ x1: x + o.cardW, x2: x + o.cardW + o.coupleGap, y: r.y + o.cardH / 2, a: u[0], b: u[1] });
        x += unitW(u) + o.gap;
      });
    }));
    labels.forEach(l => { l.x = width / 2; });
    // a line down the middle joins parents -> the person -> their children
    const sec = k => placed.find(s => s.key === k);
    const fs = sec('focus'), ps = sec('parents'), ks = sec('kids'), gs = sec('gkids');
    const mid = width / 2;
    if (ps) lines.push({ d: `M ${mid} ${ps.bottom} V ${fs.top}` });
    if (ks) lines.push({ d: `M ${mid} ${fs.bottom} V ${ks.top - o.labelH + 4}` });
    if (gs && ks) lines.push({ d: `M ${mid} ${ks.bottom} V ${gs.top - o.labelH + 4}` });
    return { mode: 'family', focus: focusId, moreGrand, nodes, marriages, lines, toggles: [], rows: [], unlinked: [], labels, width, height: y, opts: o };
  }

  // ---------------------------------------------------------------- sun view
  function layoutSun(people, rootId, opts) {
    const o = Object.assign({ cardW: 120, cardH: 44, slotGap: 6, ringGap: 50, bandW: 26, coreR: 110, padX: 30, padY: 30, padR: 30 }, opts || {});
    const P = id => people.get(id);
    const nodes = [], lines = [], marriages = [], labels = [];
    const rootP = P(rootId);
    if (!rootP) return { mode: 'sun', nodes, lines, marriages, toggles: [], rows: [], unlinked: [], labels, width: 0, height: 0, opts: o };
    const claimed = new Set();
    const unit = (id, depth) => {
      const p = P(id);
      const members = [id]; claimed.add(id);
      if (p.spouse && P(p.spouse) && onTree(P(p.spouse)) && !claimed.has(p.spouse)) { members.push(p.spouse); claimed.add(p.spouse); }
      const u = { members, depth, kids: [] };
      const kidIds = [];
      members.forEach(m => P(m).children.forEach(c => { if (!claimed.has(c) && !kidIds.includes(c) && onTree(P(c))) kidIds.push(c); }));
      kidIds.sort(byOrder(people)).forEach(c => { if (!claimed.has(c)) u.kids.push(unit(c, depth + 1)); });
      u.weight = Math.max(members.length, u.kids.reduce((s, k) => s + k.weight, 0));
      return u;
    };
    const top = unit(rootId, 0);
    // brothers whose children carry the same family name sit side by side, so each ring shows that family as one
    // block (married sisters' children carry their husband's name and form their own block); otherwise the order is kept
    if (typeof o.familyName === 'function') (function group(u) {
      if (u.kids.length > 1) {
        const key = k => String(o.familyName(k.kids.length ? k.kids.map(c => c.members[0]) : k.members) || '').toLowerCase();
        const firstAt = new Map();
        u.kids.forEach((k, i) => { const n = key(k); k._g = n; if (!firstAt.has(n)) firstAt.set(n, i); });
        u.kids = u.kids.map((k, i) => ({ k, i })).sort((a, b) => firstAt.get(a.k._g) - firstAt.get(b.k._g) || a.i - b.i).map(x => x.k);
      }
      u.kids.forEach(group);
    })(top);
    // the chosen family sits at the top of the circle
    if (o.centerChild) {
      const i = top.kids.findIndex(k => k.members[0] === o.centerChild);
      if (i > 0) top.kids = top.kids.slice(i).concat(top.kids.slice(0, i));
    }
    const slot = o.cardH + o.slotGap;
    // Ring sizes: start from the smallest rings that fit a card's length, work out the angle each family needs
    // there (its own cards, or all its descendants' further out — whichever is more), then grow every ring by
    // the same factor until the whole circle fits. Small families near the middle no longer push the rings out.
    const maxDepth = (function md(u) { return Math.max(u.depth, ...u.kids.map(md)); })(top);
    const base = [0];
    for (let d = 1; d <= maxDepth; d++) base[d] = o.coreR + (d - 1) * (o.cardW + o.ringGap);
    const need = u => { u.need = Math.max(u.depth ? u.members.length * slot / base[u.depth] : 0, u.kids.reduce((s, k) => s + need(k), 0)); return u.need; };
    const T = top.kids.reduce((s, k) => s + need(k), 0) || 1;
    const grow = Math.max(1, T / (Math.PI * 2));
    const r = base.map(b => b * grow);
    const units = [];
    const collect = (u, a0, a1) => {
      units.push(Object.assign(u, { a0, a1 }));
      const tot = u.kids.reduce((s, k) => s + k.need, 0) || 1;
      let a = a0;
      u.kids.forEach(k => { const a2 = a + (a1 - a0) * k.need / tot; collect(k, a, a2); a = a2; });
    };
    // the first (chosen) family is centred at the top of the circle
    const firstShare = top.kids.length ? top.kids[0].need / T * Math.PI * 2 : 0;
    collect(top, -Math.PI / 2 - firstShare / 2, -Math.PI / 2 - firstShare / 2 + Math.PI * 2);
    const R = r[maxDepth] + o.cardW + o.ringGap;
    const cx = R, cy = R;
    // the root couple in the middle, one above the other
    top.members.forEach((id, i) => {
      const w = 150, h = 60, n = top.members.length;
      nodes.push({ id, x: cx - w / 2, y: cy - (n * h + (n - 1) * 8) / 2 + i * (h + 8), gen: P(id).gen, w, h, core: true });
    });
    const arc = (r0, r1, a0, a1) => {
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rr, a) => (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
      return `M ${p(r0, a0)} L ${p(r1, a0)} A ${r1} ${r1} 0 ${big} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${big} 0 ${p(r0, a0)} Z`;
    };
    units.forEach(u => {
      if (!u.depth) return;
      const r0 = r[u.depth] - o.ringGap / 2, r1 = r[u.depth] + o.cardW + o.ringGap / 2;
      lines.push({ d: arc(r0, r1, u.a0, u.a1), cls: 'sun-slice', branch: u.branch || null, member: u.members[0], depth: u.depth });
      const mid = (u.a0 + u.a1) / 2, rc = r[u.depth] + o.cardW / 2;
      const n = u.members.length;
      // a couple turns the same way: the side of the circle is decided once, by the middle of their slice
      // (deciding it per card turned the two cards at the top of the circle in opposite directions)
      const flip = Math.cos(mid) < -1e-9;
      u.members.forEach((id, i) => {
        const a = mid + (i - (n - 1) / 2) * slot / r[u.depth];
        const deg = a * 180 / Math.PI;
        nodes.push({ id, x: cx + rc * Math.cos(a) - o.cardW / 2, y: cy + rc * Math.sin(a) - o.cardH / 2, gen: P(id).gen, rot: flip ? deg + 180 : deg, depth: u.depth });
      });
    });
    // a faint line from every parent to each of their children, and a thin border round the children of one
    // couple, so a grandchild's children can be told apart from their cousins with the same family name
    const pt = (rr, a) => (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1);
    units.forEach(u => {
      if (!u.kids.length) return;
      const pm = (u.a0 + u.a1) / 2;
      const from = u.depth ? r[u.depth] + o.cardW : Math.min(r[1] * 0.55, r[1] - o.ringGap);
      u.kids.forEach(k => {
        const km = (k.a0 + k.a1) / 2, to = r[k.depth] - 2;
        lines.push({ d: `M ${pt(from, pm)} L ${pt(to, km)}`, cls: 'sun-link', member: k.members[0], depth: k.depth });
      });
      if (u.depth) {
        const d1 = u.depth + 1, gap = 0.002;
        const rOut = r[d1] + o.cardW + o.ringGap / 2 - 3;
        lines.push({ d: arc(r[d1] - o.ringGap / 2 + 3, rOut, u.a0 + gap, u.a1 - gap), cls: 'sun-group', member: u.members[0], depth: u.depth, group: true });
        // a thin header strip along the outer edge of the brothers and sisters, with their family name
        const rIn = rOut - o.bandW;
        lines.push({ d: arc(rIn, rOut, u.a0 + gap, u.a1 - gap), cls: 'sun-band', member: u.members[0], depth: u.depth, group: true });
        const name = o.familyName ? o.familyName(u.kids.map(k => k.members[0])) : '';
        if (name) {
          // text runs along the middle of the strip, always left to right: clockwise over the top half,
          // anticlockwise under the bottom half (so it is never upside down)
          const rt = (rIn + rOut) / 2, mid = (u.a0 + u.a1) / 2, len = (u.a1 - u.a0) * rt;
          const under = Math.sin(mid) > 0;
          const big = u.a1 - u.a0 > Math.PI ? 1 : 0;
          const tr = under ? rt + 6 : rt - 6; // the baseline sits so the letters are centred in the strip
          const d = under ? `M ${pt(tr, u.a1 - gap)} A ${tr} ${tr} 0 ${big} 0 ${pt(tr, u.a0 + gap)}`
            : `M ${pt(tr, u.a0 + gap)} A ${tr} ${tr} 0 ${big} 1 ${pt(tr, u.a1 - gap)}`;
          labels.push({ arc: d, text: name, fits: len > name.length * 12.5 + 14, member: u.members[0], depth: u.depth });
        }
      }
    });
    // every slice gets its branch (the root child it grows from)
    // ...and a shade: each of the root's grandchildren's families gets its own shade of the branch colour,
    // which their children and grandchildren keep (brothers and sisters always share their parents' shade)
    const tag = (u, b, sh) => {
      u.kids.forEach((k, i) => {
        const bb = u.depth === 0 ? k.members[0] : b;
        const ks = k.depth === 2 ? i : sh;
        lines.concat(labels).forEach(l => { if (l.member === k.members[0] && l.depth === k.depth) { l.branch = bb; l.shade = ks; } });
        tag(k, bb, ks);
      });
    };
    tag(top, null, 0);
    const out = people.size ? [...people.values()].filter(p => onTree(p) && !claimed.has(p.id)).map(p => p.id) : [];
    return { mode: 'sun', nodes, lines, marriages, toggles: [], rows: [], unlinked: [], notShown: out, labels, width: 2 * R, height: 2 * R, opts: o };
  }

  const api = { branchMap, layoutFamily, layoutSun };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FT = Object.assign(root.FT || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
