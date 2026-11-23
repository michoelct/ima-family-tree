/* app.js — screens, tree drawing, live sheet updates, QR printing. */
(function () {
  'use strict';
  const FT = window.FT;
  const cfg = window.FT_CONFIG;
  const $ = id => document.getElementById(id);

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
  let fromSnapshot = false;          // the first copy came from the bundled snapshot, not an earlier visit
  // How the tree is drawn — chosen in the View menu and remembered separately for a phone and a bigger screen:
  // 'family' (one person in the middle), 'chart' (generations, top down), 'sun' (a circle), 'list' (a page).
  const VIEWS = {
    family: { name: 'Family', icon: '👪', text: 'One person in the middle — parents above, children and grandchildren below. Tap anyone to move to them. Best on a phone.' },
    chart: { name: 'Generations', icon: '⊤', text: 'Everyone, one row per generation, top down. Best on a big screen.' },
    sun: { name: 'Sun', icon: '☀', text: 'The whole family in one circle — ' + cfg.rootTitle + ' in the middle, each family a coloured slice.' },
    list: { name: 'List', icon: '☰', text: 'Read the family top to bottom, like a page.' }
  };
  const VIEW_DEFAULT = { phone: 'family', wide: 'chart' };
  const deviceKind = () => (window.innerWidth < 700 ? 'phone' : 'wide');
  let viewChoice = store.get('ft.view.' + deviceKind());
  // a link can open a view: ?view=family|chart|sun|list (not saved — the menu saves a choice)
  try { const v = new URLSearchParams(location.search).get('view'); if (v && VIEWS[v]) viewChoice = v; } catch (e) { /* ignore */ }
  let focusId = store.get('ft.focus');   // who the Family view is centred on (else you, else the root)
  const opt = { colours: store.get('ft.colours') !== false, news: store.get('ft.news') === true };
  const BRANCH_COLOURS = ['#2e7d6b', '#c0583b', '#3d6fb0', '#a1497e', '#b8892b', '#6b5aa8', '#4f7a2a', '#9c4a2f'];
  let branchOf = new Map(), branchColour = new Map();
  const collapsed = new Set();       // families that are closed (the descendant's id)
  let collapseReady = false;
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
        if (before && !fromSnapshot) {
          const added = [...fam.people.values()].filter(p => p.source === 'sheet' && !before.has(FT.norm(p.name))).map(display);
          if (added.length) toast((added.length === 1 ? 'Just added: ' : 'Just added: ') + added.slice(0, 4).join(', ') + (added.length > 4 ? ' and ' + (added.length - 4) + ' more' : ''));
          else if (manual) toast('Updated from the sheet.');
        }
      } else if (manual) toast('Already up to date.');
      fromSnapshot = false;
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
      try { const r = await fetch('data/snapshot.json', { cache: 'no-cache' }); if (r.ok) { data = await r.json(); fromSnapshot = true; } } catch (e) { /* offline */ }
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
    $('appSub').textContent = `${family.length} people${friends.length ? ' · ' + friends.length + ' friends' : ''} · ${gens} generations`;
  }

  // ---------- render all ----------
  function render() {
    fam = FT.buildFamily({ familyRows: data.familyRows, friendRows: data.friendRows, extras: cfg.extras, rootName: cfg.rootName, corrections: cfg.corrections, sexes: cfg.sexes });
    restoreMe();
    branchOf = FT.branchMap(fam.people, fam.rootId);
    branchColour = new Map();
    (fam.people.get(fam.rootId) ? fam.people.get(fam.rootId).children : []).slice()
      .sort((a, b) => fam.people.get(a).order - fam.people.get(b).order)
      .forEach((c, i) => branchColour.set(c, BRANCH_COLOURS[i % BRANCH_COLOURS.length]));
    renderBranchBar();
    if (!collapseReady) { collapseReady = true; defaultCollapse(currentMode()); }
    relayout();
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
    // first visit: a welcome card; once you've chosen yourself, one short tip until you've used the tree
    let helloShut = false; try { helloShut = sessionStorage.getItem('ft.helloShut') === '1'; } catch (e) { /* ignore */ }
    $('hello').hidden = !!me || helloShut;
    document.querySelector('.scan-fab').hidden = !$('hello').hidden; // the welcome card has its own scan button
    $('treeHint').hidden = !me || !!store.get('ft.tipSeen');
  }

  // ---------- layout choice ----------
  // An upright phone gets the indented list (read top to bottom, names near full size). A wider screen gets a
  // chart whose lower generations turn into indented columns at the level that fits the screen best — so the
  // view keeps working as the family grows.
  const rootGen = () => (fam && fam.people.get(fam.rootId) ? fam.people.get(fam.rootId).gen || 1 : 1);
  const colourOf = id => (branchOf.has(id) ? branchColour.get(branchOf.get(id)) : null);
  const focusFor = () => (focusId && fam.people.has(focusId) ? focusId : (me || fam.rootId));
  const readLike = () => !!lay && (lay.mode === 'list' || lay.mode === 'family'); // read at full size, scroll like a page
  // the family that sits in the middle of the chart and that the tree opens on (cfg.centerFamily: a badge or full name)
  function centreFamilyId(name) {
    const want = FT.norm(name === undefined ? (cfg.centerFamily || '') : name);
    const root = fam && fam.people.get(fam.rootId);
    if (!want || !root) return null;
    const hit = root.children.map(c => fam.people.get(c)).find(p => p && (FT.norm(p.badge) === want || FT.norm(p.name) === want));
    return hit ? hit.id : null;
  }
  // the child at the top (12 o'clock) of the Sun view (cfg.sunTop, else the centre family)
  const sunTopId = () => centreFamilyId(cfg.sunTop || cfg.centerFamily || '');
  // one shade of a branch colour per family: 0 = the colour itself, then lighter / darker in turn
  const SHADES = [0, 0.35, -0.28, 0.58, -0.45, 0.18, -0.14, 0.72];
  function shadeOf(hex, k) {
    const t = SHADES[(k || 0) % SHADES.length];
    if (!t) return hex;
    const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255];
    const m = c.map(v => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)));
    return '#' + m.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  // the family name of a set of brothers and sisters: the surname most of them share (for the Sun strips)
  function familyName(ids) {
    const n = new Map();
    ids.map(id => fam.people.get(id)).filter(Boolean).forEach(p => { const sn = surnameOf(p); n.set(sn, (n.get(sn) || 0) + 1); });
    const best = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : '';
  }
  function currentMode() { return VIEWS[viewChoice] ? viewChoice : VIEW_DEFAULT[deviceKind()]; }
  function bestChartSplit(vw, vh, hide) {
    const g0 = rootGen();
    const maxGen = Math.max(g0, ...[...fam.people.values()].map(p => p.gen || 0));
    let best = null;
    for (let s = g0 + 1; s <= maxGen + 1; s++) {
      const L = FT.layoutTree(fam.people, fam.rootId, { split: s, collapsed: hide });
      const W = L.width + L.opts.padX + L.opts.padR, H = L.height + 2 * L.opts.padY;
      const k = Math.min((vw - 40) / W, (vh - 30) / H);
      if (!best || k > best.k * 1.02) best = { s, k };
    }
    return best ? best.s : 99;
  }
  function layoutFor(mode) {
    const centerChild = centreFamilyId();
    if (mode === 'list') return FT.layoutTree(fam.people, fam.rootId, { split: rootGen(), collapsed, centerChild });
    if (mode === 'family') {
      const w = vp.getBoundingClientRect().width || window.innerWidth;
      return FT.layoutFamily(fam.people, focusFor(), { maxW: Math.max(320, Math.min(1100, w - 28)) });
    }
    if (mode === 'sun') return FT.layoutSun(fam.people, fam.rootId, { centerChild: sunTopId(), familyName });
    return FT.layoutTree(fam.people, fam.rootId, { split: 99, collapsed, centerChild });
  }
  function relayout() { lay = layoutFor(currentMode()); drawTree(); syncViewButtons(); }
  // the list reads like a page: zoom buttons step aside, Fit becomes 'Top'
  function syncZoomButtons() {
    const list = readLike();
    $('zoomIn').hidden = list; $('zoomOut').hidden = list;
    $('zoomFit').textContent = list ? 'Top' : 'Fit';
  }

  // families start closed from the grandchildren down in the list (your own line stays open); the chart shows all
  function defaultCollapse(mode) {
    collapsed.clear();
    if (mode !== 'list') return;
    const keep = new Set();
    const up = id => { const p = fam.people.get(id); if (!p || keep.has(id)) return; keep.add(id); p.parents.forEach(up); if (p.spouse && !keep.has(p.spouse)) { keep.add(p.spouse); fam.people.get(p.spouse).parents.forEach(up); } };
    if (me) up(me);
    const g0 = rootGen();
    fam.people.forEach(p => { if (p.blood && (p.gen || 0) >= g0 + 2 && p.children.length && !keep.has(p.id)) collapsed.add(p.id); });
  }
  // open every closed family above the given people, so they are on the tree
  function ensureVisible(ids) {
    let changed = false;
    if (lay && (lay.mode === 'family' || lay.mode === 'sun')) return false; // nothing is ever closed there
    for (let round = 0; round < 8; round++) {
      const missing = ids.filter(id => fam.people.has(id) && fam.people.get(id).onTree !== false && !nodeOf(id));
      if (!missing.length) break;
      const seen = new Set();
      const walk = id => { if (seen.has(id)) return; seen.add(id); if (collapsed.delete(id)) changed = true; const p = fam.people.get(id); if (!p) return; p.parents.forEach(walk); if (p.spouse) walk(p.spouse); };
      missing.forEach(walk);
      if (!changed) break;
      lay = layoutFor(currentMode());
    }
    if (changed) drawTree();
    return changed;
  }
  function toggleFamily(id) {
    const before = nodeOf(id);
    const sx = before ? t.x + (PX() + before.x) * t.k : 0, sy = before ? t.y + (PY() + before.y) * t.k : 0;
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    relayout();
    const after = nodeOf(id);
    if (before && after) { t.x = sx - (PX() + after.x) * t.k; t.y = sy - (PY() + after.y) * t.k; apply(); }
  }
  function setView(mode) {
    viewChoice = mode; store.set('ft.view.' + deviceKind(), mode);
    defaultCollapse(mode);
    lay = layoutFor(mode);
    if (path) ensureVisible(path.rel.path);
    drawTree(); syncViewButtons();
    // a chart too big to read whole starts zoomed in (readable, top of the tree) - the Fit button still shows everything
    if (path && mode !== 'family') fitPath(); else initialViewNow();
  }
  // the Family view moves to whoever you tap
  function setFocus(id) {
    if (!fam.people.has(id)) return;
    focusId = id; store.set('ft.focus', id);
    if (lay && lay.mode === 'family') { relayout(); fitAll(); }
  }
  function syncViewButtons() {
    syncZoomButtons();
    const m = lay ? lay.mode : currentMode();
    $('viewName').textContent = VIEWS[m] ? VIEWS[m].name : '';
    $('viewMenu').querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('on', b.dataset.mode === m); b.setAttribute('aria-checked', b.dataset.mode === m); });
    const anyClosed = lay && lay.toggles.some(g => g.more);
    $('openAll').hidden = !anyClosed;
    $('closeAll').hidden = anyClosed || !lay || !lay.toggles.length;
  }
  // ---------- the View menu ----------
  (function buildViewMenu() {
    const menu = $('viewMenu');
    Object.keys(VIEWS).forEach(k => menu.insertBefore(el('button', { 'data-mode': k, role: 'menuitemradio', class: 'vm-item', onclick: () => { closeViewMenu(); setView(k); } },
      el('span', { class: 'vm-icon', text: VIEWS[k].icon }), el('span', { class: 'vm-text' }, el('b', { text: VIEWS[k].name }), el('small', { text: VIEWS[k].text }))), $('viewOpts')));
    $('optColours').checked = opt.colours; $('optNews').checked = opt.news;
    $('optColours').onchange = e => { opt.colours = e.target.checked; store.set('ft.colours', opt.colours); applyLook(); drawTree(); renderBranchBar(); };
    $('optNews').onchange = e => { opt.news = e.target.checked; store.set('ft.news', opt.news); applyLook(); };
    $('viewDevice').textContent = 'Saved for this ' + (deviceKind() === 'phone' ? 'phone' : 'screen') + '.';
    $('viewBtn').onclick = e => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; $('viewBtn').setAttribute('aria-expanded', open); };
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== $('viewBtn')) closeViewMenu(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewMenu(); });
  })();
  function closeViewMenu() { $('viewMenu').hidden = true; $('viewBtn').setAttribute('aria-expanded', 'false'); }
  function applyLook() {
    document.body.classList.toggle('news', opt.news);
    document.body.classList.toggle('colours', opt.colours);
  }
  applyLook();
  // ---------- branch buttons: jump to one of the root's children's families ----------
  function renderBranchBar() {
    const bar = $('branchBar');
    bar.textContent = '';
    const root = fam && fam.people.get(fam.rootId);
    if (!root || root.children.length < 2) { bar.hidden = true; return; }
    bar.hidden = false;
    [...branchColour.keys()].forEach(id => {
      const p = fam.people.get(id);
      bar.append(el('button', { class: 'br-chip', style: opt.colours ? `--br:${branchColour.get(id)}` : null, onclick: () => goBranch(id), title: 'Show ' + display(p) + ' on the tree' },
        el('span', { class: 'br-dot' }), display(p)));
    });
  }
  function goBranch(id) {
    if (lay.mode === 'family') { setFocus(id); return; }
    centerOn(id, lay.mode === 'sun' ? 0.75 : 0.7);
  }
  $('openAll').onclick = () => { collapsed.clear(); relayout(); if (lay.mode === 'chart') initialViewNow(); };
  $('closeAll').onclick = () => { defaultCollapse('list'); if (!collapsed.size) fam.people.forEach(p => { if (p.blood && p.children.length && p.id !== fam.rootId) collapsed.add(p.id); }); relayout(); initialViewNow(); };
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!fam || !lay) return;
      // a phone turned sideways can become a 'screen': follow that screen's own choice
      const v = store.get('ft.view.' + deviceKind()); viewChoice = v;
      $('viewDevice').textContent = 'Saved for this ' + (deviceKind() === 'phone' ? 'phone' : 'screen') + '.';
      const next = layoutFor(currentMode());
      if (next.mode !== lay.mode || next.split !== lay.split || (next.mode === 'family' && next.width !== lay.width)) { lay = next; drawTree(); syncViewButtons(); if (path && lay.mode !== 'family') fitPath(); else fitAll(); }
      else if (path) fitPath();
    }, 220);
  });

  // ---------- tree ----------
  const PX = () => (lay ? lay.opts.padX : 110), PY = () => (lay ? lay.opts.padY : 36);
  function cardClass(p, n) {
    return 'card' + (p.id === fam.rootId ? ' root' : '') + (p.memorial ? ' memorial' : '') + (p.kind === 'placeholder' ? ' placeholder' : '') + (p.id === me ? ' me' : '') +
      (n && n.focus ? ' focus' : '') + (opt.colours && colourOf(p.id) ? ' br' : '');
  }

  function drawTree() {
    const o = lay.opts;
    const cards = $('cards'), lines = $('lines');
    cards.textContent = ''; lines.textContent = '';
    const PADX = PX(), PADY = PY();
    const W = stageW(), H = stageH();
    $('stage').style.width = W + 'px'; $('stage').style.height = H + 'px';
    ['list', 'family', 'sun', 'chart'].forEach(m => $('stage').classList.toggle('as-' + m, lay.mode === m));
    lines.setAttribute('width', W); lines.setAttribute('height', H);
    const g = svg('g', { transform: `translate(${PADX},${PADY})`, id: 'treeLines' });
    lay.lines.forEach(l => {
      const a = { d: l.d, class: l.cls || 'tree-line' };
      if (l.cls && l.cls.startsWith('sun-')) a.style = `--br:${opt.colours && l.branch ? shadeOf(branchColour.get(l.branch), l.shade) : '#b99aa6'}`;
      g.append(svg('path', a));
    });
    lay.marriages.forEach(m => g.append(svg('line', { x1: m.x1, x2: m.x2, y1: m.y, y2: m.y, class: 'wed' })));
    // the Sun view's family-name strips: text along a curve
    (lay.labels || []).filter(l => l.arc).forEach((l, i) => {
      const pid = 'sunArc' + i;
      g.append(svg('path', { id: pid, d: l.arc, fill: 'none', stroke: 'none' }));
      if (!l.fits) return;
      const t = svg('text', { class: 'sun-name', style: `--br:${opt.colours && l.branch ? shadeOf(branchColour.get(l.branch), l.shade) : '#b99aa6'}` });
      const tp = svg('textPath', { href: '#' + pid, startOffset: '50%', 'text-anchor': 'middle' });
      tp.textContent = l.text;
      t.append(tp); g.append(t);
    });
    lines.append(g);
    lines.append(svg('g', { transform: `translate(${PADX},${PADY})`, id: 'hotLines' }));

    lay.rows.forEach(r => cards.append(el('div', { class: 'row-label', style: `left:12px;top:${PADY + r.y + o.cardH / 2 - 8}px`, text: 'Gen ' + r.gen + (GEN_NAMES[r.gen] ? ' · ' + GEN_NAMES[r.gen] : '') })));
    lay.unlinked.forEach((u, i) => { if (i === 0) cards.append(el('div', { class: 'unlinked-label', style: `left:${PADX + u.x}px;top:${PADY + u.y}px`, text: 'Not linked to ' + cfg.rootTitle + ' yet' })); });

    (lay.labels || []).filter(l => !l.arc).forEach(l => cards.append(el('div', { class: 'sec-label', style: `left:${PADX + l.x}px;top:${PADY + l.y}px`, text: l.text })));
    if (lay.moreGrand) cards.append(el('div', { class: 'sec-label more', style: `left:${PADX + lay.width / 2}px;top:${PADY + lay.height + 10}px`, text: '+' + lay.moreGrand + ' grandchildren — tap one of the children to see their family' }));
    if (lay.mode === 'family' && lay.focus !== fam.rootId) cards.append(el('button', { class: 'up-btn', style: `left:${PADX + lay.width / 2}px;top:${PADY - 6}px`, onclick: () => setFocus(fam.rootId) }, '↑ Back to ' + display(fam.people.get(fam.rootId))));

    lay.nodes.forEach(n => {
      const p = fam.people.get(n.id);
      const label = display(p) + zl(p) + ', ' + p.name + (p.id === me ? ' (you)' : '');
      const col = opt.colours ? colourOf(p.id) : null;
      const st = `left:${PADX + n.x}px;top:${PADY + n.y}px;width:${n.w || o.cardW}px;height:${n.h || o.cardH}px` + (n.rot != null ? `;transform:rotate(${n.rot.toFixed(2)}deg)` : '') + (col ? `;--br:${col}` : '');
      const b = el('button', { class: cardClass(p, n), 'data-id': p.id, style: st, 'aria-label': label, onclick: () => tapPerson(p.id) },
        el('div', { class: 'badge' }, display(p), p.memorial ? el('span', { class: 'zl', text: 'z”l' }) : null),
        el('div', { class: 'full', text: p.kind === 'placeholder' ? p.name + ' · not in the sheet yet' : p.name }));
      cards.append(b);
    });
    // open / close a family: "+12" when closed, "−" when open
    lay.toggles.forEach(tg => {
      const p = fam.people.get(tg.id);
      const label = tg.more ? `Show ${tg.more} more in ${display(p)}’s family` : `Close ${display(p)}’s family`;
      cards.append(el('button', { class: 'tog' + (tg.more ? ' closed' : ''), style: `left:${PADX + tg.x}px;top:${PADY + tg.y}px`, 'aria-label': label, title: label,
        onclick: e => { e.stopPropagation(); toggleFamily(tg.id); } }, tg.more ? '+' + tg.more : '−'));
    });
    applyHighlight();
    apply();
  }
  const stageW = () => lay.width + PX() + lay.opts.padR;
  const stageH = () => lay.height + 2 * PY();

  function nodeOf(id) { return lay.nodes.find(n => n.id === id); }

  // ---------- pan & zoom ----------
  const vp = $('viewport'), stage = $('stage');
  function apply() {
    // the list scrolls like a page: keep it from drifting off the screen
    if (readLike()) {
      const a = visibleArea(), W = stageW() * t.k, H = stageH() * t.k;
      t.x = W <= a.w ? Math.min(Math.max(t.x, 0), a.w - W) : Math.min(Math.max(t.x, a.w - W - 8), 8);
      t.y = H <= a.h - 90 ? Math.min(Math.max(t.y, -8), a.h - H) : Math.min(Math.max(t.y, a.h - H - 90), 8 + a.top);
    }
    stage.style.transform = `translate(${t.x}px,${t.y}px) scale(${t.k})`;
  }
  // the part of the viewport not covered by the person panel or the welcome card
  function visibleArea() {
    const r = vp.getBoundingClientRect();
    const open = !$('sheet').hidden;
    const side = open && window.innerWidth >= 760 ? $('sheet').offsetWidth : 0;
    const below = open && window.innerWidth < 760 ? Math.max(0, r.bottom - $('sheet').getBoundingClientRect().top) : 0;
    const top = !$('hello').hidden ? Math.max(0, $('hello').getBoundingClientRect().bottom - r.top + 8) : 0;
    return { w: r.width - side, h: Math.max(140, r.height - below), top };
  }
  const listK = () => Math.min(1, Math.max(0.5, (visibleArea().w - 12) / stageW()));
  function clampK(k) { return Math.min(2.2, Math.max(0.08, k)); }
  function zoomAt(px, py, k) { k = clampK(k); t.x = px - (px - t.x) * (k / t.k); t.y = py - (py - t.y) * (k / t.k); t.k = k; apply(); }
  function zoomBy(f) { const r = vp.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, t.k * f); }
  function fitBox(x0, y0, x1, y1, maxK) {
    const a = visibleArea();
    const h = a.h - a.top;
    let k;
    // the list never shrinks below reading size: if the box is too tall, show its top part
    if (readLike()) k = Math.min(listK(), maxK || 1);
    else k = clampK(Math.min((a.w - 40) / (x1 - x0), (h - 30) / (y1 - y0), maxK || 1));
    t.k = k;
    t.x = (a.w - (x1 - x0) * k) / 2 - x0 * k;
    t.y = (y1 - y0) * k <= h - 30 ? a.top + (h - (y1 - y0) * k) / 2 - y0 * k : a.top + 16 - y0 * k;
    apply();
  }
  function fitAll() {
    if (readLike()) { const a = visibleArea(); t.k = listK(); t.x = lay.mode === 'list' ? 0 : Math.max(0, (a.w - stageW() * t.k) / 2); t.y = a.top + 8; apply(); return; }
    fitBox(0, 0, stageW(), stageH(), 1);
  }
  function centerOn(id, k) {
    if (lay.mode === 'family') { if (lay.focus !== id) { focusId = id; store.set('ft.focus', id); relayout(); } fitAll(); flashCard(id); return; }
    ensureVisible([id]);
    const n = nodeOf(id); if (!n) return;
    const a = visibleArea(); const o = lay.opts;
    t.k = readLike() ? listK() : clampK(k || Math.max(t.k, 0.85));
    t.x = a.w / 2 - (PX() + n.x + (n.w || o.cardW) / 2) * t.k;
    t.y = a.top + (a.h - a.top) / 2 - (PY() + n.y + (n.h || o.cardH) / 2) * t.k; apply();
    flashCard(id);
  }
  function flashCard(id) {
    const c = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
    if (c) { c.classList.remove('flash'); void c.offsetWidth; c.classList.add('flash'); }
  }
  let startT = null; // the view initialView set, so closing the welcome card can redo it if nobody has moved
  function initialView() { initialViewNow(); startT = Object.assign({}, t); }
  function initialViewNow() {
    if (lay.mode === 'family' || lay.mode === 'sun') { fitAll(); return; }
    if (me && nodeOf(me)) { centerOn(me, 0.85); return; }
    if (lay.mode === 'list') { fitAll(); return; }
    const a = visibleArea();
    if (Math.min((a.w - 40) / stageW(), (a.h - a.top - 30) / stageH()) >= 0.45) { fitAll(); return; }
    // too big to read whole: start at the top, readable, with the middle family (else Ima) in the centre
    const n = nodeOf(centreFamilyId() || fam.rootId) || nodeOf(fam.rootId); if (!n) { fitAll(); return; }
    t.k = a.w < 640 ? 0.55 : 0.7;
    t.x = a.w / 2 - (PX() + n.x + lay.opts.cardW / 2) * t.k; t.y = a.top + 12; apply();
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
    if (e.ctrlKey || (mouseWheel && !readLike())) zoomAt(e.clientX - r.left, e.clientY - r.top, t.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
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
  $('zoomFit').title = 'Show the whole view';
  $('helloX').onclick = () => { $('hello').hidden = true; document.querySelector('.scan-fab').hidden = false;
    // the welcome card is gone: if the view is still where it opened, open it again without the card's space
    if (startT && startT.x === t.x && startT.y === t.y && startT.k === t.k) initialView(); else apply(); try { sessionStorage.setItem('ft.helloShut', '1'); } catch (e) { /* ignore */ } };
  $('helloFind').onclick = () => go('me');
  const tipSeen = () => { if (!$('treeHint').hidden) { $('treeHint').hidden = true; store.set('ft.tipSeen', true); } };
  $('hintX').onclick = tipSeen;

  // ---------- highlighted line ----------
  function setPath(a, b, fit) {
    const rel = FT.relate(fam.people, a, b, fam.rootId);
    if (!rel) return;
    path = { a, b, rel };
    const you = a === me;
    $('pathTitle').textContent = FT.describe(fam.people, rel, a, b, you, fam.rootId);
    $('pathSub').textContent = rel.path.map(id => display(fam.people.get(id))).join(' → ');
    $('pathBar').hidden = false;
    ensureVisible(rel.path);
    applyHighlight();
    if (fit !== false && lay.mode !== 'family') fitPath();
  }
  function clearPath() { path = null; $('pathBar').hidden = true; applyHighlight(); }
  $('pathClear').onclick = clearPath;

  function fitPath() {
    if (!path) return;
    const o = lay.opts;
    const ns = path.rel.path.map(nodeOf).filter(Boolean);
    if (!ns.length) return;
    if (readLike()) {
      // the list keeps reading size; if the whole line does not fit, show the other person in the middle
      const a = visibleArea(), k = listK();
      const top = Math.min(...ns.map(n => n.y)), bot = Math.max(...ns.map(n => n.y)) + o.cardH;
      if ((bot - top + 40) * k > a.h - a.top) {
        const b = nodeOf(path.b) || ns[ns.length - 1];
        t.k = k; t.x = 0; t.y = a.top + (a.h - a.top) / 2 - (PY() + b.y + o.cardH / 2) * k; apply(); return;
      }
    }
    const x0 = Math.min(...ns.map(n => n.x)) + PX(), y0 = Math.min(...ns.map(n => n.y)) + PY();
    const x1 = Math.max(...ns.map(n => n.x)) + PX() + o.cardW, y1 = Math.max(...ns.map(n => n.y)) + PY() + o.cardH;
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
    const straight = lay.mode === 'sun' || lay.mode === 'family';
    const mid = n => [n.x + (n.w || o.cardW) / 2, n.y + (n.h || o.cardH) / 2];
    for (let i = 1; i < ids.length; i++) {
      const A = nodeOf(ids[i - 1]), B = nodeOf(ids[i]);
      if (!A || !B) continue;
      if (straight) { const [ax, ay] = mid(A), [bx, by] = mid(B); d += `M ${ax} ${ay} L ${bx} ${by} `; continue; }
      const pa = fam.people.get(ids[i - 1]);
      if (pa.spouse === ids[i] && A.y === B.y) {
        const y = A.y + o.cardH / 2, ax = A.x < B.x ? A.x + o.cardW : A.x, bx = A.x < B.x ? B.x : B.x + o.cardW;
        d += `M ${ax} ${y} H ${bx} `;
      } else if ((A.fromX != null && A.gen > B.gen) || (B.fromX != null && B.gen > A.gen)) {
        const kid = A.gen > B.gen ? A : B;
        if (kid.stacked) d += `M ${kid.fromX} ${kid.fromY} V ${kid.busY} H ${kid.spineX} V ${kid.y + o.cardH / 2} H ${kid.x} `;
        else d += `M ${kid.fromX} ${kid.fromY} V ${kid.busY} H ${kid.x + o.cardW / 2} V ${kid.y} `;
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
    const chain = ladder(rel.path, you);
    return el('div', { class: 'rel-box' },
      el('p', { class: 'sentence', text: FT.describe(fam.people, rel, a, b, you, fam.rootId) }),
      common ? el('p', { class: 'sub', text: common }) : null,
      rel.note ? el('p', { class: 'sub', text: rel.note }) : null,
      rel.path.length > 1 ? chain : null,
      rel.path.length > 1 ? el('button', { class: 'btn gold', onclick: () => { closeSheet(); go('tree'); setPath(a, b); } }, '🌳 See the whole line') : null);
  }

  /**
   * A small family ladder for the panel: the person at the top of the line, and the two branches
   * running down to A (left) and B (right). Readable on a phone even when the two are far apart on the tree.
   */
  function ladder(path, you) {
    const P = id => fam.people.get(id);
    let top = 0;
    path.forEach((id, i) => { const g = P(id).gen, tg = P(path[top]).gen; if (g != null && (tg == null || g < tg)) top = i; });
    const left = path.slice(0, top).reverse();   // from the top down to A
    const right = path.slice(top + 1);            // from the top down to B
    const node = (id, cls) => {
      const p = P(id);
      const label = id === path[0] && you ? 'You' : display(p);
      return el('div', { class: 'lad-node ' + (cls || '') }, el('b', { text: label + (p.memorial ? ' z\u201dl' : '') }),
        id === path[0] && you ? null : el('small', { text: p.name.split(' ')[0] === label ? '' : p.name.split(' ')[0] }));
    };
    // a husband or wife stands beside their partner, not under them like a child
    const isCouple = (x, y) => x && y && P(x).spouse === y;
    const leg = (ids, cls) => {
      const rows = [];
      for (let i = 0; i < ids.length; i++) {
        const c = i === ids.length - 1 ? cls : '';
        if (isCouple(ids[i], ids[i + 1])) {
          const last = i + 1 === ids.length - 1;
          rows.push(el('div', { class: 'lad-pair' }, node(ids[i], ''), el('span', { class: 'lad-wed', 'aria-hidden': 'true' }), node(ids[i + 1], last ? cls : '')));
          i++;
        } else rows.push(node(ids[i], c));
      }
      return el('div', { class: 'lad-leg' }, rows);
    };
    // the line into a couple bends to the family member's card (Esti), not to the middle of the pair
    const bend = () => box.querySelectorAll('.lad-pair').forEach(pair => {
      const pr = pair.getBoundingClientRect(), fb = pair.firstElementChild.getBoundingClientRect();
      if (!pr.width) return;
      const c = pr.width / 2, b = fb.left - pr.left + fb.width / 2;
      pair.style.setProperty('--l', Math.min(c, b) + 'px');
      pair.style.setProperty('--w', Math.abs(c - b) + 'px');
    });
    const box = el('div', { class: 'ladder', 'aria-label': 'How the line runs' });
    box.append(node(path[top], top === 0 ? 'a' : top === path.length - 1 ? 'b' : 'apex'));
    if (left.length || right.length) {
      const legs = el('div', { class: 'lad-legs' + (left.length && right.length ? ' two' : '') });
      if (left.length) legs.append(leg(left, 'a'));
      if (right.length) legs.append(leg(right, 'b'));
      box.append(legs);
    }
    if (box.querySelector('.lad-pair')) {
      requestAnimationFrame(bend); setTimeout(bend, 60);
      if (window.ResizeObserver) new ResizeObserver(bend).observe(box);
    }
    return box;
  }

  function chips(ids) {
    return el('div', { class: 'chips' }, ids.map(id => { const p = fam.people.get(id); return el('button', { class: 'pchip', onclick: () => showPerson(id) }, display(p) + zl(p)); }));
  }

  const onTreeView = () => $('view-tree').classList.contains('on');
  /** Tapping someone: open their panel and, if we know who you are, light up the line between you at once. */
  /** From a list or a name chip: same as scanning their badge — go to the tree and light up the line. */
  function showPerson(id) {
    if (me && id !== me) go('tree');
    tapPerson(id);
  }
  function tapPerson(id) {
    tipSeen();
    if (lay && lay.mode === 'family' && id !== lay.focus && onTreeView()) {
      setFocus(id);
      if (me && id !== me) setPath(me, id, false); else clearPath();
      return;
    }
    openPerson(id);
    if (me && id !== me) setPath(me, id);
    else if (id === me) clearPath();
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
    else if (p.otherParent) where = 'Family · ' + FT.gx('parent', p.sex) + ' of ' + p.otherKids.map(k => display(fam.people.get(k))).join(' & ');
    else if (p.familyGuest) where = 'Family';
    else if (p.stepOf) { const par = fam.people.get(p.stepOf); where = 'Generation ' + p.gen + ' · ' + display(fam.people.get(par.spouse)) + ' & ' + display(par) + '\u2019s family'; }
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
      sel.onchange = () => {
        slot.textContent = '';
        if (!sel.value) return clearPath();
        const box = relBox(sel.value, id, false); if (box) slot.append(box);
        if (onTreeView()) setPath(sel.value, id);
      };
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
      p.parents.forEach(pid => fam.people.get(pid).children.forEach(c => { if (c !== id) sibs.add(c); }));
      if (sibs.size) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Brothers & sisters' }), chips([...sibs].sort((a, b) => fam.people.get(a).order - fam.people.get(b).order))));
      const kids = new Set(p.children.concat(p.otherKids || []));
      if (kids.size) facts.append(el('div', { class: 'fact' }, el('span', { text: 'Children' }), chips([...kids].sort((a, b) => fam.people.get(a).order - fam.people.get(b).order))));
    }
    body.append(facts);
    if (p.onTree) body.append(el('button', { class: 'btn', onclick: () => { closeSheet(); go('tree'); centerOn(id, 1); } }, 'Find on the tree'));
    if (id === me) body.append(el('button', { class: 'link', onclick: () => { closeSheet(); clearMe(); go('me'); } }, 'This isn’t me — choose someone else'));

    // on the tree the backdrop stays see-through, so the lit-up line is visible above the panel
    $('scrim').classList.toggle('clear', onTreeView());
    $('scrim').hidden = false; $('sheet').hidden = false;
    $('sheet').scrollTop = keepScroll ? scroll : 0;
    if (!keepScroll) $('sheetClose').focus();
  }
  function closeSheet() { $('sheet').hidden = true; $('scrim').hidden = true; openId = null; }
  $('sheetClose').onclick = closeSheet; $('scrim').onclick = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('sheet').hidden) closeSheet(); });

  // ---------- everyone ----------
  function personRow(p, tag, onclick) {
    return el('button', { class: 'person-row', onclick: onclick || (() => showPerson(p.id)) },
      el('div', { class: 'avatar' + (p.kind === 'friend' ? ' friend' : '') + (p.memorial ? ' memorial' : ''), text: initials(p), 'aria-hidden': 'true' }),
      el('div', { class: 'pr-main' }, el('b', {}, display(p) + zl(p)), el('small', { text: p.name })),
      tag ? el('span', { class: 'rel-tag', text: tag }) : null);
  }
  function shortLine(p) {
    if (p.kind === 'friend') return p.how || 'Friend';
    if (p.kind === 'placeholder') return 'Not in the sheet yet';
    if (p.otherKids && p.otherKids.length && !p.blood && !p.partner) return (p.sex === 'f' ? 'Mother' : p.sex === 'm' ? 'Father' : 'Parent') + ' of ' + p.otherKids.map(id => display(fam.people.get(id))).join(' & ');
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
        el('button', { class: 'btn small', onclick: () => { clearMe(); } }, 'Not you? Change')),
      el('button', { class: 'btn primary', onclick: () => openScanner() }, '📷 Scan a badge'));

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
  /** A QR code as one small SVG: each row's dark run is one rectangle (about a quarter of the
   *  library's one-square-per-dot drawing), so 100+ badges print quickly. */
  function qrSvg(text) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n;) {
        if (!q.isDark(y, x)) { x++; continue; }
        const s = x; while (x < n && q.isDark(y, x)) x++;
        d += 'M' + s + ' ' + y + 'h' + (x - s) + 'v1h' + (s - x) + 'z';
      }
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + n + ' ' + n);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
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
    const paper = el('select', { 'aria-label': 'Poster paper size' }, ['A3', 'A2', 'A1', 'A4'].map(s => el('option', { value: s, text: s })));
    const pstyle = el('select', { 'aria-label': 'Poster style' },
      el('option', { value: 'sun', text: 'Sun — the whole family in one circle (best for a wall)' }),
      el('option', { value: 'chart', text: 'Generations — one row per generation' }));
    pstyle.value = store.get('ft.posterStyle') || 'sun';
    pstyle.onchange = () => store.set('ft.posterStyle', pstyle.value);
    const style = el('select', { 'aria-label': 'Badge style' },
      el('option', { value: 'news', text: 'Newspaper style — to slide into badge holders' }),
      el('option', { value: 'press', text: 'Press pass — a reporter’s badge from the same newspaper' }),
      el('option', { value: 'plain', text: 'Plain — cut out or stick on' }));
    style.value = store.get('ft.badgeStyle') || 'news';
    const mast = el('select', { 'aria-label': 'Name at the top of the badge' },
      el('option', { value: 'all', text: (cfg.newspaper && cfg.newspaper.masthead || 'The Family Journal') + ' — the same on every badge' }),
      el('option', { value: 'own', text: 'Each person’s own family name — e.g. “The Worch Family Journal”' }));
    mast.value = store.get('ft.badgeMast') || 'all';
    mast.onchange = () => store.set('ft.badgeMast', mast.value);
    const num = (v, d) => { const n = parseFloat(v); return n >= 40 && n <= 150 ? n : d; };
    const bw = el('input', { type: 'number', min: 40, max: 150, step: 1, value: store.get('ft.badgeW') || 90, 'aria-label': 'Badge width in mm' });
    const bh = el('input', { type: 'number', min: 40, max: 150, step: 1, value: store.get('ft.badgeH') || 64, 'aria-label': 'Badge height in mm' });
    const sizeRow = el('div', { class: 'row size-row' }, el('span', { text: 'Card size' }), bw, el('span', { text: '×' }), bh, el('span', { text: 'mm (width × height)' }));
    const showSize = () => { sizeRow.hidden = style.value === 'plain'; };
    style.onchange = () => { store.set('ft.badgeStyle', style.value); showSize(); };
    bw.onchange = () => store.set('ft.badgeW', String(num(bw.value, 90)));
    bh.onchange = () => store.set('ft.badgeH', String(num(bh.value, 64)));
    showSize();
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
        el('label', { text: 'Badge style' }), style, sizeRow,
        el('label', { text: 'Newspaper name on the badges' }), mast,
        el('p', { class: 'muted', text: 'Measure the clear slot inside one holder (below the zip strip) and set the card 2–3 mm smaller each way. Print one page and slide a card in before printing them all.' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn primary', onclick: () => printBadges(style.value, num(bw.value, 90), num(bh.value, 64), mast.value) }, '🏷️ Name badges (' + people.length + ')'),
          el('button', { class: 'btn', onclick: () => printSign(style.value, mast.value, false) }, '🪧 Table sign (one big QR)'),
          el('button', { class: 'btn', onclick: () => printSign(style.value, mast.value, true) }, '🪧 A sign for each family name (' + familyNameGroups().length + ')')),
        el('p', { class: 'muted', text: 'The signs use the same style as the badges. “A sign for each family name” makes one page per surname on the badges — e.g. The Fass Family Journal — for family tables.' }),
        el('label', { text: 'Tree poster' }), pstyle,
        el('label', { text: 'Paper' }), paper,
        el('button', { class: 'btn', onclick: () => printPoster(paper.value, pstyle.value) }, '🌳 Print the whole tree as a poster')),
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
    const classes = ['printing'].concat(cls.split(/\s+/).filter(Boolean));
    document.body.classList.add(...classes);
    const done = () => { document.body.classList.remove(...classes); root.textContent = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    // wait for the badge fonts, so the print preview is not redrawn when they arrive
    const fonts = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 3000))]) : Promise.resolve();
    fonts.then(() => setTimeout(() => window.print(), 100));
  }
  /** The line under a badge name: how this person belongs to the birthday girl. */
  function badgeLine(p) {
    if (p.kind === 'friend') return 'Friend of ' + cfg.rootTitle;
    if (p.otherParent) return p.otherKids.map(k => display(fam.people.get(k))).join(' & ') + '’s ' + FT.gx('parent', p.sex);
    if (p.stepOf) { const par = fam.people.get(p.stepOf); return display(fam.people.get(par.spouse)) + ' & ' + display(par) + '’s family'; }
    if (p.familyGuest) return cfg.rootTitle + '’s family';
    const r = FT.relate(fam.people, fam.rootId, p.id, fam.rootId);
    return p.id === fam.rootId ? 'The birthday girl!' : r && r.kind !== 'none' ? cfg.rootTitle + '’s ' + (r.word || r.label) : 'Generation ' + p.gen;
  }
  /** Name badges. 'news' = newspaper cards cut to the badge-holder slot (wMm x hMm); 'plain' = the original sheet. */
  /** The family name a person goes by: the last word of their name that the parents or spouse also carry
   *  (some rows add a nickname at the end), so a married woman gets her married name. */
  function surnameOf(p) {
    const cap = w => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);
    const words = p.name.split(' ');
    const kinWords = p.parents.concat(p.spouse ? [p.spouse] : [], p.children).map(id => fam.people.get(id)).filter(Boolean)
      .reduce((all, k) => all.concat(k.name.split(' ')), []);
    const same = words.slice().reverse().find(w => kinWords.some(k => FT.norm(k) === FT.norm(w)));
    if (same) return cap(same);
    // a one-letter slip in the sheet (Raninovitz / Rabinovitz): use the husband's, wife's or parents' spelling
    for (const w of words.slice().reverse()) {
      const near = kinWords.find(k => FT.norm(w).length > 4 && FT.lev(FT.norm(k), FT.norm(w)) <= 1);
      if (near) return cap(near);
    }
    return cap(words[words.length - 1]);
  }
  function printBadges(style, wMm, hMm, mastMode) {
    const base = appUrl();
    const news = style !== 'plain';
    const np = cfg.newspaper || {};
    const journal = p => (mastMode === 'own' ? 'The ' + surnameOf(p) + ' Family Journal' : (np.masthead || 'The Family Journal'));
    // a long family name shrinks the masthead so it stays on one line
    const mastFit = t => `font-size:calc(15pt * var(--k) * ${Math.min(1, 24 / Math.max(24, t.length)).toFixed(3)})`;
    doPrint(news ? 'p-badges p-news' : 'p-badges', 'A4 portrait', root => {
      const grid = el('div', { class: news ? 'nbadges' : 'badges' });
      if (news) {
        grid.style.gridTemplateColumns = `repeat(${Math.max(1, Math.floor(194 / wMm))}, ${wMm}mm)`;
        grid.style.setProperty('--k', String(Math.min(wMm / 94, hMm / 68)));
      }
      badgePeople().forEach(p => {
        const q = el('div', { class: 'q' }); q.append(qrSvg(base + '?p=' + encodeURIComponent(p.id), 4));
        const line = badgeLine(p);
        if (!news) {
          const pc = colourOf(p.id);
          grid.append(el('div', { class: 'pbadge' + (pc ? ' br' : ''), style: pc ? `--br:${pc}` : null }, q, el('div', { class: 'who' },
            el('div', { class: 'jn', text: journal(p) }),
            el('div', { class: 'bn', text: display(p) }), el('div', { class: 'fn', text: p.name }), el('div', { class: 'gl', text: line }),
            el('div', { class: 'scan', text: 'Scan me to see how we’re related' }))));
          return;
        }
        const nm = display(p);
        const size = nm.length > 16 ? 's3' : nm.length > 11 ? 's2' : nm.length > 7 ? 's1' : '';
        const bc = colourOf(p.id);
        if (style === 'press') {
          // the press pass the family chose: navy PRESS bar, red rule, the name in big bold letters, a big QR code
          const surname = surnameOf(p);
          const first = nm.split(' ').includes(surname) ? nm.replace(new RegExp('\\s*' + surname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), '') || nm : nm;
          const longest = Math.max(first.length, surname.length);
          const fit = longest > 13 ? 'f3' : longest > 10 ? 'f2' : longest > 7 ? 'f1' : '';
          grid.append(el('div', { class: 'nbadge press', style: `width:${wMm}mm;height:${hMm}mm` + (bc ? `;--br:${bc}` : '') },
            el('div', { class: 'pbar' }, el('div', { text: 'PRESS' }), el('div', { class: 'pjournal', text: journal(p) })),
            el('div', { class: 'prule' }),
            el('div', { class: 'pbody' },
              el('div', { class: 'pname ' + fit }, el('span', { text: first }), surname && surname !== first ? el('span', { text: surname }) : null,
                el('small', { text: line })),
              el('div', { class: 'pq' }, q))));
          return;
        }
        grid.append(el('div', { class: 'nbadge', style: `width:${wMm}mm;height:${hMm}mm` + (bc ? `;--br:${bc}` : '') },
          bc ? el('div', { class: 'bstripe' }) : null,
          el('div', { class: 'mast', style: mastFit(journal(p)), text: journal(p) }),
          el('div', { class: 'dateline' },
            el('span', { text: np.date || (np.volume || 'Vol. I') }),
            el('span', { text: np.occasion || np.edition || 'Special Birthday Edition' })),
          el('div', { class: 'nbody' },
            el('div', { class: 'ncol' },
              el('div', { class: 'kicker', text: p.id === fam.rootId ? 'Front page' : 'Meet' }),
              el('div', { class: 'head ' + size, text: nm }),
              nm !== p.name ? el('div', { class: 'full', text: p.name }) : null,
              el('div', { class: 'rel', text: line })),
            el('div', { class: 'qcol' }, q, el('div', { class: 'cap', text: 'Scan me — see how we’re related' }))),
          el('div', { class: 'ribbon', text: np.ribbon || ('Happy Birthday, ' + cfg.rootTitle + '!') })));
      });
      root.append(grid);
    });
  }
  /** The table sign: a newspaper front page with one big QR code, matching the badges. */
  // The colour key, said gently: the four colours are simply Ima's children (never "<name>'s family").
  function colourKey() {
    if (!branchColour.size) return null;
    return el('div', { class: 'key' }, el('b', { text: 'The colour on each badge: ' + cfg.rootTitle + '’s children' }),
      el('div', {}, [...branchColour.keys()].map(id => el('span', { style: `--br:${branchColour.get(id)}` }, el('i'), display(fam.people.get(id))))));
  }
  // the family names on the badges, grouped by surname (a married woman under her married name)
  function familyNameGroups() {
    const g = new Map();
    badgePeople().filter(p => p.kind !== 'friend').forEach(p => { const n = surnameOf(p), k = FT.norm(n); if (!g.has(k)) g.set(k, { name: n, people: [] }); g.get(k).people.push(p); });
    return [...g.values()];
  }
  /**
   * The table sign, in the same style as the badges (newspaper, press pass or plain).
   * perFamily: one sign for each family name on the badges, e.g. "The Fass Family Journal" (by surname, so
   * nobody is singled out).
   */
  function printSign(style, mastMode, perFamily) {
    const base = appUrl();
    const np = cfg.newspaper || {};
    const date = [np.date, np.occasion].filter(Boolean).join(' · ');
    const groups = perFamily ? familyNameGroups() : [null];
    const allNames = familyNameGroups().map(g => g.name);
    const rainbow = [...branchColour.values()];
    const ruleBg = list => (list.length > 1 ? `linear-gradient(90deg, ${list.map((c, i) => `${c} ${i / list.length * 100}%, ${c} ${(i + 1) / list.length * 100}%`).join(', ')})` : list[0] || '#d3202a');
    doPrint('p-sign', 'A4 portrait', root => {
      groups.forEach(g => {
        const q = el('div', { class: 'q' }); q.append(qrSvg(base));
        const title = g ? 'The ' + g.name + ' Family Journal' : (mastMode === 'own' ? (np.masthead || 'The Family Journal') : (np.masthead || 'The Family Journal'));
        // one family's colour when everyone with that name is in one branch, else every colour
        const cols = g ? [...new Set(g.people.map(p => colourOf(p.id)).filter(Boolean))] : rainbow;
        const names = g ? 'In this edition: ' + g.people.map(display).join(' · ')
          : (mastMode === 'own' && allNames.length > 1 ? 'Today’s editions: ' + allNames.join(' · ') : '');
        const steps = el('div', { class: 'cols' },
          el('div', { class: 'step' }, el('b', { text: '1' }), el('span', { text: 'Open your phone camera and point it at the code.' })),
          el('div', { class: 'step' }, el('b', { text: '2' }), el('span', { text: 'Find your name — or scan your own badge.' })),
          el('div', { class: 'step' }, el('b', { text: '3' }), el('span', { text: 'Scan anyone’s badge to see how you’re related.' })));
        const fitTitle = t => ({ style: `--fit:${Math.min(1, 24 / Math.max(24, t.length)).toFixed(3)}` });
        if (style === 'press') {
          root.append(el('div', { class: 'psign press' },
            el('div', { class: 'pbar' }, el('div', { class: 'pword', text: 'PRESS' }), el('div', { class: 'pjournal', text: title })),
            el('div', { class: 'prule', style: `background:${ruleBg(cols)}` }),
            el('div', { class: 'head', text: 'Press check-in' }),
            el('div', { class: 'sub', text: date }),
            names ? el('div', { class: 'names', text: names }) : null,
            steps, q,
            el('div', { class: 'url', text: base }),
            g ? null : colourKey(),
            el('div', { class: 'pfoot', text: np.ribbon || ('Happy Birthday, ' + cfg.rootTitle + '!') })));
        } else if (style === 'plain') {
          root.append(el('div', { class: 'psign plain' },
            el('h1', { text: g ? title : cfg.title }),
            el('p', { class: 'sub', text: date }),
            names ? el('div', { class: 'names', text: names }) : null,
            steps, q,
            el('div', { class: 'url', text: base }),
            g ? null : colourKey()));
        } else {
          root.append(el('div', { class: 'psign' },
            el('div', Object.assign({ class: 'mast', text: title }, fitTitle(title))),
            cols.length ? el('div', { class: 'srule', style: `background:${ruleBg(cols)}` }) : null,
            el('div', { class: 'dateline' },
              el('span', { text: np.volume || 'Vol. I' }),
              el('span', { text: np.edition || 'Special Birthday Edition' }),
              el('span', { text: np.date || '' })),
            el('div', { class: 'head', text: 'Extra! Extra! Meet the family' }),
            el('div', { class: 'sub', text: [np.occasion, cfg.subtitle].filter(Boolean).join(' · ') }),
            names ? el('div', { class: 'names', text: names }) : null,
            steps, q,
            el('div', { class: 'url', text: base }),
            g ? null : colourKey(),
            el('div', { class: 'ribbon', text: np.ribbon || ('Happy Birthday, ' + cfg.rootTitle + '!') })));
        }
      });
    });
  }
  function printPoster(size, style) {
    const mm = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594] }[size] || [420, 297];
    const pxPerMm = 96 / 25.4;
    // the poster always shows everyone; pick the paper direction (and chart shape) that print the cards largest
    let best = null;
    [['landscape', mm[0], mm[1]], ['portrait', mm[1], mm[0]]].forEach(([dir, w, h]) => {
      const pw = (w - 16) * pxPerMm, ph = (h - 16) * pxPerMm - 60;
      const L = style === 'sun' ? FT.layoutSun(fam.people, fam.rootId, { centerChild: sunTopId(), familyName })
        : FT.layoutTree(fam.people, fam.rootId, { split: bestChartSplit(pw + 40, ph + 30, new Set()), centerChild: centreFamilyId() });
      const W = L.width + L.opts.padX + L.opts.padR, H = L.height + 2 * L.opts.padY;
      const k = Math.min(pw / W, ph / H);
      if (!best || k > best.k) best = { dir, L, W, H, k };
    });
    doPrint('p-poster', size + ' ' + best.dir, root => {
      const keepPath = path, keepLay = lay, keepT = Object.assign({}, t);
      path = null; lay = best.L; drawTree();
      const clone = $('stage').cloneNode(true);
      clone.removeAttribute('id');
      clone.style.transform = `scale(${best.k})`;
      clone.style.position = 'absolute';
      clone.querySelectorAll('.me').forEach(c => c.classList.remove('me'));
      clone.querySelectorAll('.tog').forEach(c => c.remove());
      // the family-name curves need ids of their own, or the names follow the hidden on-screen tree and vanish on paper
      clone.querySelectorAll('[id]').forEach(n => { n.id = 'pp-' + n.id; });
      clone.querySelectorAll('textPath').forEach(tp => tp.setAttribute('href', '#pp-' + tp.getAttribute('href').slice(1)));
      const wrap = el('div', { class: 'pposter-wrap', style: `width:${best.W * best.k}px;height:${best.H * best.k}px;margin:0 auto` }, clone);
      root.append(el('h1', { class: 'pposter-title', text: cfg.title }), wrap);
      if (opt.colours && branchColour.size) root.append(el('div', { class: 'pposter-key' }, el('b', { text: cfg.rootTitle + '’s children:' }), [...branchColour.keys()].map(id =>
        el('span', { style: `--br:${branchColour.get(id)}` }, el('i'), display(fam.people.get(id))))));
      lay = keepLay; path = keepPath; drawTree(); t = keepT; apply();
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
    arriveAt(id);
  }

  /** A badge was scanned (phone camera or the in-app scanner). */
  function arriveAt(id) {
    const p = fam.people.get(id);
    if (!p) { toast('We couldn’t find that badge in the list — find your name instead.', 6000); go('me'); return; }
    if (!me) {
      $('welcomeEyebrow').textContent = 'Welcome to ' + cfg.eventName + '!';
      $('welcomeName').textContent = display(p);
      $('welcomeFull').textContent = p.name;
      $('welcome').hidden = false;
      $('welcomeYes').focus();
      $('welcomeYes').onclick = () => { $('welcome').hidden = true; setMe(id); go('tree'); centerOn(id, 0.9); toast('Hi ' + display(p) + '! Now tap “Scan a badge” — or anyone’s card — to see how you’re related.', 7000); };
      $('welcomeNo').onclick = () => { $('welcome').hidden = true; openPerson(id); };
      return;
    }
    if (id === me) { go('tree'); toast('That’s your own badge 🙂 Scan someone else’s!'); centerOn(me, 0.9); return; }
    go('tree'); openPerson(id); setPath(me, id);
  }

  // ---------- in-app badge scanner ----------
  // Uses the phone's built-in QR reader where there is one (Android Chrome), else jsQR (iPhone Safari).
  // jsQR is loaded only when the scanner is first opened, so the page stays light.
  const scan = { stream: null, timer: null, detector: null, canvas: null, busy: false };

  function loadJsQR() {
    if (window.jsQR) return Promise.resolve();
    return new Promise((ok, fail) => {
      const s = document.createElement('script');
      s.src = 'js/vendor/jsQR.js?v=1';
      s.onload = ok; s.onerror = () => fail(new Error('reader'));
      document.head.append(s);
    });
  }

  /** The Person ID inside a scanned code, or '' if it isn't one of our badges. */
  function badgeIdFrom(text) {
    try {
      const u = new URL(text, location.href);
      const id = (u.searchParams.get('p') || u.searchParams.get('id') || '').toUpperCase();
      return id;
    } catch (e) { return ''; }
  }

  async function openScanner() {
    closeSheet();
    $('scanner').hidden = false;
    $('scanMsg').textContent = 'Starting the camera…';
    $('scanHelp').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return scanFailed('This browser can’t open the camera.');
    try {
      scan.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      return scanFailed(e && e.name === 'NotAllowedError' ? 'The camera wasn’t allowed.' : 'The camera couldn’t be opened.');
    }
    if ($('scanner').hidden) return stopScanner(); // closed while the permission question was up
    const v = $('scanVideo');
    v.srcObject = scan.stream;
    try { await v.play(); } catch (e) { /* iOS starts it on the next frame */ }
    if ('BarcodeDetector' in window) {
      try { scan.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { scan.detector = null; }
    }
    if (!scan.detector) {
      try { await loadJsQR(); } catch (e) { return scanFailed('The badge reader didn’t load — check the internet connection.'); }
    }
    $('scanMsg').textContent = 'Point at the QR code on a badge';
    tick();
  }

  async function tick() {
    if ($('scanner').hidden) return;
    const v = $('scanVideo');
    if (!scan.busy && v.readyState >= 2 && v.videoWidth) {
      scan.busy = true;
      try {
        let text = '';
        if (scan.detector) {
          const codes = await scan.detector.detect(v);
          if (codes.length) text = codes[0].rawValue;
        } else {
          const c = scan.canvas || (scan.canvas = document.createElement('canvas'));
          const w = 480, h = Math.round(v.videoHeight * (w / v.videoWidth));
          c.width = w; c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(v, 0, 0, w, h);
          const img = g.getImageData(0, 0, w, h);
          const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
          if (code) text = code.data;
        }
        if (text) {
          const id = badgeIdFrom(text);
          if (id && fam.people.has(id)) { if (navigator.vibrate) navigator.vibrate(60); stopScanner(); arriveAt(id); return; }
          $('scanMsg').textContent = id ? 'That badge isn’t in the family list yet.' : 'That’s not a family badge — try another.';
        }
      } catch (e) { /* a bad frame — keep going */ }
      scan.busy = false;
    }
    scan.timer = setTimeout(tick, 150);
  }

  function scanFailed(msg) {
    $('scanMsg').textContent = msg;
    $('scanHelp').hidden = false;
  }

  function stopScanner() {
    clearTimeout(scan.timer);
    scan.busy = false;
    if (scan.stream) scan.stream.getTracks().forEach(t => t.stop());
    scan.stream = null;
    $('scanVideo').srcObject = null;
    $('scanner').hidden = true;
  }
  $('scanClose').onclick = stopScanner;
  $('scanToList').onclick = () => { stopScanner(); go(me ? 'people' : 'me'); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && !$('scanner').hidden) stopScanner(); });
  document.querySelectorAll('[data-scan]').forEach(b => b.addEventListener('click', openScanner));

  // ---------- go ----------
  $('appTitle').textContent = cfg.title;
  document.title = cfg.title;
  loadFirst();
})();
