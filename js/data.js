/*
 * data.js — turns the Google Sheet rows into a linked family.
 * Pure: no DOM, no network. Runs in the browser (window.FT) and in Node (tests).
 *
 * The sheet is filled in by relatives themselves, so names arrive with typos,
 * nicknames, extra spaces and z"l written several ways. Every reference
 * (parent / spouse) is matched to a person by these steps, most certain first:
 *   1. a Person ID typed in the cell (FAM-014)
 *   2. the exact full name
 *   3. first name + surname (middle names ignored)
 *   4. nickname + surname ("Eli Feder", "ET Exler")
 *   5. a near spelling of the full name (≤ 2 letters different, only if one person fits)
 * z"l separates people with the same name (Simcha Feder z"l vs. the great-grandson
 * Simcha Feder). A reference nobody matches becomes a placeholder person, so the
 * tree still joins up; every guess is listed in the organiser's data check.
 */
(function (root) {
  'use strict';

  // ---------- CSV ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = '', i = 0, inQuotes = false;
    text = String(text || '').replace(/^﻿/, '');
    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // ---------- names ----------
  function tidy(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

  /** Splits "Berish Chaimovitz (z"l)" into { name: 'Berish Chaimovitz', memorial: true }. */
  function splitMemorial(raw) {
    let s = tidy(raw);
    let memorial = false;
    const m = s.match(/\(\s*z\s*["'`“”״]{0,2}\s*l\s*\)|\bz\s*["'`“”״]{1,2}\s*l\b/i);
    if (m) { memorial = true; s = tidy(s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)); }
    return { name: s, memorial };
  }

  function norm(s) {
    return tidy(splitMemorial(s).name).toLowerCase().normalize('NFKD')
      .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9֐-׿ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[n];
  }

  function parseGen(v) {
    const m = String(v || '').match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  // ---------- rows -> records ----------
  function colIndex(header, patterns) {
    const h = header.map(x => tidy(x).toLowerCase());
    for (const p of patterns) {
      const i = h.findIndex(x => p.test(x));
      if (i >= 0) return i;
    }
    return -1;
  }

  function familyRecords(rows) {
    if (!rows || !rows.length) return [];
    const head = rows[0];
    const c = {
      id: colIndex(head, [/person id/, /\bid\b/]),
      name: colIndex(head, [/full name/, /^name/]),
      badge: colIndex(head, [/nickname|badge/]),
      type: colIndex(head, [/connection type|type/]),
      gen: colIndex(head, [/generation/]),
      p1: colIndex(head, [/parent 1/, /parent/]),
      p2: colIndex(head, [/parent 2/]),
      spouse: colIndex(head, [/spouse|partner/])
    };
    const get = (r, i) => (i >= 0 ? tidy(r[i]) : '');
    const out = [];
    rows.slice(1).forEach((r, idx) => {
      const name = get(r, c.name);
      if (!name) return;
      out.push({
        row: idx + 2,
        id: get(r, c.id).toUpperCase(),
        name,
        badge: get(r, c.badge),
        type: get(r, c.type),
        gen: parseGen(get(r, c.gen)),
        parent1: get(r, c.p1),
        parent2: get(r, c.p2),
        spouse: get(r, c.spouse)
      });
    });
    return out;
  }

  function friendRecords(rows) {
    if (!rows || !rows.length) return [];
    const head = rows[0];
    const c = {
      id: colIndex(head, [/guest id/, /\bid\b/]),
      name: colIndex(head, [/full name/, /^name/]),
      badge: colIndex(head, [/nickname|badge/]),
      how: colIndex(head, [/how do you know/, /how/]),
      story: colIndex(head, [/story|details/])
    };
    const get = (r, i) => (i >= 0 ? tidy(r[i]) : '');
    const out = [];
    rows.slice(1).forEach((r, idx) => {
      const name = get(r, c.name);
      if (!name) return;
      out.push({ row: idx + 2, id: get(r, c.id).toUpperCase(), name, badge: get(r, c.badge), how: get(r, c.how), story: get(r, c.story) });
    });
    return out;
  }

  function titleCase(s) {
    // Only fix all-lowercase badge names ("sara" -> "Sara"); leave "YA YA", "ET" alone.
    return s && s === s.toLowerCase() ? s.replace(/\b\p{L}/gu, ch => ch.toUpperCase()) : s;
  }

  // ---------- build ----------
  /**
   * @param {object} input { familyRows, friendRows, extras:[record], rootName }
   * @returns {object} { people: Map, rootId, warnings: [], order: [ids] }
   */
  function buildFamily(input) {
    const warnings = [];
    const people = new Map();
    const familyRecs = familyRecords(input.familyRows);
    const friendRecs = friendRecords(input.friendRows);

    const spelling = new Map();
    function warn(kind, text, ids) { warnings.push({ kind, text, ids: ids || [] }); }

    function addPerson(rec, kind, source) {
      const split = splitMemorial(rec.name);
      let id = rec.id;
      if (!id || people.has(id)) {
        const fresh = (kind === 'friend' ? 'FRD-R' : 'FAM-R') + String(rec.row || people.size + 1).padStart(3, '0');
        if (id && people.has(id)) warn('duplicate', `Two rows use the ID ${id} (${people.get(id).name} and ${split.name}). ${split.name} is shown as ${fresh} until it is fixed — their badge QR code depends on it.`, [id]);
        else if (kind !== 'placeholder' && source === 'sheet') warn('noid', `${split.name} (row ${rec.row}) has no ID yet — shown as ${fresh}.`, []);
        id = fresh;
      }
      const p = {
        id,
        kind,                       // family | friend | placeholder
        source,                     // sheet | extra | auto
        name: split.name,
        memorial: split.memorial || !!rec.memorial,
        badge: titleCase(tidy(rec.badge)) || split.name.split(' ')[0],
        role: /spouse|partner/i.test(rec.type || '') ? 'spouse' : (kind === 'family' ? 'blood' : kind === 'friend' ? 'friend' : ''),
        declaredGen: rec.gen || null,
        gen: null,
        refs: { parent1: rec.parent1 || '', parent2: rec.parent2 || '', spouse: rec.spouse || '' },
        how: rec.how || '', story: rec.story || '',
        parents: [], children: [], spouse: null, spouseInferred: false,
        order: rec.row != null ? rec.row : 9000 + people.size,
        row: rec.row || null
      };
      people.set(id, p);
      return p;
    }

    familyRecs.forEach(r => addPerson(r, 'family', 'sheet'));
    friendRecs.forEach(r => addPerson(r, 'friend', 'sheet'));

    let extraN = 0;
    // extras (configured people not yet in the sheet) — skipped once the sheet has them
    (input.extras || []).forEach(x => {
      const s = splitMemorial(x.name);
      const memorial = s.memorial || !!x.memorial;
      const exists = [...people.values()].some(p => p.kind === 'family' && norm(p.name) === norm(s.name) && p.memorial === memorial);
      if (!exists) {
        const p = addPerson(Object.assign({ row: null }, x, { id: 'EXTRA-' + String(++extraN).padStart(2, '0'), name: s.name + (memorial ? ' z"l' : '') }), 'family', 'extra');
        p.memorial = memorial;
      }
    });

    // ---- index for name matching ----
    function keysOf(p) {
      const n = norm(p.name).split(' ');
      const first = n[0], last = n[n.length - 1];
      const badge = norm(p.badge);
      return { full: n.join(' '), firstLast: n.length > 1 ? first + ' ' + last : null, badgeLast: badge && n.length > 1 ? badge + ' ' + last : null };
    }

    function candidates(ref) {
      const target = norm(ref);
      if (!target) return { list: [], how: '' };
      const pool = [...people.values()].filter(p => p.kind !== 'friend');
      const idMatch = people.get(tidy(ref).toUpperCase());
      if (idMatch && idMatch.kind !== 'friend') return { list: [idMatch], how: 'id' };
      const steps = [
        ['full', p => keysOf(p).full === target],
        ['firstLast', p => { const t = target.split(' '); return t.length > 1 && keysOf(p).firstLast === t[0] + ' ' + t[t.length - 1]; }],
        ['badgeLast', p => keysOf(p).badgeLast === target],
      ];
      for (const [how, test] of steps) {
        const list = pool.filter(test);
        if (list.length) return { list, how };
      }
      if (target.length >= 8) {
        const near = pool.filter(p => lev(keysOf(p).full, target) <= 2);
        if (near.length) return { list: near, how: 'near' };
      }
      return { list: [], how: '' };
    }

    /** Picks one person for a reference, or makes a placeholder. */
    function resolve(ref, from, rel) {
      if (!tidy(ref)) return null;
      const { memorial } = splitMemorial(ref);
      let { list, how } = candidates(ref);
      list = list.filter(p => p.id !== from.id);
      // z"l decides between namesakes: a z"l reference never means a living person
      if (memorial) list = list.filter(p => p.memorial);
      else if (list.some(p => !p.memorial)) list = list.filter(p => !p.memorial);
      // the expected generation decides next
      const g = from.declaredGen;
      if (list.length > 1 && g) {
        const want = rel === 'parent' ? g - 1 : rel === 'child' ? g + 1 : g;
        const byGen = list.filter(p => !p.declaredGen || p.declaredGen === want);
        if (byGen.length) list = byGen;
      }
      if (list.length > 1) {
        list.sort((a, b) => a.order - b.order);
        warn('ambiguous', `"${tidy(ref)}" (${rel} of ${from.name}) could be ${list.map(p => p.name + ' ' + p.id).join(' or ')} — linked to ${list[0].name}. Use the Person ID in the sheet to be sure.`, [from.id, list[0].id]);
      }
      if (list.length) {
        const hit = list[0];
        if (how === 'near') {
          const k = norm(ref) + '|' + hit.id;
          if (!spelling.has(k)) spelling.set(k, { ref: tidy(splitMemorial(ref).name), hit, from: [] });
          spelling.get(k).from.push(from);
        }
        return hit;
      }
      // placeholder — one per distinct name
      const key = 'auto:' + norm(ref) + (memorial ? ':zl' : '');
      const existing = [...people.values()].find(p => p.placeKey === key);
      if (existing) return existing;
      const s = splitMemorial(ref);
      const ph = addPerson({ id: 'LINK-' + String([...people.values()].filter(p => p.kind === 'placeholder').length + 1).padStart(2, '0'), name: s.name, badge: s.name.split(' ')[0], row: null }, 'placeholder', 'auto');
      ph.memorial = memorial;
      ph.placeKey = key;
      if (!memorial) warn('missing', `${s.name} is named as ${rel} of ${from.name} but has no row in the sheet yet — shown as a placeholder.`, [from.id, ph.id]);
      return ph;
    }

    function linkParent(child, par) {
      if (!par || par.id === child.id) return;
      if (!child.parents.includes(par.id)) child.parents.push(par.id);
      if (!par.children.includes(child.id)) par.children.push(child.id);
    }
    function linkSpouse(a, b, inferred) {
      if (!a || !b || a.id === b.id) return;
      if (a.spouse && a.spouse !== b.id) {
        warn('spouse', `${a.name} is listed with two partners (${people.get(a.spouse).name} and ${b.name}); keeping ${people.get(a.spouse).name}.`, [a.id, b.id]);
        return;
      }
      if (b.spouse && b.spouse !== a.id) {
        warn('spouse', `${b.name} is listed with two partners (${people.get(b.spouse).name} and ${a.name}); keeping ${people.get(b.spouse).name}.`, [a.id, b.id]);
        return;
      }
      a.spouse = b.id; b.spouse = a.id;
      if (inferred) { a.spouseInferred = true; b.spouseInferred = true; }
    }

    const named = [...people.values()].filter(p => p.kind === 'family');
    named.forEach(p => {
      if (p.refs.spouse) linkSpouse(p, resolve(p.refs.spouse, p, 'spouse'));
    });
    named.forEach(p => {
      [p.refs.parent1, p.refs.parent2].forEach(r => { if (r) linkParent(p, resolve(r, p, 'parent')); });
    });
    // placeholders created as spouses/parents of placeholders don't exist (they have no refs)

    // two parents with no partner on record are a couple
    people.forEach(p => {
      if (p.parents.length === 2) {
        const [a, b] = p.parents.map(id => people.get(id));
        if (!a.spouse && !b.spouse) linkSpouse(a, b, true);
      }
    });
    spelling.forEach(({ ref, hit, from }) => {
      const who = from.length > 2 ? `${from.length} rows` : from.map(p => p.name).join(' and ');
      const own = hit.name;
      if (from.length >= 2 && hit.source === 'sheet') hit.name = ref; // most rows agree: show their spelling
      warn('spelling', `${who} write "${ref}", but ${hit.id}'s own row says "${own}". They are linked as one person and shown as "${hit.name}" — fix whichever spelling is wrong in the sheet.`, [hit.id].concat(from.map(p => p.id)));
    });

    // ---- root ----
    let rootId = null;
    if (input.rootName) {
      const r = candidates(input.rootName).list.filter(p => p.kind === 'family');
      if (r.length) rootId = r.sort((a, b) => a.order - b.order)[0].id;
    }
    if (!rootId) {
      const g1 = [...people.values()].filter(p => p.kind === 'family' && p.declaredGen === 1 && !p.memorial);
      if (g1.length) rootId = g1[0].id;
    }

    // ---- generations from the links (root = 1) ----
    if (rootId) {
      const queue = [rootId];
      people.get(rootId).gen = 1;
      while (queue.length) {
        const p = people.get(queue.shift());
        const step = (id, g) => { const q = people.get(id); if (q && q.gen == null) { q.gen = g; queue.push(id); } };
        if (p.spouse) step(p.spouse, p.gen);
        p.children.forEach(id => step(id, p.gen + 1));
        p.parents.forEach(id => step(id, p.gen - 1));
      }
    }
    people.forEach(p => {
      if (p.kind === 'friend') return;
      if (p.gen == null) {
        p.gen = p.declaredGen || null;
        if (p.kind === 'family' && rootId) warn('unlinked', `${p.name} is not linked to ${people.get(rootId).name} yet — check their parent or spouse names.`, [p.id]);
      } else if (p.declaredGen && p.declaredGen !== p.gen && p.kind === 'family') {
        warn('generation', `${p.name} chose generation ${p.declaredGen}, but their family links put them in generation ${p.gen}. The tree uses ${p.gen}.`, [p.id]);
      }
    });
    // placeholders that are spouses of nobody and parents of a placeholder chain: guess generation
    people.forEach(p => {
      if (p.gen == null && p.kind === 'placeholder') {
        const kid = p.children.map(id => people.get(id)).find(c => c.gen != null);
        if (kid) p.gen = kid.gen - 1;
        else if (p.spouse && people.get(p.spouse).gen != null) p.gen = people.get(p.spouse).gen;
      }
    });

    // blood descendant of the root, or married in
    if (rootId) {
      const blood = new Set([rootId]);
      const q = [rootId];
      while (q.length) people.get(q.shift()).children.forEach(id => { if (!blood.has(id)) { blood.add(id); q.push(id); } });
      people.forEach(p => { p.blood = blood.has(p.id); });
    }

    return { people, rootId, warnings };
  }

  const api = { parseCSV, splitMemorial, norm, lev, familyRecords, friendRecords, buildFamily, tidy };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FT = Object.assign(root.FT || {}, api);
})(typeof window !== 'undefined' ? window : globalThis);
