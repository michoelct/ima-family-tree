/* app.js — screens, tree drawing, live sheet updates, QR printing. */
(function () {
  'use strict';
  const FT = window.FT;
  const cfg = window.FT_CONFIG;
  const $ = id => document.getElementById(id);
  const PADX = 120, PADY = 40;

  // ---------- small helpers ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(k => { if (k == null || k === false) return; n.append(k.nodeType ? k : document.createTextNode(String(k))); });
    return n;
  }
  const svg = (tag, attrs) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  let toastTimer;
  function toast(msg, ms) {
    const t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms || 4200);
  }
  const initials = p => p.badge.replace(/[^\p{L}\s]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
  const zl = p => (p && p.memorial ? ' z”l' : '');
  const display = p => (p ? p.badge || p.name : '');

  // ---------- state ----------
  let fam = null, lay = null, data = null;
  let me = null;           // person id
  let path = null;         // { a, b, rel }
  let t = { x: 0, y: 0, k: 1 };
  let firstRender = true;
  const GEN_NAMES = { 1: cfg.rootTitle + ' & elders', 2: 'children', 3: 'grandchildren', 4: 'great-grandchildren', 5: 'great-great-grandchildren' };

  // ---------- data ----------
  const sheetUrl = gid => `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}&_=${Date.now()}`;

  async function fetchLive(manual) {
    try {
      const [a, b] = await Promise.all([fetch(sheetUrl(cfg.familyGid)), fetch(sheetUrl(cfg.friendsGid))]);
      if (!a.ok || !b.ok) throw new Error('HTTP ' + a.status + '/' + b.status);
      const next = { familyRows: FT.parseCSV(await a.text()), friendRows: FT.parseCSV(await b.text()), fetchedAt: new Date().toISOString() };
      if (next.familyRows.length < 2) throw new Error('The family tab came back empty');
      const changed = !data || JSON.stringify(data.familyRows) !== JSON.stringify(next.familyRows) || JSON.stringify(data.friendRows) !== JSON.stringify(next.friendRows);
      const before = fam ? new Set([...fam.people.values()].map(p => FT.norm(p.name))) : null;
      data = next;
      store.set('ft.data', data);
      if (changed) {
        render();
        if (before) {
          const added = [...fam.people.values()].filter(p => p.source === 'sheet' && !before.has(FT.norm(p.name))).map(display);
          if (added.length) toast((added.length === 1 ? 'Just added: ' : 'Just added: ') + added.slice(0, 4).join(', ') + (added.length > 4 ? ' and ' + (added.length - 4) + ' more' : ''));
          else if (manual) toast('Updated from the sheet.');
        }
      } else if (manual) toast('Already up to date.');
      setSub();
      if ($('view-organizer').classList.contains('on')) renderOrganizer();
    } catch (e) {
      console.warn('Sheet fetch failed', e);
      if (manual) toast('Could not reach the Google Sheet just now — showing the last copy.');
    }
  }

  async function loadFirst() {
    data = store.get('ft.data');
    if (!data) {
      try { const r = await fetch('data/snapshot.json', { cache: 'no-cache' }); if (r.ok) data = await r.json(); } catch (e) { /* offline */ }
    }
    if (data) render();
    await fetchLive(false);
    if (!data) { $('appSub').textContent = 'Could not load the family — check the connection and reload.'; return; }
    const every = Math.max(15, cfg.refreshSeconds || 45) * 1000;
    setInterval(() => { if (document.visibilityState === 'visible') fetchLive(false); }, every);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fetchLive(false); });
  }

  function setSub() {
    if (!fam) return;
    const family = [...fam.people.values()].filter(p => p.kind !== 'friend');
    const friends = [...fam.people.values()].filter(p => p.kind === 'friend');
    const gens = Math.max(...family.map(p => p.gen || 0));
    $('appSub').textContent = `${cfg.subtitle ? cfg.subtitle.split('·')[0].trim() + ' · ' : ''}${family.length} family${friends.length ? ' · ' + friends.length + ' friends' : ''} · ${gens} generations`;
  }

  // ---------- render all ----------
  function render() {
    fam = FT.buildFamily({ familyRows: data.familyRows, friendRows: data.friendRows, extras: cfg.extras, rootName: cfg.rootName });
    restoreMe();
    lay = FT.layoutTree(fam.people, fam.rootId);
    drawTree();
    if (path && (!fam.people.has(path.a) || !fam.people.has(path.b))) clearPath();
    else if (path) setPath(path.a, path.b, false);
    renderPeople();
    renderMe();
    renderMeChip();
    setSub();
    if (firstRender) {
      firstRender = false;
      setTimeout(() => { initialView(); handleScan(); }, 0); // not rAF: it never fires in a background tab
    }
    if (!$('sheet').hidden && openId) openPerson(openId, true);
  }

  // ---------- me ----------
  function restoreMe() {
    const saved = store.get('ft.me');
    me = null;
    if (!saved) return;
    const byId = fam.people.get(saved.id);
    if (byId && FT.norm(byId.name) === FT.norm(saved.name)) { me = byId.id; return; }
    const byName = [...fam.people.values()].find(p => FT.norm(p.name) === FT.norm(saved.name));
    if (byName) { me = byName.id; store.set('ft.me', { id: me, name: byName.name }); }
  }
  function setMe(id) {
    const p = fam.people.get(id);
    me = id; store.set('ft.me', { id, name: p.name });
    drawTree(); renderPeople(); renderMe(); renderMeChip();
  }
  function clearMe() {
    me = null; store.del('ft.me'); clearPath();
    drawTree(); renderPeople(); renderMe(); renderMeChip();
  }
  function renderMeChip() {
    const c = $('meChip');
    if (me) { c.hidden = false; c.textContent = '🙂 ' + display(fam.people.get(me)); c.onclick = () => openPerson(me); }
    else { c.hidden = false; c.textContent = 'Who are you?'; c.onclick = () => go('me'); }
    $('zoomMe').hidden = !me;
  }

  // ---------- tree ----------
  function cardClass(p) {
    return 'card' + (p.id === fam.rootId ? ' root' : '') + (p.memorial ? ' memorial' : '') + (p.kind === 'placeholder' ? ' placeholder' : '') + (p.id === me ? ' me' : '');
  }

  function drawTree() {
    const o = lay.opts;
    const cards = $('cards'), lines = $('lines');
    cards.textContent = ''; lines.textContent = '';
    const W = lay.width + PADX + 60, H = lay.height + PADY + 60;
    $('stage').style.width = W + 'px'; $('stage').style.height = H + 'px';
    lines.setAttribute('width', W); lines.setAttribute('height', H);
    const g = svg('g', { transform: `translate(${PADX},${PADY})`, id: 'treeLines' });
    lay.lines.forEach(l => g.append(svg('path', { d: l.d, class: 'tree-line' })));
    lay.marriages.forEach(m => g.append(svg('line', { x1: m.x1, x2: m.x2, y1: m.y, y2: m.y, class: 'wed' })));
    lines.append(g);
    lines.append(svg('g', { transform: `translate(${PADX},${PADY})`, id: 'hotLines' }));

    lay.rows.forEach(r => cards.append(el('div', { class: 'row-label', style: `left:12px;top:${PADY + r.y + o.cardH / 2 - 8}px`, text: 'Gen ' + r.gen + (GEN_NAMES[r.gen] ? ' · ' + GEN_NAMES[r.gen] : '') })));
    lay.unlinked.forEach((u, i) => { if (i === 0) cards.append(el('div', { class: 'unlinked-label', style: `left:${PADX + u.x}px;top:${PADY + (u.gen - 1) * (o.cardH + o.rowGap) - 26}px`, text: 'Not linked to ' + cfg.rootTitle + ' yet' })); });

    lay.nodes.forEach(n => {
      const p = fam.people.get(n.id);
      const label = display(p) + zl(p) + ', ' + p.name + (p.id === me ? ' (you)' : '');
      const b = el('button', { class: cardClass(p), 'data-id': p.id, style: `left:${PADX + n.x}px;top:${PADY + n.y}px;width:${o.cardW}px;height:${o.cardH}px`, 'aria-label': label, onclick: () => openPerson(p.id) },
        el('div', { class: 'badge' }, display(p), p.memorial ? el('span', { class: 'zl', text: 'z”l' }) : null),
        el('div', { class: 'full', text: p.kind === 'placeholder' ? p.name + ' · not in the sheet yet' : p.name }));
      cards.append(b);
    });
    applyHighlight();
    apply();
  }

  function nodeOf(id) { return lay.nodes.find(n => n.id === id); }

  // ---------- pan & zoom ----------
  const vp = $('viewport'), stage = $('stage');
  function apply() { stage.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.k})`; }
  function clampK(k) { return Math.min(2.2, Math.max(0.08, k)); }
  function zoomAt(px, py, k) { k = clampK(k); t.x = px - (px - t.x) * (k / t.k); t.y = py - (py - t.y) * (k / t.k); t.k = k; apply(); }
  function zoomBy(f) { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, t.k * f); }
  function fitBox(x0, y0, x1, y1, maxK) {
    const r = vp.getBoundingClientRect();
    const side = window.innerWidth >= 760 && !$('sheet').hidden ? $('sheet').offsetWidth : 0; // desktop panel covers the right
    const w = r.width - side;
    const k = clampK(Math.min((w - 40) / (x1 - x0), (r.height - 40) / (y1 - y0), maxK || 1));
    t.k = k; t.x = (w - (x1 - x0) * k) / 2 - x0 * k; t.y = (r.height - (y1 - y0) * k) / 2 - y0 * k; apply();
  }
  function fitAll() { fitBox(0, 0, lay.width + PADX + 60, lay.height + PADY + 60, 1); }
  function centerOn(id, k) {
    const n = nodeOf(id); if (!n) return;
    const r = vp.getBoundingClientRect(); const o = lay.opts;
    t.k = clampK(k || Math.max(t.k, 0.85));
    t.x = r.width / 2 - (PADX + n.x + o.cardW / 2) * t.k;
    t.y = r.height / 2 - (PADY + n.y + o.cardH / 2) * t.k; apply();
    const c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
  }
  function initialView() {
    if (me && nodeOf(me)) { centerOn(me, 0.85); return; }
    const r = vp.getBoundingClientRect();
    const W = lay.width + PADX + 60, H = lay.height + PADY + 60;
    if (Math.min((r.width - 40) / W, (r.height - 40) / H) >= 0.45) { fitAll(); return; }
    const n = nodeOf(fam.rootId); if (!n) { fitAll(); return; }
    t.k = 0.8; t.x = r.width / 2 - (PADX + n.x + lay.opts.cardW / 2) * t.k; t.y = 16; apply();
  }

  const pts = new Map();
  let drag = null, dragged = false, pinch = null;
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { drag = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y }; dragged = false; }
    if (pts.size === 2) {
      const [p1, p2] = [...pts.values()];
      const r = vp.getBoundingClientRect();
      pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: t.k, mx: (p1.x + p2.x) / 2 - r.left, my: (p1.y + p2.y) / 2 - r.top, tx: t.x, ty: t.y };
      dragged = true;
    }
  });
  window.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pts.size >= 2) {
      const [p1, p2] = [...pts.values()];
      const r = vp.getBoundingClientRect();
      const k = clampK(pinch.k * Math.hypot(p1.x - p2.x, p1.y - p2.y) / pinch.d);
      const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top;
      t.k = k; t.x = mx - (pinch.mx - pinch.tx) * (k / pinch.k); t.y = my - (pinch.my - pinch.ty) * (k / pinch.k); apply();
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) > 6) { dragged = true; vp.classList.add('dragging'); }
      if (dragged) { t.x = drag.tx + dx; t.y = drag.ty + dy; apply(); }
    }
  });
  function up(e) {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (pts.size === 1) { const p = [...pts.values()][0]; drag = { x: p.x, y: p.y, tx: t.x, ty: t.y }; }
    if (!pts.size) { drag = null; vp.classList.remove('dragging'); }
  }
  window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  vp.addEventListener('click', e => { if (dragged) { e.stopPropagation(); e.preventDefault(); dragged = false; } }, true);
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    const mouseWheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
    if (e.ctrlKey || mouseWheel) zoomAt(e.clientX - r.left, e.clientY - r.top, t.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    else { t.x -= e.deltaX; t.y -= e.deltaY; apply(); }
  }, { passive: false });
  vp.addEventListener('keydown', e => {
    const step = 60;
    if (e.key === 'ArrowLeft') t.x += step; else if (e.key === 'ArrowRight') t.x -= step;
    else if (e.key === 'ArrowUp') t.y += step; else if (e.key === 'ArrowDown') t.y -= step;
    else if (e.key === '+' || e.key === '=') return zoomBy(1.2); else if (e.key === '-') return zoomBy(1 / 1.2);
    else return;
    e.preventDefault(); apply();
  });
  $('zoomIn').onclick = () => zoomBy(1.25);
  $('zoomOut').onclick = () => zoomBy(1 / 1.25);
  $('zoomFit').onclick = () => (path ? fitPath() : fitAll());
  $('zoomMe').onclick = () => { if (me) centerOn(me, 0.9); };
  window.addEventListener('resize', () => { if (path) fitPath(); });

  // ---------- highlighted line ----------
  function setPath(a, b, fit) {
    const rel = FT.relate(fam.people, a, b, fam.rootId);
    if (!rel) return;
    path = { a, b, rel };
    const you = a === me;
    $('pathTitle').textContent = FT.describe(fam.people, rel, a, b, you, fam.rootId);
    $('pathSub').textContent = rel.path.map(id => display(fam.people.get(id))).join(' → ');
    $('pathBar').hidden = false;
    applyHighlight();
    if (fit !== false) fitPath();
  }
  function clearPath() { path = null; $('pathBar').hidden = true; applyHighlight(); }
  $('pathClear').onclick = clearPath;

  function fitPath() {
    if (!path) return;
    const o = lay.opts;
    const ns = path.rel.path.map(nodeOf).filter(Boolean);
    if (!ns.length) return;
    const x0 = Math.min(...ns.map(n => n.x)) + PADX, y0 = Math.min(...ns.map(n => n.y)) + PADY;
    const x1 = Math.max(...ns.map(n => n.x)) + PADX + o.cardW, y1 = Math.max(...ns.map(n => n.y)) + PADY + o.cardH;
    fitBox(x0 - 30, y0 - 30, x1 + 30, y1 + 30, 1);
  }

  function applyHighlight() {
    const cards = $('cards'), hot = $('hotLines'), base = $('treeLines');
    if (!hot) return;
    hot.textContent = '';
    const on = !!path;
    cards.classList.toggle('highlighting', on);
    if (base) base.parentNode.classList.toggle('dim', on);
    cards.querySelectorAll('.card').forEach(c => {
      const id = c.dataset.id;
      c.classList.toggle('on-path', on && path.rel.path.includes(id));
      c.classList.toggle('end-a', on && id === path.a);
      c.classList.toggle('end-b', on && id === path.b);
    });
    if (!on) return;
    const o = lay.opts;
    const ids = path.rel.path;
    let d = '';
    for (let i = 1; i < ids.length; i++) {
      const A = nodeOf(ids[i - 1]), B = nodeOf(ids[i]);
      if (!A || !B) continue;
      const pa = fam.people.get(ids[i - 1]);
      if (pa.spouse === ids[i] && A.y === B.y) {
        const y = A.y + o.cardH / 2, ax = A.x < B.x ? A.x + o.cardW : A.x, bx = A.x < B.x ? B.x : B.x + o.cardW;
        d += `M ${ax} ${y} H ${bx} `;
      } else if (A.stacked || B.stacked) {
        const kid = A.stacked && A.gen > B.gen ? A : B, par = kid === A ? B : A;
        const pp = fam.people.get(par.id);
        const sx = pp.spouse && kid.joinX !== par.x + o.cardW / 2 ? kid.joinX : par.x + o.cardW / 2;
        const sy = sx === kid.joinX && pp.spouse ? par.y + o.cardH / 2 : par.y + o.cardH;
        d += `M ${sx} ${sy} V ${kid.busY} H ${kid.spineX} V ${kid.y + o.cardH / 2} H ${kid.x} `;
      } else {
        const top = A.y < B.y ? A : B, bot = A.y < B.y ? B : A;
        const x1 = top.x + o.cardW / 2, y1 = top.y + o.cardH, x2 = bot.x + o.cardW / 2, y2 = bot.y, my = (y1 + y2) / 2;
        d += `M ${x1} ${y1} V ${my} H ${x2} V ${y2} `;
      }
    }
    if (!d) return;
    ['glow', 'hot', 'flow'].forEach(c => hot.append(svg('path', { d, class: c })));
  }

  // ---------- find in tree ----------
  function searchPeople(q, opts) {
    const n = FT.norm(q);
    if (!n) return [];
    const words = n.split(' ');
    return [...fam.people.values()]
      .filter(p => (opts && opts.friends === false ? p.kind !== 'friend' : true))
      .map(p => {
        const hay = FT.norm(p.name + ' ' + p.badge);
        if (!words.every(w => hay.includes(w))) return null;
        const score = FT.norm(p.badge).startsWith(n) ? 0 : FT.norm(p.name).startsWith(n) ? 1 : 2;
        return { p, score };
      }).filter(Boolean).sort((a, b) => a.score - b.score || a.p.order - b.p.order).map(x => x.p);
  }
  const findBox = $('treeFind'), findList = $('treeFindList');
  findBox.addEventListener('input', () => {
    const list = searchPeople(findBox.value, { friends: false }).slice(0, 8);
    findList.textContent = '';
    if (!findBox.value.trim()) { findList.hidden = true; return; }
    if (!list.length) findList.append(el('div', { class: 'empty', text: 'Nobody by that name in the tree yet.' }));
    list.forEach(p => findList.append(el('button', { onclick: () => { findList.hidden = true; findBox.value = ''; centerOn(p.id, 1); } },
      el('b', { text: display(p) + zl(p) }), el('small', { class: 'muted', text: p.name }))));
    findList.hidden = false;
  });
  findBox.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const b = findList.querySelector('button'); if (b) b.click(); }
    if (e.key === 'Escape') { findList.hidden = true; findBox.blur(); }
  });
  document.addEventListener('click', e => { if (!findList.contains(e.target) && e.target !== findBox) findList.hidden = true; });

  // ---------- person panel ----------
  let openId = null;
  function relBox(a, b, you) {
    const rel = FT.relate(fam.people, a, b, fam.rootId);
    if (!rel || rel.kind === 'self') return null;
    const common = FT.commonLine(fam.people, rel, you);
    const chain = el('div', { class: 'chain' });
    rel.path.forEach((id, i) => {
      if (i) chain.append(el('span', { class: 'arrow', text: '→' }));
      chain.append(el('span', { class: 'chip' + (i === 0 ? ' a' : i === rel.path.length - 1 ? ' b' : ''), text: display(fam.people.get(id)) }));
    });
    return el('div', { class: 'rel-box' },
      el('p', { class: 'sentence', text: FT.describe(fam.people, rel, a, b, you, fam.rootId) }),
      common ? el('p', { class: 'sub', text: common }) : null,
      rel.note ? el('p', { class: 'sub', text: rel.note }) : null,
      rel.path.length > 1 ? chain : null,
      rel.path.length > 1 ? el('button', { class: 'btn gold', onclick: () => { closeSheet(); go('tree'); setPath(a, b); } }, '🌳 Show the line on the tree') : null);
  }

  function chips(ids) {
    return el('div', { class: 'chips' }, ids.map(id => { const p = fam.people.get(id); return el('button', { class: 'pchip', onclick: () => openPerson(id) }, display(p) + zl(p)); }));
  }

  function openPerson(id, keepScroll) {
    const p = fam.people.get(id);
    if (!p) return;
    openId = id;
    const body = $('sheetBody');
    const scroll = $('sheet').scrollTop;
    body.textContent = '';
    const root = fam.people.get(fam.rootId);
    let where = '';
    if (p.kind === 'friend') where = 'Friend of ' + display(root);
    else if (p.id === fam.rootId) where = 'Where the whole tree begins';
    else if (p.kind === 'placeholder') where = 'Not in the sheet yet';
    else if (p.otherParent) where = 'Family · parent of ' + p.otherKids.map(k => display(fam.people.get(k))).join(' & ');
    else if (p.familyGuest) where = 'Family';
    else if (root && p.gen) {
      const r = FT.relate(fam.people, fam.rootId, p.id, fam.rootId);
      where = 'Generation ' + p.gen + (r && r.kind !== 'none' && r.kind !== 'marriage' ? ' · ' + display(root) + '’s ' + (r.word || r.label) : '');
    }
    body.append(
      el('p', { class: 'eyebrow', text: where }),
      el('h2', { id: 'sheetName' }, display(p), p.memorial ? el('span', { class: 'zl', text: ' z”l' }) : null),
      el('p', { class: 'fullname', text: p.name + (p.id === me ? ' · this is you' : '') }));

    if (me && me !== id) body.append(relBox(me, id, true));
    else if (!me) {
      const sel = el('select', { 'aria-label': 'Compare with someone' },
        el('option', { value: '', text: 'How is ' + display(p) + ' related to…' }),
        [...fam.people.values()].filter(x => x.id !== id && x.kind !== 'placeholder').sort((a, b) => display(a).localeCompare(display(b)))
          .map(x => el('option', { value: x.id, text: display(x) + ' — ' + x.name })));
      const slot = el('div');
      sel.onchange = () => { slot.textContent = ''; if (sel.value) { const box = relBox(sel.value, id, false); if (box) slot.append(box); } };
      if (p.kind !== 'placeholder' && !p.memorial) body.append(el('button', { class: 'btn primary', onclick: () => { setMe(id); openPerson(id); toast('Hi ' + display(p) + '! Tap anyone to see how you’re related.'); } }, 'This is me'));
      body.append(el('div', { style: 'margin-top:14px' }, sel), slot);
    }

    const facts = el('div', { class: 'facts' });
    if (p.kind === 'friend') {
      if (p.how) facts.append(el('div', { class: 'fact' }, el('span', { text: 'How they know ' + display(root) }), el('div', { text: p.how })));
      if (p.story) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Their story' }), el('div', { class: 'story', text: p.story })));
    } else {
      if (p.parents.length) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Parents' }), chips(p.parents)));
      if (p.spouse) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Spouse' }), chips([p.spouse])));
      const sibs = new Set();
      p.parents.filter(pid => fam.people.get(pid).blood).forEach(pid => fam.people.get(pid).children.forEach(c => { if (c !== id) sibs.add(c); }));
      if (sibs.size) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Brothers & sisters' }), chips([...sibs].sort((a, b) => fam.people.get(a).order - fam.people.get(b).order))));
      const kids = new Set(p.children.concat(p.otherKids || []));
      if (kids.size) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Children' }), chips([...kids].sort((a, b) => fam.people.get(a).order - fam.people.get(b).order))));
    }
    body.append(facts);
    if (p.onTree) body.append(el('button', { class: 'btn', onclick: () => { closeSheet(); go('tree'); centerOn(id, 1); } }, 'Find on the tree'));
    if (id === me) body.append(el('button', { class: 'link', onclick: () => { closeSheet(); clearMe(); go('me'); } }, 'This isn’t me — choose someone else'));

    $('scrim').hidden = false; $('sheet').hidden = false;
    $('sheet').scrollTop = keepScroll ? scroll : 0;
    if (!keepScroll) $('sheetClose').focus();
  }
  function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; openId = null; }
  $('sheetClose').onclick = closeSheet; $('scrim').onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  // ---------- everyone ----------
  function personRow(p, tag, onclick) {
    return el('button', { class: 'person-row', onclick: onclick || (() => openPerson(p.id)) },
      el('div', { class: 'avatar' + (p.kind === 'friend' ? ' friend' : '') + (p.memorial ? ' memorial' : ''), text: initials(p), 'aria-hidden': 'true' }),
      el('div', { class: 'pr-main' }, el('b', {}, display(p) + zl(p)), el('small', { text: p.name })),
      tag ? el('span', { class: 'rel-tag', text: tag }) : null);
  }
  function shortLine(p) {
    if (p.kind === 'friend') return p.how || 'Friend';
    if (p.kind === 'placeholder') return 'Not in the sheet yet';
    if (p.otherKids && p.otherKids.length && !p.blood && !p.partner) return 'Parent of ' + p.otherKids.map(id => display(fam.people.get(id))).join(' & ');
    if (p.familyGuest) return 'Family';
    if (p.parents.length) return 'Child of ' + p.parents.map(id => display(fam.people.get(id))).join(' & ');
    if (p.spouse) return 'Married to ' + display(fam.people.get(p.spouse));
    return '';
  }
  function relTag(p) {
    if (!me) return shortLine(p);
    if (p.id === me) return 'you';
    const r = FT.relate(fam.people, me, p.id, fam.rootId);
    return r ? (r.word || r.label) : '';
  }
  function renderPeople() {
    const box = $('peopleList');
    const q = $('peopleFind').value;
    box.textContent = '';
    const list = q.trim() ? searchPeople(q) : [...fam.people.values()].sort((a, b) => a.order - b.order);
    if (!list.length) { box.append(el('p', { class: 'muted', text: 'Nobody matches "' + q + '".' })); return; }
    const groups = new Map();
    list.forEach(p => {
      const key = p.kind === 'friend' ? 'f' : p.gen ? 'g' + p.gen : 'x';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    const keys = [...groups.keys()].sort((a, b) => (a === 'f' ? 98 : a === 'x' ? 99 : +a.slice(1)) - (b === 'f' ? 98 : b === 'x' ? 99 : +b.slice(1)));
    keys.forEach(k => {
      const title = k === 'f' ? 'Friends of ' + cfg.rootTitle : k === 'x' ? 'Not linked yet' : 'Generation ' + k.slice(1) + (GEN_NAMES[k.slice(1)] ? ' · ' + GEN_NAMES[k.slice(1)] : '');
      box.append(el('h3', { class: 'group-title', text: title + ' (' + groups.get(k).length + ')' }));
      groups.get(k).sort((a, b) => (a.gen === b.gen ? a.order - b.order : 0)).forEach(p => box.append(personRow(p, relTag(p))));
    });
  }
  $('peopleFind').addEventListener('input', renderPeople);

  // ---------- me ----------
  function renderMe() {
    const box = $('meBody');
    box.textContent = '';
    if (!me) {
      box.append(el('p', { class: 'eyebrow', text: 'Welcome to ' + cfg.eventName }),
        el('h2', { class: 'hello', text: 'Who are you?' }),
        el('p', { class: 'muted', text: 'Find your name once — then every person you tap (or every badge you scan) tells you how you’re related.' }));
      const input = el('input', { type: 'search', placeholder: 'Type your name or nickname', 'aria-label': 'Your name' });
      const list = el('div', { style: 'margin-top:10px' });
      const draw = () => {
        list.textContent = '';
        const found = input.value.trim() ? searchPeople(input.value) : [];
        found.filter(p => p.kind !== 'placeholder' && !p.memorial).slice(0, 12).forEach(p => list.append(personRow(p, 'That’s me', () => { setMe(p.id); toast('Hi ' + display(p) + '!'); })));
        if (input.value.trim() && !found.length) list.append(el('p', { class: 'muted', text: 'Not in the list yet? Add yourself to the Google Sheet — you’ll appear here within a minute.' }));
      };
      input.addEventListener('input', draw);
      box.append(input, list, sheetLink());
      return;
    }
    const p = fam.people.get(me);
    box.append(el('p', { class: 'eyebrow', text: 'You are' }),
      el('h2', { class: 'hello', text: display(p) }),
      el('p', { class: 'muted', text: p.name }),
      el('div', { class: 'row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
        el('button', { class: 'btn small', onclick: () => { go('tree'); centerOn(me, 0.9); } }, 'Show me on the tree'),
        el('button', { class: 'btn small', onclick: () => { clearMe(); } }, 'Not you? Change')));

    const others = [...fam.people.values()].filter(x => x.id !== me && x.kind !== 'placeholder')
      .map(x => ({ p: x, r: FT.relate(fam.people, me, x.id, fam.rootId) }))
      .sort((a, b) => FT.closeness(a.r) - FT.closeness(b.r) || a.p.order - b.p.order);
    box.append(el('h3', { class: 'group-title', text: 'How everyone is related to you' }));
    const input = el('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search your relatives' });
    const list = el('div', { style: 'margin-top:10px' });
    const draw = () => {
      list.textContent = '';
      const n = FT.norm(input.value);
      others.filter(x => !n || FT.norm(x.p.name + ' ' + x.p.badge).includes(n)).forEach(x => list.append(personRow(x.p, x.r ? (x.r.word || x.r.label) : '')));
    };
    input.addEventListener('input', draw);
    draw();
    box.append(input, list, sheetLink());
  }
  const sheetLink = () => el('div', { class: 'card-box' }, el('h3', { text: 'Something missing or wrong?' }),
    el('p', { class: 'muted', text: 'Everything here comes from the family Google Sheet. Add or fix your row there and the tree updates on everyone’s phone within a minute.' }),
    el('a', { class: 'btn', href: `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`, target: '_blank', rel: 'noopener' }, 'Open the Google Sheet'));

  // ---------- organiser ----------
  function appUrl() {
    const saved = store.get('ft.appUrl');
    return (saved || cfg.appUrl || (location.origin + location.pathname)).replace(/index\.html$/, '');
  }
  function qrSvg(text, cell) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const wrap = document.createElement('div');
    wrap.innerHTML = q.createSvgTag({ cellSize: cell || 4, margin: 0, scalable: true });
    return wrap.firstChild;
  }
  function badgePeople() {
    return [...fam.people.values()].filter(p => p.source === 'sheet' && !p.memorial).sort((a, b) => (a.kind === b.kind ? a.order - b.order : a.kind === 'family' ? -1 : 1));
  }
  function renderOrganizer() {
    const box = $('orgBody');
    box.textContent = '';
    box.className = 'pad org';
    const url = appUrl();
    const local = /^file:|localhost|127\.0\.0\.1/.test(url);
    const urlIn = el('input', { type: 'url', value: url, 'aria-label': 'App address' });
    urlIn.onchange = () => { store.set('ft.appUrl', urlIn.value.trim()); renderOrganizer(); };
    const paper = el('select', { 'aria-label': 'Poster paper size' }, ['A3', 'A2', 'A1', 'A4'].map(s => el('option', { value: s, text: s + ' landscape' })));
    const people = badgePeople();
    const w = fam.warnings;
    box.append(
      el('p', { class: 'eyebrow', text: 'Organiser' }),
      el('h2', { text: 'Badges, posters and data check' }),
      el('div', { class: 'card-box' },
        el('h3', { text: 'The address inside every QR code' }),
        urlIn,
        local ? el('p', { style: 'color:#a3451c;font-weight:600', text: 'This is a local address — phones can’t open it. Paste the published link before printing.' }) : el('p', { class: 'muted', text: 'Guests’ phones open this address when they scan.' })),
      el('div', { class: 'card-box' },
        el('h3', { text: 'Print' }),
        el('p', { class: 'muted', text: 'Badges link to each person’s ID (FAM-014). After printing, don’t re-number or sort the sheet — new people can be added at the bottom any time.' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', onclick: printBadges }, '🏷️ Name badges (' + people.length + ')'),
          el('button', { class: 'btn', onclick: printSign }, '🪧 Table sign (one big QR)')),
        el('label', { text: 'Tree poster paper' }), paper,
        el('button', { class: 'btn', onclick: () => printPoster(paper.value) }, '🌳 Print the whole tree as a poster')),
      el('div', { class: 'card-box' },
        el('h3', { text: 'Data check (' + w.length + ')' }),
        el('p', { class: 'muted', text: 'Last read from the sheet: ' + (data && data.fetchedAt ? new Date(data.fetchedAt).toLocaleString() : 'never') + '.' }),
        w.length ? w.map(x => el('div', { class: 'warn' }, el('b', { text: x.kind }), x.text)) : el('p', { text: 'Everything in the sheet links up. 🎉' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: () => fetchLive(true) }, '↻ Read the sheet now'),
          el('a', { class: 'btn', href: `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/edit`, target: '_blank', rel: 'noopener' }, 'Open the sheet'))),
      el('p', { style: 'text-align:center;margin-top:20px' }, el('a', { class: 'link', href: '#tree' }, '← Back to the tree')));
  }

  function doPrint(cls, page, build) {
    const root = $('printRoot');
    root.textContent = '';
    build(root);
    let st = $('pageStyle');
    if (!st) { st = el('style', { id: 'pageStyle' }); document.head.append(st); }
    st.textContent = `@page { size: ${page}; margin: 8mm; }`;
    document.body.classList.add('printing', cls);
    const done = () => { document.body.classList.remove('printing', cls); root.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 150);
  }
  function printBadges() {
    const base = appUrl();
    doPrint('p-badges', 'A4 portrait', root => {
      const grid = el('div', { class: 'badges' });
      badgePeople().forEach(p => {
        const q = el('div', { class: 'q' }); q.append(qrSvg(base + '?p=' + encodeURIComponent(p.id), 4));
        let line;
        if (p.kind === 'friend') line = 'Friend of ' + cfg.rootTitle;
        else if (p.otherParent) line = p.otherKids.map(k => display(fam.people.get(k))).join(' & ') + '’s parent';
        else if (p.familyGuest) line = cfg.rootTitle + '’s family';
        else { const r = FT.relate(fam.people, fam.rootId, p.id, fam.rootId); line = p.id === fam.rootId ? 'The birthday girl!' : r && r.kind !== 'none' ? cfg.rootTitle + '’s ' + (r.word || r.label) : 'Generation ' + p.gen; }
        grid.append(el('div', { class: 'pbadge' }, q, el('div', { class: 'who' },
          el('div', { class: 'bn', text: display(p) }), el('div', { class: 'fn', text: p.name }), el('div', { class: 'gl', text: line }),
          el('div', { class: 'scan', text: 'Scan me to see how we’re related' }))));
      });
      root.append(grid);
    });
  }
  function printSign() {
    const base = appUrl();
    doPrint('p-sign', 'A4 portrait', root => {
      const q = el('div', { class: 'q' }); q.append(qrSvg(base, 8));
      root.append(el('div', { class: 'psign' }, el('h1', { text: cfg.title }),
        el('p', { text: 'Scan with your phone camera to explore the family tree — then scan anyone’s badge to see how you’re related.' }),
        q, el('div', { class: 'url', text: base })));
    });
  }
  function printPoster(size) {
    const mm = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] }[size] || [420, 297];
    const pxPerMm = 96 / 25.4;
    const pw = (mm[0] - 16) * pxPerMm, ph = (mm[1] - 16) * pxPerMm - 60;
    doPrint('p-poster', size + ' landscape', root => {
      const keepPath = path; path = null; applyHighlight();
      const W = lay.width + PADX + 60, H = lay.height + PADY + 60;
      const k = Math.min(pw / W, ph / H);
      const clone = $('stage').cloneNode(true);
      clone.removeAttribute('id');
      clone.style.transform = `scale(${k})`;
      clone.style.position = 'absolute';
      clone.querySelectorAll('.me').forEach(c => c.classList.remove('me'));
      const wrap = el('div', { class: 'pposter-wrap', style: `width:${W * k}px;height:${H * k}px;margin:0 auto` }, clone);
      root.append(el('h1', { class: 'pposter-title', text: cfg.title }), wrap);
      path = keepPath; applyHighlight();
    });
  }

  // ---------- navigation ----------
  function go(view) {
    if (view !== 'organizer' && location.hash === '#organizer') history.replaceState(null, '', location.pathname + location.search);
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v.id === 'view-' + view));
    document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
    if (view === 'organizer') renderOrganizer();
    if (view === 'tree' && lay) requestAnimationFrame(apply);
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => go(b.dataset.view)));
  function routeHash() {
    if (location.hash === '#organizer') { if (fam) go('organizer'); }
    else if (location.hash === '#tree') go('tree');
  }
  window.addEventListener('hashchange', routeHash);

  // ---------- QR scan arrival ----------
  function handleScan() {
    const params = new URLSearchParams(location.search);
    const id = (params.get('p') || params.get('id') || '').toUpperCase();
    if (location.hash === '#organizer') go('organizer');
    if (!id) return;
    history.replaceState(null, '', location.pathname + location.hash);
    const p = fam.people.get(id);
    if (!p) { toast('We couldn’t find that badge in the list — find your name instead.', 6000); go('me'); return; }
    if (!me) {
      $('welcomeEyebrow').textContent = 'Welcome to ' + cfg.eventName + '!';
      $('welcomeName').textContent = display(p);
      $('welcomeFull').textContent = p.name;
      $('welcome').hidden = false;
      $('welcomeYes').focus();
      $('welcomeYes').onclick = () => { $('welcome').hidden = true; setMe(id); go('tree'); centerOn(id, 0.9); toast('Hi ' + display(p) + '! Now scan anyone’s badge — or tap their card — to see how you’re related.', 7000); };
      $('welcomeNo').onclick = () => { $('welcome').hidden = true; openPerson(id); };
      return;
    }
    if (id === me) { toast('That’s your own badge 🙂 Scan someone else’s!'); centerOn(me, 0.9); return; }
    go('tree'); openPerson(id); setPath(me, id);
  }

  // ---------- go ----------
  $('appTitle').textContent = cfg.title;
  document.title = cfg.title;
  loadFirst();
})();
