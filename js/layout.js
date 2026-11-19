/*
 * layout.js — places every card of the tree. Pure (numbers in, numbers out).
 * A "unit" is a person plus their spouse; the unit's children sit centred underneath.
 * Rows follow the generation, so everyone in generation 3 is on one line.
 */
(function (root) {
  'use strict';

  const DEFAULTS = { cardW: 156, cardH: 78, coupleGap: 26, siblingGap: 22, branchGap: 44, rowGap: 74, treeGap: 120, stackLeaves: true, stackGap: 12, stackIndent: 28 };

  function layoutTree(people, rootId, opts) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const placed = new Set();
    const claimed = new Set();
    const nodes = [], marriages = [], lines = [];
    // a generation row is one card high, or as tall as the tallest stacked family in it
    const rowH = {};
    const rowY = gen => { let y = 0; for (let g = 1; g < gen; g++) y += (rowH[g] || o.cardH) + o.rowGap; return y; };

    function makeUnit(id) {
      const p = people.get(id);
      const members = [id];
      if (p.spouse && !claimed.has(p.spouse) && people.get(p.spouse).onTree !== false) members.push(p.spouse);
      members.forEach(m => claimed.add(m));
      return { members, kids: [], width: 0 };
    }

    function build(id, gen) {
      const u = makeUnit(id);
      const kidIds = [];
      // children hang from the descendant (the unit's first card); a partner's own children are not drawn here
      const head = people.get(u.members[0]);
      const sources = head.blood || u.members.length === 1 ? [u.members[0]] : u.members;
      sources.forEach(m => people.get(m).children.forEach(c => { if (!claimed.has(c) && !kidIds.includes(c) && people.get(c).onTree !== false) kidIds.push(c); }));
      kidIds.sort((a, b) => people.get(a).order - people.get(b).order);
      kidIds.forEach(c => { if (!claimed.has(c)) u.kids.push(build(c, gen + 1)); });
      // the partner's own children (step-family) sit to the right, under the partner's card
      u.stepKids = [];
      if (head.blood && u.members.length === 2) {
        const stepIds = people.get(u.members[1]).children.filter(c => !claimed.has(c) && people.get(c).onTree !== false)
          .sort((a, b) => people.get(a).order - people.get(b).order);
        stepIds.forEach(c => { if (!claimed.has(c)) u.stepKids.push(build(c, gen + 1)); });
      }
      const own = u.members.length * o.cardW + (u.members.length - 1) * o.coupleGap;
      // children with no partner and no children of their own are listed one under the other
      u.stack = o.stackLeaves && !u.stepKids.length && u.kids.length > 1 && u.kids.every(k => k.members.length === 1 && !k.kids.length);
      let kidsW;
      if (u.stack) {
        kidsW = o.cardW + o.stackIndent;
        const h = u.kids.length * o.cardH + (u.kids.length - 1) * o.stackGap;
        rowH[gen + 1] = Math.max(rowH[gen + 1] || o.cardH, h);
      } else {
        const all = u.kids.concat(u.stepKids);
        kidsW = all.reduce((s, k) => s + k.width, 0) + Math.max(0, all.length - 1) * gapBetween(all);
      }
      u.ownW = own; u.kidsW = kidsW;
      u.width = Math.max(own, kidsW);
      return u;
    }
    // a little more room between branches that have children of their own
    function gapBetween(kids) { return kids.some(k => k.kids.length) ? o.branchGap : o.siblingGap; }

    function place(u, left, gen) {
      const y = rowY(gen);
      const x0 = left + (u.width - u.ownW) / 2;
      u.members.forEach((m, i) => {
        const x = x0 + i * (o.cardW + o.coupleGap);
        nodes.push({ id: m, x, y, gen });
        placed.add(m);
      });
      if (u.members.length === 2) {
        const x1 = x0 + o.cardW, x2 = x0 + o.cardW + o.coupleGap;
        marriages.push({ x1, x2, y: y + o.cardH / 2, a: u.members[0], b: u.members[1] });
      }
      // The line to the children leaves from between the couple only when the partner is a parent of
      // every child drawn here (e.g. Ima & Aba). Otherwise it leaves from the descendant's own card,
      // so a partner is never drawn as the parent of children who are not theirs.
      const both = u.members.length === 2 && u.kids.length > 0 && u.kids.every(k => people.get(k.members[0]).parents.includes(u.members[1]));
      const joinX = both ? x0 + o.cardW + o.coupleGap / 2 : x0 + o.cardW / 2;
      const joinY = both ? y + o.cardH / 2 : y + o.cardH;
      if (!u.kids.length && !u.stepKids.length) return;
      const childTop = rowY(gen + 1);
      const busY = childTop - o.rowGap / 2;
      if (u.stack) {
        const stackX = left + (u.width - u.kidsW) / 2 + o.stackIndent;
        const spineX = stackX - o.stackIndent / 2;
        let lastMid = childTop;
        u.kids.forEach((k, i) => {
          const y = childTop + i * (o.cardH + o.stackGap);
          nodes.push({ id: k.members[0], x: stackX, y, gen: gen + 1, stacked: true, spineX, busY, fromX: joinX, fromY: joinY });
          placed.add(k.members[0]);
          lastMid = y + o.cardH / 2;
          lines.push({ d: `M ${spineX} ${lastMid} H ${stackX}`, from: u.members, to: [k.members[0]] });
        });
        lines.push({ d: `M ${joinX} ${joinY} V ${busY} H ${spineX} V ${lastMid}`, from: u.members, to: u.kids.map(k => k.members[0]) });
        return;
      }
      let cx = left + (u.width - u.kidsW) / 2;
      const all = u.kids.concat(u.stepKids);
      const gap = gapBetween(all);
      const centres = [];
      all.forEach(k => {
        place(k, cx, gen + 1);
        const first = nodes.find(n => n.id === k.members[0]);
        centres.push({ x: first.x + o.cardW / 2, id: k.members[0], step: u.stepKids.includes(k) });
        cx += k.width + gap;
      });
      const drawGroup = (fromX, fromY, group, y) => {
        if (!group.length) return;
        const minX = Math.min(fromX, ...group.map(c => c.x)), maxX = Math.max(fromX, ...group.map(c => c.x));
        lines.push({ d: `M ${fromX} ${fromY} V ${y} H ${minX} M ${minX} ${y} H ${maxX}` });
        group.forEach(c => lines.push({ d: `M ${c.x} ${y} V ${childTop}` }));
        group.forEach(c => { const n = nodes.find(m => m.id === c.id); n.busY = y; n.fromX = fromX; n.fromY = fromY; });
      };
      drawGroup(joinX, joinY, centres.filter(c => !c.step), busY);
      const partnerX = x0 + o.cardW + o.coupleGap + o.cardW / 2;
      drawGroup(partnerX, y + o.cardH, centres.filter(c => c.step), busY - 10);
    }

    let cursor = 0;
    const trees = [];
    if (rootId && people.has(rootId)) trees.push(rootId);
    // anyone not reachable from the root becomes its own small tree to the right
    const rest = [...people.values()].filter(p => p.kind !== 'friend' && p.onTree !== false).sort((a, b) => a.order - b.order);
    const units = [];
    trees.forEach(t => units.push({ u: build(t, people.get(t).gen || 1), gen: people.get(t).gen || 1, main: true }));
    rest.forEach(p => {
      if (claimed.has(p.id)) return;
      if (p.parents.some(id => !claimed.has(id))) return; // their parent will start that tree
      units.push({ u: build(p.id, p.gen || 1), gen: p.gen || 1, main: false });
    });
    rest.forEach(p => { if (!claimed.has(p.id)) units.push({ u: build(p.id, p.gen || 1), gen: p.gen || 1, main: false }); });

    const extra = [];
    units.forEach((t, i) => {
      if (i > 0) cursor += o.treeGap;
      if (!t.main) extra.push({ x: cursor, width: t.u.width, gen: t.gen });
      place(t.u, cursor, t.gen);
      cursor += t.u.width;
    });

    const maxGen = Math.max(1, ...nodes.map(n => n.gen));
    return {
      nodes, marriages, lines, unlinked: extra,
      width: cursor, height: rowY(maxGen) + (rowH[maxGen] || o.cardH),
      rows: Array.from({ length: maxGen }, (_, i) => ({ gen: i + 1, y: rowY(i + 1) })),
      opts: o
    };
  }

  const api = { layoutTree };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FT = Object.assign(root.FT || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
