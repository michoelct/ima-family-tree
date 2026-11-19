/*
 * relations.js — "how is B related to A?" in plain English, plus the path to light up.
 * Pure: works on the people Map from data.js. No gender is recorded in the sheet,
 * so relationship words are neutral pairs ("aunt / uncle").
 */
(function (root) {
  'use strict';

  const ORD = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  const greats = n => (n > 0 ? 'great-'.repeat(n) : '');

  /** Name of B as seen from A, where A climbs `up` generations and B is `down` below the shared ancestor. */
  function bloodName(up, down) {
    if (up === 0 && down === 0) return 'same person';
    if (up === 0) return down === 1 ? 'child' : greats(down - 2) + 'grandchild';
    if (down === 0) return up === 1 ? 'parent' : greats(up - 2) + 'grandparent';
    if (up === 1 && down === 1) return 'sibling';
    if (up === 1) return greats(down - 2) + 'niece / nephew';
    if (down === 1) return greats(up - 2) + 'aunt / uncle';
    const degree = Math.min(up, down) - 1;
    const removed = Math.abs(up - down);
    const d = ORD[degree] || degree + 'th';
    if (!removed) return d + ' cousin';
    return d + ' cousin ' + (removed === 1 ? 'once' : removed === 2 ? 'twice' : removed + ' times') + ' removed';
  }

  function ancestors(people, id) {
    const out = new Map([[id, 0]]);
    const q = [id];
    while (q.length) {
      const cur = q.shift();
      const p = people.get(cur);
      if (!p) continue;
      p.parents.forEach(pid => { if (!out.has(pid)) { out.set(pid, out.get(cur) + 1); q.push(pid); } });
    }
    return out;
  }

  /** Path of ids climbing from `from` to ancestor `anc` (inclusive). */
  function climb(people, from, anc) {
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const cur = q.shift();
      if (cur === anc) break;
      people.get(cur).parents.forEach(pid => { if (!prev.has(pid)) { prev.set(pid, cur); q.push(pid); } });
    }
    if (!prev.has(anc)) return null;
    const path = [];
    for (let c = anc; c != null; c = prev.get(c)) path.unshift(c);
    return path; // from ... anc
  }

  /** Closest shared ancestor of A and B, or null. */
  function blood(people, a, b) {
    const A = ancestors(people, a), B = ancestors(people, b);
    let best = null;
    A.forEach((da, id) => {
      if (!B.has(id)) return;
      const db = B.get(id);
      if (!best || da + db < best.up + best.down || (da + db === best.up + best.down && Math.max(da, db) < Math.max(best.up, best.down))) {
        best = { anc: id, up: da, down: db };
      }
    });
    if (!best) return null;
    // the shared ancestor's partner, if they are also a shared ancestor at the same distance
    const ap = people.get(best.anc);
    const both = [best.anc];
    if (ap.spouse && A.get(ap.spouse) === best.up && B.get(ap.spouse) === best.down) both.push(ap.spouse);
    const pathA = climb(people, a, best.anc);
    const pathB = climb(people, b, best.anc);
    best.common = both;
    best.path = pathA.concat(pathB.slice(0, -1).reverse());
    best.name = bloodName(best.up, best.down);
    return best;
  }

  /** A single in-law word where English has one, else null. side 'their' = B married A's <rel>; 'mine' = B is A's spouse's <rel>. */
  function inLawWord(rel, side) {
    if (side === 'their') {
      if (rel === 'child') return 'son / daughter-in-law';
      if (rel === 'sibling') return 'brother / sister-in-law';
      if (/aunt \/ uncle$/.test(rel)) return rel + ' (by marriage)';
      return null;
    }
    if (rel === 'parent') return 'mother / father-in-law';
    if (rel === 'sibling') return 'brother / sister-in-law';
    return null;
  }

  function display(p) { return p ? p.badge || p.name : '?'; }

  /**
   * @returns {{kind, label, phrase, path:[ids], common:[ids], note}}
   *  phrase is written for "B is A's ___" (third person) — the UI adds "your" when A is the viewer.
   */
  function relate(people, aId, bId, rootId) {
    const A = people.get(aId), B = people.get(bId);
    if (!A || !B) return null;
    if (aId === bId) return { kind: 'self', label: 'you', path: [aId], common: [] };

    if (A.kind === 'friend' || B.kind === 'friend') {
      const f = B.kind === 'friend' ? B : A;
      const rootP = people.get(rootId);
      const path = [aId, rootId, bId].filter((x, i, arr) => x && arr.indexOf(x) === i);
      return {
        kind: 'friend',
        label: f === B ? 'friend of ' + display(rootP) : 'family of ' + display(rootP),
        note: f.how ? f.name + ' knows ' + display(rootP) + ' through ' + f.how.toLowerCase().replace(/\.$/, '') + '.' : '',
        path, common: rootId ? [rootId] : []
      };
    }

    if (A.spouse === bId) return { kind: 'spouse', label: 'spouse', path: [aId, bId], common: [] };

    const direct = blood(people, aId, bId);
    if (direct) return { kind: 'blood', label: direct.name, path: direct.path, common: direct.common, up: direct.up, down: direct.down };

    // B married into A's family
    if (B.spouse) {
      const r = blood(people, aId, B.spouse);
      if (r) return { kind: 'inlaw', side: 'their', rel: r.name, word: inLawWord(r.name, 'their'), label: inLawWord(r.name, 'their') || r.name + '’s spouse', via: B.spouse, path: r.path.concat(bId), common: r.common };
    }
    // A married into B's family
    if (A.spouse) {
      const r = blood(people, A.spouse, bId);
      if (r) return { kind: 'inlaw', side: 'mine', rel: r.name, word: inLawWord(r.name, 'mine'), label: inLawWord(r.name, 'mine') || 'spouse’s ' + r.name, via: A.spouse, path: [aId].concat(r.path), common: r.common };
    }
    // both married in
    if (A.spouse && B.spouse) {
      const r = blood(people, A.spouse, B.spouse);
      if (r) return { kind: 'inlaw', side: 'both', rel: r.name, word: r.name === 'sibling' ? 'brother / sister-in-law' : null, label: r.name === 'sibling' ? 'brother / sister-in-law' : 'spouse’s ' + r.name + '’s spouse', via: B.spouse, via2: A.spouse, path: [aId].concat(r.path, bId), common: r.common };
    }
    // a parent who isn't on the tree: related through their children
    if (B.otherKids && B.otherKids.length) {
      const best = closestKid(people, aId, B.otherKids, rootId);
      if (best) return { kind: 'viaChild', side: 'their', kid: best.kid, rel: best.rel, label: kidsLabel(people, B.otherKids) + ' parent', path: (best.rel.path || [aId, best.kid]).concat(bId), common: [] };
    }
    if (A.otherKids && A.otherKids.length) {
      const best = closestKid(people, bId, A.otherKids, rootId);
      if (best) {
        const back = relate(people, best.kid, bId, rootId);
        return { kind: 'viaChild', side: 'mine', kid: best.kid, rel: back, label: back.kind === 'blood' && back.up === 1 && back.down === 0 ? 'your child\u2019s parent' : 'your child\u2019s ' + (back.word || back.label), path: [aId].concat(back.path), common: [] };
      }
    }
    // anything else: shortest path through any link
    const path = anyPath(people, aId, bId);
    return { kind: path ? 'marriage' : 'none', label: path ? 'family by marriage' : 'not linked yet', path: path || [aId, bId], common: [] };
  }

  function closestKid(people, from, kids, rootId) {
    let best = null;
    kids.forEach(k => {
      const rel = k === from ? { kind: 'self', path: [from], label: 'you' } : relate(people, from, k, rootId);
      if (!rel || rel.kind === 'none') return;
      const score = rel.kind === 'self' ? 0 : closeness(rel);
      if (!best || score < best.score) best = { kid: k, rel, score };
    });
    return best;
  }
  function kidsLabel(people, kids) {
    const names = kids.map(id => display(people.get(id)));
    return (names.length > 2 ? names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1] : names.join(' & ')) + '\u2019s';
  }

  function anyPath(people, a, b) {
    const prev = new Map([[a, null]]);
    const q = [a];
    while (q.length) {
      const cur = q.shift();
      if (cur === b) break;
      const p = people.get(cur);
      [].concat(p.parents, p.children, p.spouse ? [p.spouse] : [], p.otherKids || [], p.otherParents || []).forEach(n => { if (!prev.has(n)) { prev.set(n, cur); q.push(n); } });
    }
    if (!prev.has(b)) return null;
    const path = [];
    for (let c = b; c != null; c = prev.get(c)) path.unshift(c);
    return path;
  }

  /**
   * One sentence for the screen. `you` = true when A is the person holding the phone.
   * e.g. "Tamara is your first cousin once removed."
   */
  function describe(people, rel, aId, bId, you, rootId) {
    const A = people.get(aId), B = people.get(bId);
    const b = display(B), a = display(A);
    const poss = you ? 'your' : a + '’s';
    const subj = you ? 'you' : a;
    const name = id => display(people.get(id));
    switch (rel.kind) {
      case 'self': return you ? 'This is you.' : b + ' is the same person.';
      case 'spouse': return b + ' is ' + poss + ' spouse.';
      case 'blood': return b + ' is ' + poss + ' ' + rel.label + '.';
      case 'inlaw':
        if (rel.word) return b + ' is ' + poss + ' ' + rel.word + '.';
        if (rel.side === 'their') return b + ' is married to ' + poss + ' ' + rel.rel + ', ' + name(rel.via) + '.';
        if (rel.side === 'mine') return b + ' is ' + poss + ' spouse ' + name(rel.via) + '’s ' + rel.rel + '.';
        return b + ' is married to ' + name(rel.via) + ', ' + poss + ' spouse ' + name(rel.via2) + '’s ' + rel.rel + '.';
      case 'viaChild':
        if (rel.side === 'their') {
          if (rel.rel.kind === 'self') return b + ' is ' + poss + ' parent.';
          return b + ' is the parent of ' + poss + ' ' + (rel.rel.word || rel.rel.label) + ' ' + name(rel.kid) + '.';
        }
        if (rel.rel.kind === 'blood' && rel.rel.up === 1 && rel.rel.down === 0) return b + ' is ' + name(rel.kid) + '\u2019s parent too.';
        return b + ' is ' + poss + ' child ' + name(rel.kid) + '\u2019s ' + (rel.rel.word || rel.rel.label) + '.';
      case 'friend': return B.kind === 'friend' ? b + ' is a friend of ' + name(rootId) + '.' : b + ' is part of ' + name(rootId) + '’s family.';
      case 'marriage': return b + ' and ' + subj + ' are family by marriage.';
      default: return b + ' isn’t linked to ' + subj + ' in the sheet yet.';
    }
  }

  /** "Sara & Berish z"l" */
  function commonLine(people, rel, you) {
    if (!rel.common || !rel.common.length || rel.kind === 'friend') return '';
    if (rel.kind === 'blood' && (rel.up === 0 || rel.down === 0)) return '';
    if (rel.common.includes(rel.path[0]) || rel.common.includes(rel.path[rel.path.length - 1])) return '';
    const names = rel.common.map(id => { const p = people.get(id); return display(p) + (p.memorial ? ' z”l' : ''); }).join(' & ');
    return (you ? 'You both' : 'Both') + (rel.kind === 'inlaw' ? ' connect through ' : ' descend from ') + names + '.';
  }

  /** How close two people are, for sorting a list (smaller = closer). */
  function closeness(rel) {
    if (!rel) return 99;
    if (rel.kind === 'self') return 0;
    if (rel.kind === 'spouse') return 1;
    if (rel.kind === 'blood') return rel.up + rel.down;
    if (rel.kind === 'inlaw') return rel.path.length;
    if (rel.kind === 'friend') return 50;
    if (rel.kind === 'viaChild') return (rel.rel.kind === 'self' ? 1 : closeness(rel.rel) + 1);
    return 90;
  }

  const api = { bloodName, relate, describe, commonLine, closeness, ancestors };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FT = Object.assign(root.FT || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
