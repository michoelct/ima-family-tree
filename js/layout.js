/*
 * layout.js — places every card of the tree. Pure (numbers in, numbers out).
 * A "unit" is a person plus their spouse; the unit's children sit underneath.
 *
 * The tree is a chart at the top and an indented family list from generation `split` down:
 *  - units ABOVE `split` are laid out as a chart: generations are rows, children centred under their parents;
 *    children with no family of their own are stacked in a column so the chart grows down, not sideways;
 *  - a unit AT or below `split` becomes a block: an indented list (each generation one notch to the right,
 *    read top to bottom). Blocks sit side by side under their parents like the columns of a chart.
 * split <= the root's generation  -> the whole tree is one indented list (a phone held upright);
 * split  > the deepest generation -> the classic chart. The app picks the split that suits the screen, so the
 * view keeps working however large the family grows.
 * opts.centerChild = the id of one of the root's children whose family should sit in the middle of the chart:
 * it is moved to the place among its brothers and sisters that leaves the other families as evenly as possible
 * on either side (the others keep their order).
 * Any family can be closed (opts.collapsed = Set of the descendant's id): its children are hidden and it gets a
 * "+N" toggle with the number of people inside.
 */
(function (root) {
  'use strict';

  const DEFAULTS = {
    cardW: 140, cardH: 68, coupleGap: 10,
    siblingGap: 14, branchGap: 26, rowGap: 64, treeGap: 60, stackGap: 10, stackIndent: 20, // chart part
    indent: 24, vGap: 14,                                                                   // list part
    padX: 110, padY: 36, padR: 40
  };

  function layoutTree(people, rootId, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const P = id => people.get(id);
    const rootGen = rootId && people.has(rootId) ? (P(rootId).gen || 1) : 1;
    const split = o.split == null ? 99 : o.split;
    const allList = split <= rootGen;
    if (allList) Object.assign(o, { padX: 10, padY: 14, padR: 12, treeGap: 34 }, opts && opts.pad ? opts.pad : {});
    const collapsed = o.collapsed instanceof Set ? o.collapsed : new Set(o.collapsed || []);
    const claimed = new Set();
    const nodes = [], marriages = [], lines = [], toggles = [];
    const rowH = {};
    const rowY = gen => { let y = 0; for (let g = rootGen; g < gen; g++) y += (rowH[g] || o.cardH) + o.rowGap; return y; };

    function makeUnit(id) {
      const p = P(id);
      const members = [id];
      if (p.spouse && !claimed.has(p.spouse) && P(p.spouse) && P(p.spouse).onTree !== false) members.push(p.spouse);
      members.forEach(m => claimed.add(m));
      return { members, kids: [], stepKids: [] };
    }
    const countUnits = list => list.reduce((s, k) => s + k.members.length + countUnits(k.kids) + countUnits(k.stepKids), 0);

    function build(id, gen) {
      const u = makeUnit(id);
      u.gen = gen;
      const head = P(u.members[0]);
      // children hang from the descendant (the unit's first card); a partner's own children are not drawn here
      const sources = head.blood || u.members.length === 1 ? [u.members[0]] : u.members;
      const kidIds = [];
      sources.forEach(m => P(m).children.forEach(c => { if (!claimed.has(c) && !kidIds.includes(c) && P(c).onTree !== false) kidIds.push(c); }));
      kidIds.sort((a, b) => P(a).order - P(b).order);
      kidIds.forEach(c => { if (!claimed.has(c)) u.kids.push(build(c, gen + 1)); });
      // the partner's own children (step-family) come after them, from the partner's card
      if (head.blood && u.members.length === 2) {
        P(u.members[1]).children.filter(c => !claimed.has(c) && P(c).onTree !== false)
          .sort((a, b) => P(a).order - P(b).order)
          .forEach(c => { if (!claimed.has(c)) u.stepKids.push(build(c, gen + 1)); });
      }
      if (gen === rootGen && o.centerChild) centreChild(u, o.centerChild);
      u.hasKids = u.kids.length + u.stepKids.length > 0;
      if (u.hasKids && collapsed.has(u.members[0])) { u.more = countUnits(u.kids) + countUnits(u.stepKids); u.kids = []; u.stepKids = []; }
      u.leaf = !u.kids.length && !u.stepKids.length && !u.more;
      u.ownW = u.members.length * o.cardW + (u.members.length - 1) * o.coupleGap;
      if (gen >= split) sizeBlock(u); else sizeChart(u, gen);
      return u;
    }

    // ----- list blocks -----
    function sizeBlock(u) {
      const kids = u.kids.concat(u.stepKids);
      u.block = true;
      u.rows = 1 + kids.reduce((s, k) => s + k.rows, 0);
      u.width = Math.max(u.ownW, ...kids.map(k => o.indent + k.width));
      u.height = u.rows * (o.cardH + o.vGap) - o.vGap;
    }

    // move one child's family to the middle: the place where the other families' widths are most even on each side
    function centreChild(u, id) {
      const i = u.kids.findIndex(k => k.members[0] === id);
      if (i < 0 || u.kids.length < 3) return;
      const c = u.kids.splice(i, 1)[0];
      const total = u.kids.reduce((s, k) => s + k.width, 0);
      let best = 0, bestD = Infinity, left = 0;
      for (let pos = 0; pos <= u.kids.length; pos++) {
        const d = Math.abs(left - (total - left));
        if (d < bestD) { bestD = d; best = pos; }
        if (pos < u.kids.length) left += u.kids[pos].width;
      }
      u.kids.splice(best, 0, c);
    }

    // ----- chart part -----
    function sizeChart(u, gen) {
      const leaves = u.kids.filter(k => k.leaf);
      u.stack = leaves.length >= 2 ? leaves : [];
      u.cols = u.kids.filter(k => !u.stack.includes(k));
      // a partner's own children (from before) get their own column too, beside the couple's
      const sleaves = u.stepKids.filter(k => k.leaf);
      u.sstack = sleaves.length >= 2 ? sleaves : [];
      u.scols = u.stepKids.filter(k => !u.sstack.includes(k));
      const parts = u.cols.concat(u.scols);
      let w = parts.reduce((s, k) => s + k.width, 0), n = parts.length;
      if (u.stack.length) {
        u.stackW = o.stackIndent + Math.max(...u.stack.map(k => k.ownW));
        w += u.stackW; n += 1;
        rowH[gen + 1] = Math.max(rowH[gen + 1] || o.cardH, u.stack.length * o.cardH + (u.stack.length - 1) * o.stackGap);
      }
      if (u.sstack.length) {
        u.sstackW = o.stackIndent + Math.max(...u.sstack.map(k => k.ownW));
        w += u.sstackW; n += 1;
        rowH[gen + 1] = Math.max(rowH[gen + 1] || o.cardH, u.sstack.length * o.cardH + (u.sstack.length - 1) * o.stackGap);
      }
      parts.forEach(k => { if (k.block) rowH[gen + 1] = Math.max(rowH[gen + 1] || o.cardH, k.height); });
      u.gap = parts.some(k => !k.leaf) ? o.branchGap : o.siblingGap;
      u.kidsW = w + Math.max(0, n - 1) * u.gap;
      u.width = Math.max(u.ownW, u.kidsW);
    }

    function putMembers(u, x0, y, extra) {
      u.members.forEach((m, i) => nodes.push(Object.assign({ id: m, x: x0 + i * (o.cardW + o.coupleGap), y, gen: u.gen }, i === 0 ? extra : {})));
      if (u.members.length === 2) marriages.push({ x1: x0 + o.cardW, x2: x0 + o.cardW + o.coupleGap, y: y + o.cardH / 2, a: u.members[0], b: u.members[1] });
    }
    // The line to the children leaves from between the couple only when the partner is a parent of every child
    // drawn there (e.g. Ima & Aba); otherwise from the descendant's own card, so a partner is never drawn as the
    // parent of children who are not theirs.
    const bothParents = u => u.members.length === 2 && u.kids.length > 0 && u.kids.every(k => P(k.members[0]).parents.includes(u.members[1]));
    const first = k => nodes.find(m => m.id === k.members[0]);

    function placeChart(u, left, extra) {
      if (u.block) return placeBlock(u, left, rowY(u.gen), extra);
      const y = rowY(u.gen);
      const x0 = left + (u.width - u.ownW) / 2;
      putMembers(u, x0, y, extra);
      if (u.hasKids) toggles.push({ id: u.members[0], x: x0 + o.cardW / 2, y: y + o.cardH, more: u.more || 0 });
      if (!u.kids.length && !u.stepKids.length) return;
      const both = bothParents(u);
      const joinX = both ? x0 + o.cardW + o.coupleGap / 2 : x0 + o.cardW / 2;
      const joinY = both ? y + o.cardH / 2 : y + o.cardH;
      const childTop = rowY(u.gen + 1);
      const busY = childTop - o.rowGap / 2;
      let cx = left + (u.width - u.kidsW) / 2;
      const drops = [];
      let d = '';
      u.cols.forEach(k => {
        placeChart(k, cx, { busY, fromX: joinX, fromY: joinY });
        const x = first(k).x + o.cardW / 2;
        drops.push(x); d += `M ${x} ${busY} V ${childTop} `;
        cx += k.width + u.gap;
      });
      if (u.stack.length) {
        const stackX = cx + o.stackIndent, spineX = cx + o.stackIndent / 2;
        let lastMid = childTop;
        u.stack.forEach((k, i) => {
          const ky = childTop + i * (o.cardH + o.stackGap);
          k.gen = u.gen + 1;
          putMembers(k, stackX, ky, { stacked: true, spineX, busY, fromX: joinX, fromY: joinY });
          lastMid = ky + o.cardH / 2;
          d += `M ${spineX} ${lastMid} H ${stackX} `;
        });
        d += `M ${spineX} ${busY} V ${lastMid} `;
        drops.push(spineX);
        cx += u.stackW + u.gap;
      }
      if (drops.length) d += `M ${joinX} ${joinY} V ${busY} M ${Math.min(joinX, ...drops)} ${busY} H ${Math.max(joinX, ...drops)} `;
      // a partner's own children hang from the partner's card
      if (u.stepKids.length) {
        const px = x0 + o.cardW + o.coupleGap + o.cardW / 2, py = y + o.cardH, by = busY - 10;
        const xs = [];
        (u.scols || u.stepKids).forEach(k => {
          placeChart(k, cx, { busY: by, fromX: px, fromY: py });
          const x = first(k).x + o.cardW / 2;
          xs.push(x); d += `M ${x} ${by} V ${childTop} `;
          cx += k.width + u.gap;
        });
        if (u.sstack && u.sstack.length) {
          const stackX = cx + o.stackIndent, spineX = cx + o.stackIndent / 2;
          let lastMid = childTop;
          u.sstack.forEach((k, i) => {
            const ky = childTop + i * (o.cardH + o.stackGap);
            k.gen = u.gen + 1;
            putMembers(k, stackX, ky, { stacked: true, spineX, busY: by, fromX: px, fromY: py });
            lastMid = ky + o.cardH / 2;
            d += `M ${spineX} ${lastMid} H ${stackX} `;
          });
          d += `M ${spineX} ${by} V ${lastMid} `;
          xs.push(spineX);
          cx += u.sstackW + u.gap;
        }
        d += `M ${px} ${py} V ${by} M ${Math.min(px, ...xs)} ${by} H ${Math.max(px, ...xs)} `;
      }
      if (d) lines.push({ d });
    }

    // a block: the unit's card(s), then each child's block one notch in, top to bottom
    function placeBlock(u, x0, y, extra) {
      putMembers(u, x0, y, extra);
      const spineX = x0 + o.indent / 2;
      if (u.hasKids) toggles.push({ id: u.members[0], x: spineX, y: y + o.cardH, more: u.more || 0 });
      let cy = y + o.cardH + o.vGap, d = '';
      const run = (kids, fromX, fromY, busY, sx) => {
        let lastMid = null;
        kids.forEach(k => {
          k.gen = u.gen + 1;
          placeBlock(k, x0 + o.indent, cy, { stacked: true, spineX: sx, busY, fromX, fromY });
          lastMid = cy + o.cardH / 2;
          d += `M ${sx} ${lastMid} H ${x0 + o.indent} `;
          cy += k.height + o.vGap;
        });
        if (lastMid != null) d += `M ${fromX} ${fromY} V ${busY} H ${sx} V ${lastMid} `;
      };
      if (u.kids.length) {
        if (bothParents(u)) run(u.kids, x0 + o.cardW + o.coupleGap / 2, y + o.cardH / 2, y + o.cardH + 4, spineX);
        else run(u.kids, spineX, y + o.cardH, y + o.cardH, spineX);
      }
      if (u.stepKids.length) run(u.stepKids, x0 + o.cardW + o.coupleGap + o.cardW / 2, y + o.cardH, y + o.cardH + 7, u.kids.length ? spineX - 6 : spineX);
      if (d) lines.push({ d });
    }

    // ----- trees: the root first, then anyone not reachable from it -----
    const units = [];
    if (rootId && people.has(rootId)) units.push({ u: build(rootId, rootGen), main: true });
    const rest = [...people.values()].filter(p => p.kind !== 'friend' && p.onTree !== false).sort((a, b) => a.order - b.order);
    rest.forEach(p => {
      if (claimed.has(p.id)) return;
      if (p.parents.some(id => !claimed.has(id) && people.has(id) && P(id).onTree !== false)) return; // their parent will start that tree
      units.push({ u: build(p.id, Math.max(rootGen, p.gen || rootGen)), main: false });
    });
    rest.forEach(p => { if (!claimed.has(p.id)) units.push({ u: build(p.id, Math.max(rootGen, p.gen || rootGen)), main: false }); });

    const extra = [];
    let width = 0, height = 0, rows = [];
    if (allList) {
      let cy = 0;
      units.forEach((t, i) => {
        if (i > 0) cy += o.treeGap;
        if (!t.main) extra.push({ x: 0, y: cy - 22, width: t.u.width, gen: t.u.gen });
        placeBlock(t.u, 0, cy);
        cy += t.u.height;
        width = Math.max(width, t.u.width);
      });
      height = cy;
    } else {
      // blocks of trees that are not linked to the root still start on their own generation's row
      units.forEach(t => { if (t.u.block) rowH[t.u.gen] = Math.max(rowH[t.u.gen] || o.cardH, t.u.height); });
      let cursor = 0;
      units.forEach((t, i) => {
        if (i > 0) cursor += o.treeGap;
        if (!t.main) extra.push({ x: cursor, y: rowY(t.u.gen) - 26, width: t.u.width, gen: t.u.gen });
        placeChart(t.u, cursor);
        cursor += t.u.width;
      });
      width = cursor;
      height = Math.max(...nodes.map(n => n.y)) + o.cardH;
      const lastRow = Math.min(split - 1, Math.max(...nodes.map(n => n.gen)));
      for (let g = rootGen; g <= lastRow; g++) rows.push({ gen: g, y: rowY(g) });
    }
    return { mode: allList ? 'list' : 'chart', split, nodes, marriages, lines, toggles, unlinked: extra, width, height, rows, opts: o };
  }

  const api = { layoutTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FT = Object.assign(root.FT || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
