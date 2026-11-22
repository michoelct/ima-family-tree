// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const FT = Object.assign({}, require('../js/data.js'), require('../js/relations.js'), require('../js/layout.js'), require('../js/views.js'));

const H = ['Person ID', 'Full Name (First & Last)', 'Nickname / Badge Name', 'Connection Type', 'Generation', 'Parent 1 (Full Name)', 'Parent 2 (Full Name)', 'Spouse / Partner (Full Name)'];
const rows = [H,
  ['FAM-010', 'Shulamit Feder', 'Ima', 'Family Member', '1 - Ima', '', '', 'Simcha Feder (z"l)'],
  ['FAM-009', 'Sara Chaimovitz ', 'sara', 'Family Member', '2 - Children', 'Shulamit Feder', 'Simcha Feder (z"l)', 'Berish Chaimovitz (z"l)'],
  ['FAM-018', 'Elimelech Mordechai Feder', 'Eli', 'Family Member', '2 - Children', 'Shulamit Feder', 'Simcha Feder (z"l)', 'Linda Feder'],
  ['FAM-019', 'Linda Feder', 'Linda', 'Spouse / Partner', '2 - Children', '', '', 'Eli Feder'],
  ['FAM-001', 'Michoel Chaimovitz', 'Michoel', 'Family Member', '3', 'Sara Chaimovitz', 'Berish Chaimovitz Z""L', 'Ruti Chaimovitz'],
  ['FAM-008', 'Ruti Chaiomovitz', 'Ruti', 'Spouse / Partner', '3', '', '', 'Michoel Chaimovitz'],
  ['FAM-028', 'Dov Ber Feder', 'Dovy', 'Family Member', '3', 'Eli Feder', 'Linda Feder', ''],
  ['FAM-033', 'Simcha Feder', 'Sim', 'Family Member', '4', 'Dovy Feder', '', ''],
  ['FAM-002', 'Nosson Tzvi Chaimovitz', 'Toss', 'Family Member', '4', 'Michoel Chaimovitz', 'Ruti Chaimovitz', '']
];
const fam = () => FT.buildFamily({ familyRows: rows, friendRows: [], rootName: 'Shulamit Feder' });
const say = (f, a, b) => FT.describe(f.people, FT.relate(f.people, a, b, f.rootId), a, b, true, f.rootId);

test('CSV with quotes, doubled quotes and no final newline', () => {
  assert.deepStrictEqual(FT.parseCSV('"a","b ""x""",c\n1,"2,3",4'), [['a', 'b "x"', 'c'], ['1', '2,3', '4']]);
});

test('z"l in any spelling marks a memorial and is removed from the name', () => {
  for (const s of ['Berish Chaimovitz (z"l)', 'Berish Chaimovitz Z"L', 'Berish Chaimovitz z\'l']) {
    assert.deepStrictEqual(FT.splitMemorial(s), { name: 'Berish Chaimovitz', memorial: true });
  }
  assert.strictEqual(FT.splitMemorial('Zalman Levi').memorial, false);
});

test('names link through nicknames, typos and z"l namesakes', () => {
  const f = fam();
  const p = id => f.people.get(id);
  assert.strictEqual(p('FAM-019').spouse, 'FAM-018', '"Eli Feder" = Elimelech Mordechai Feder');
  assert.strictEqual(p('FAM-001').spouse, 'FAM-008', '"Ruti Chaimovitz" = Ruti Chaiomovitz');
  assert.strictEqual(p('FAM-033').parents[0], 'FAM-028', '"Dovy Feder" = Dov Ber Feder');
  const zaida = p(p('FAM-010').spouse);
  assert.ok(zaida.memorial && zaida.id !== 'FAM-033', 'Simcha Feder z"l is not the great-grandson Simcha Feder');
  assert.strictEqual(p('FAM-009').spouse, p('FAM-001').parents[1], 'both spellings of Berish z"l are one person');
  assert.strictEqual(p('FAM-033').gen, 4);
  assert.ok(f.warnings.some(w => w.kind === 'spelling'));
});

test('relationship sentences', () => {
  const f = fam();
  assert.strictEqual(say(f, 'FAM-002', 'FAM-010'), 'Ima is your great-grandmother.');
  assert.strictEqual(say(f, 'FAM-002', 'FAM-033'), 'Sim is your second cousin.');
  assert.strictEqual(say(f, 'FAM-001', 'FAM-028'), 'Dovy is your first cousin.');
  assert.strictEqual(say(f, 'FAM-008', 'FAM-009'), 'Sara is your mother-in-law.');
  assert.strictEqual(say(f, 'FAM-028', 'FAM-008'), 'Ruti is married to your first cousin, Michoel.');
  assert.strictEqual(say(f, 'FAM-001', 'FAM-018'), 'Eli is your uncle.');
});

test('blood relationship names', () => {
  assert.strictEqual(FT.bloodName(1, 3), 'great-niece / nephew');
  assert.strictEqual(FT.bloodName(3, 4), 'second cousin once removed');
  assert.strictEqual(FT.bloodName(4, 2), 'first cousin twice removed');
  assert.strictEqual(FT.bloodName(0, 4), 'great-great-grandchild');
});

test('layout places everyone once without overlaps', () => {
  const f = fam();
  const L = FT.layoutTree(f.people, f.rootId);
  assert.strictEqual(new Set(L.nodes.map(n => n.id)).size, f.people.size);
  const o = L.opts;
  L.nodes.forEach(a => L.nodes.forEach(b => {
    if (a.id < b.id) assert.ok(Math.abs(a.y - b.y) >= o.cardH || Math.abs(a.x - b.x) >= o.cardW, a.id + ' overlaps ' + b.id);
  }));
});

test('separated parents and a new partner: nobody is drawn as an ex, children hang from the descendant', () => {
  const r = [H,
    ['FAM-010', 'Shulamit Feder', 'Ima', 'Family Member', '1', '', '', ''],
    ['FAM-009', 'Sara Chaimovitz', 'Sara', 'Family Member', '2', 'Shulamit Feder', '', ''],
    ['FAM-001', 'Michoel Chaimovitz', 'Michoel', 'Family Member', '3', 'Sara Chaimovitz', '', 'Dana Chaimovitz'],
    ['FAM-050', 'Dana Chaimovitz', 'Dana', 'Spouse / Partner', '3', '', '', 'Michoel Chaimovitz'],
    ['FAM-051', 'Ruth Levi', 'Ruth', 'Spouse / Partner', '3', '', '', 'Michoel Chaimovitz'],
    ['FAM-002', 'Nosson Tzvi Chaimovitz', 'Toss', 'Family Member', '4', 'Michoel Chaimovitz', 'Ruth Levi', ''],
    ['FAM-003', 'Naomi Chaimovitz', 'Naomi', 'Family Member', '4', 'Michoel Chaimovitz', 'Someone Not In Sheet', '']
  ];
  const f = FT.buildFamily({ familyRows: r, friendRows: [], rootName: 'Shulamit Feder' });
  const P = id => f.people.get(id);
  assert.strictEqual(P('FAM-001').spouse, 'FAM-050', 'shown beside Michoel: the partner his own row names');
  assert.strictEqual(P('FAM-051').onTree, false, 'the other parent has no card on the tree');
  assert.ok(P('FAM-051').otherParent);
  assert.deepStrictEqual(P('FAM-002').parents, ['FAM-001'], 'Toss hangs from Michoel only');
  assert.ok(![...f.people.values()].some(p => /someone/i.test(p.name)), 'a parent with no row is not invented');
  const L = FT.layoutTree(f.people, f.rootId);
  assert.ok(!L.nodes.some(n => n.id === 'FAM-051'));
  assert.strictEqual(say(f, 'FAM-002', 'FAM-051'), 'Ruth is your mother.');
  assert.strictEqual(say(f, 'FAM-009', 'FAM-051'), 'Ruth is the mother of your grandson Toss.');
  assert.strictEqual(say(f, 'FAM-051', 'FAM-001'), 'Michoel is Toss’s father too.');
  assert.strictEqual(say(f, 'FAM-050', 'FAM-002'), 'Toss is your husband Michoel’s son.');
  assert.ok(f.warnings.some(w => w.kind === 'partner'), 'organiser is told why Ruth is not beside Michoel');
  assert.ok(!f.warnings.map(w => w.text).join(' ').match(/\b(ex|divorc)/i));
});

test('a partner\'s children from before are drawn under the partner as part of the family', () => {
  const r = [H,
    ['FAM-010', 'Shulamit Feder', 'Ima', 'Family Member', '1', '', '', ''],
    ['FAM-018', 'Eli Feder', 'Eli', 'Family Member', '2', 'Shulamit Feder', '', ''],
    ['FAM-021', 'Esther Worch', 'Esti', 'Family Member', '3', 'Eli Feder', '', 'Mendy Worch'],
    ['FAM-022', 'Menachem Worch', 'Mendy', 'Spouse / Partner', '3', '', '', 'Esti Worch'],
    ['FAM-023', 'Yermia Worch', 'Yermi', 'Family Member', '4', 'Esti Worch', 'Mendy Worch', ''],
    ['FAM-060', 'Ari Worch', 'Ari', 'Family Member', '4', 'Mendy Worch', 'Rachel Gold', ''],
    ['FAM-020', 'Yosef Feder', 'Yossi', 'Family Member', '3', 'Eli Feder', '', '']
  ];
  const f = FT.buildFamily({ familyRows: r, friendRows: [], rootName: 'Shulamit Feder' });
  const P = id => f.people.get(id);
  assert.strictEqual(P('FAM-060').stepOf, 'FAM-022');
  assert.deepStrictEqual(P('FAM-060').parents, ['FAM-022']);
  assert.strictEqual(P('FAM-060').onTree, true);
  assert.strictEqual(P('FAM-060').gen, 4);
  assert.ok(![...f.people.values()].some(p => /rachel/i.test(p.name)), 'their other parent is not invented');
  const L = FT.layoutTree(f.people, f.rootId);
  const n = id => L.nodes.find(x => x.id === id);
  assert.ok(n('FAM-060') && n('FAM-060').x > n('FAM-023').x, 'drawn to the right, under the partner');
  assert.strictEqual(say(f, 'FAM-021', 'FAM-060'), 'Ari is your husband Mendy’s son.');
  assert.strictEqual(say(f, 'FAM-020', 'FAM-060'), 'Ari is part of your sister Esti’s family.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-020'), 'Yossi is Esti’s brother — you’re part of Esti & Mendy’s family.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-023'), 'Yermi is your brother.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-021'), 'Esti is married to your father, Mendy.');
  assert.ok(!/step/i.test(say(f, 'FAM-020', 'FAM-060') + say(f, 'FAM-021', 'FAM-060')));
});

// a bigger family built by hand: 3 children, 9 grandchildren, 18 great-grandchildren, married couples throughout
function bigFamily() {
  const r = [H, ['F-1', 'Root Person', 'Ima', 'Family Member', '1', '', '', '']];
  let n = 2;
  const add = (name, gen, parent, spouse) => r.push(['F-' + n++, name, '', 'Family Member', String(gen), parent, '', spouse || '']);
  for (let a = 0; a < 3; a++) {
    const A = 'Child' + a + ' Person'; add(A, 2, 'Root Person', 'Partner' + a + ' Other');
    r.push(['F-' + n++, 'Partner' + a + ' Other', '', 'Spouse / Partner', '2', '', '', A]);
    for (let b = 0; b < 3; b++) {
      const B = 'Grand' + a + b + ' Person'; add(B, 3, A, b === 0 ? 'Gspouse' + a + ' Other' : '');
      if (b === 0) r.push(['F-' + n++, 'Gspouse' + a + ' Other', '', 'Spouse / Partner', '3', '', '', B]);
      for (let c = 0; c < 2; c++) add('Great' + a + b + c + ' Person', 4, B);
    }
  }
  return FT.buildFamily({ familyRows: r, friendRows: [], rootName: 'Root Person' });
}
const noOverlap = (L) => {
  const o = L.opts;
  for (let i = 0; i < L.nodes.length; i++) for (let j = i + 1; j < L.nodes.length; j++) {
    const a = L.nodes[i], b = L.nodes[j];
    assert.ok(!(Math.abs(a.x - b.x) < o.cardW && Math.abs(a.y - b.y) < o.cardH), `${a.id} and ${b.id} overlap`);
  }
};

test('every shape (list, mixed, chart) places everyone once without overlaps', () => {
  const f = bigFamily();
  const onTree = [...f.people.values()].filter(p => p.onTree !== false).length;
  for (const split of [1, 2, 3, 4, 99]) {
    const L = FT.layoutTree(f.people, f.rootId, { split });
    assert.strictEqual(L.nodes.length, onTree, 'split ' + split);
    assert.strictEqual(new Set(L.nodes.map(x => x.id)).size, onTree);
    noOverlap(L);
  }
  const list = FT.layoutTree(f.people, f.rootId, { split: 1 });
  assert.strictEqual(list.mode, 'list');
  assert.ok(list.width < 500, 'the list fits a phone: ' + list.width);
  // in the list every child is one notch to the right of its parent and below it
  list.nodes.filter(x => x.stacked).forEach(x => {
    const parent = list.nodes.find(m => m.id === f.people.get(x.id).parents[0]);
    assert.ok(x.x > parent.x && x.y > parent.y, x.id + ' sits under its parent');
  });
});

test('a closed family hides its people and says how many', () => {
  const f = bigFamily();
  const child0 = [...f.people.values()].find(p => p.name === 'Child0 Person').id;
  for (const split of [1, 3, 99]) {
    const all = FT.layoutTree(f.people, f.rootId, { split });
    const L = FT.layoutTree(f.people, f.rootId, { split, collapsed: new Set([child0]) });
    const tog = L.toggles.find(g => g.id === child0);
    assert.strictEqual(tog.more, all.nodes.length - L.nodes.length, 'the +N counts the hidden people (split ' + split + ')');
    assert.strictEqual(tog.more, 3 + 1 + 6, 'three grandchildren, one partner, six great-grandchildren');
    noOverlap(L);
  }
});

test('the chosen family is built in the middle of the chart, the others keep their order', () => {
  const f = bigFamily();
  const id = name => [...f.people.values()].find(p => p.name === name).id;
  const L = FT.layoutTree(f.people, f.rootId, { split: 99, centerChild: id('Child2 Person') });
  const x = name => L.nodes.find(n => n.id === id(name)).x;
  assert.ok(x('Child0 Person') < x('Child2 Person') && x('Child2 Person') < x('Child1 Person'), 'Child2 sits between Child0 and Child1');
  assert.strictEqual(L.nodes.length, FT.layoutTree(f.people, f.rootId, { split: 99 }).nodes.length);
  noOverlap(L);
});

test('branch colours: everyone below the root belongs to one child\'s family, spouses too', () => {
  const f = bigFamily();
  const id = name => [...f.people.values()].find(p => p.name === name).id;
  const b = FT.branchMap(f.people, f.rootId);
  assert.strictEqual(b.get(id('Great120 Person')), id('Child1 Person'));
  assert.strictEqual(b.get(id('Partner2 Other')), id('Child2 Person'));
  assert.strictEqual(b.get(id('Gspouse0 Other')), id('Child0 Person'));
  assert.ok(!b.has(f.rootId));
});

test('family view: parents above, the person, children and grandchildren, nobody twice, within the width', () => {
  const f = bigFamily();
  const id = name => [...f.people.values()].find(p => p.name === name).id;
  const L = FT.layoutFamily(f.people, id('Grand10 Person'), { maxW: 340 });
  const ids = L.nodes.map(n => n.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'nobody twice');
  ['Child1 Person', 'Partner1 Other', 'Grand10 Person', 'Gspouse1 Other', 'Great100 Person', 'Grand11 Person'].forEach(n => assert.ok(ids.includes(id(n)), n));
  const y = n => L.nodes.find(x => x.id === id(n)).y;
  assert.ok(y('Child1 Person') < y('Grand10 Person') && y('Grand10 Person') < y('Great100 Person'));
  L.nodes.forEach(n => assert.ok(n.x >= 0 && n.x + L.opts.cardW <= L.width + 0.5));
  noOverlap(L);
});

test('sun view: everyone linked to the root is placed once, cards do not touch', () => {
  const f = bigFamily();
  const L = FT.layoutSun(f.people, f.rootId);
  const linked = [...f.people.values()].filter(p => p.onTree !== false && p.kind !== 'friend');
  assert.strictEqual(L.nodes.length + L.notShown.length, linked.length);
  const c = L.nodes.filter(n => !n.core);
  for (let i = 0; i < c.length; i++) for (let j = i + 1; j < c.length; j++)
    assert.ok(Math.hypot(c[i].x - c[j].x, c[i].y - c[j].y) >= L.opts.cardH, c[i].id + ' / ' + c[j].id);
  assert.ok(L.lines.every(l => l.branch), 'every slice has a branch');
});

test('male / female: from the sheet column, the first name, or the spouse; words follow it', () => {
  assert.strictEqual(FT.parseSex('M'), 'm'); assert.strictEqual(FT.parseSex('female'), 'f'); assert.strictEqual(FT.parseSex(''), null);
  assert.strictEqual(FT.sexFromName('Linda Feder'), 'f'); assert.strictEqual(FT.sexFromName('Mendy'), 'm'); assert.strictEqual(FT.sexFromName('Simcha Feder'), 'm'); assert.strictEqual(FT.sexFromName('Zalman Feder'), null);
  const rows = [H, ['F-1', 'Root Person', 'Ima', 'Family Member', '1', '', '', ''],
    ['F-2', 'Eli Feder', '', 'Family Member', '2', 'Root Person', '', 'Linda Feder'],
    ['F-3', 'Linda Feder', '', 'Spouse / Partner', '2', '', '', 'Eli Feder'],
    ['F-4', 'Simcha Feder', '', 'Family Member', '3', 'Eli Feder', '', 'Rivka Feder'],
    ['F-5', 'Rivka Feder', '', 'Spouse / Partner', '3', '', '', 'Simcha Feder']];
  const f = FT.buildFamily({ familyRows: rows, friendRows: [], rootName: 'Root Person' });
  const p = id => f.people.get(id);
  assert.strictEqual(p('F-4').sex, 'm', 'Simcha -> male');
  assert.strictEqual(FT.relate(f.people, 'F-1', 'F-3', 'F-1').word, 'daughter-in-law');
  assert.strictEqual(FT.relate(f.people, 'F-1', 'F-2', 'F-1').label, 'son');
  assert.strictEqual(FT.relate(f.people, 'F-1', 'F-4', 'F-1').label, 'grandson');
  assert.strictEqual(FT.gx('aunt / uncle (by marriage)', 'f'), 'aunt (by marriage)');
  assert.strictEqual(FT.gx('first cousin once removed', 'f'), 'first cousin once removed');
  assert.strictEqual(FT.gx('grandchild', null), 'grandchild');
  const g = FT.buildFamily({ familyRows: rows.map((r, i) => i === 0 ? r.concat('Male / Female') : r.concat(i === 4 ? 'F' : '')), friendRows: [], rootName: 'Root Person' });
  assert.strictEqual(g.people.get('F-4').sex, 'f', 'the sheet column wins');
});

test('names typed in small letters get capitals; a config correction fixes a row we cannot edit', () => {
  const rows = [H, ['F-1', 'Root Person', 'Ima', 'Family Member', '1', '', '', ''],
    ['F-2', 'Ann Root', '', 'Family Member', '2', 'Root Person', '', ''],
    ['F-3', 'Bea Root', '', 'Family Member', '2', 'Root Person', '', ''],
    ['F-4', 'mindy kohn', '', 'Family Member', '3', 'Ann Root', '', '']];
  const f = FT.buildFamily({ familyRows: rows, friendRows: [], rootName: 'Root Person', corrections: { 'F-4': { parent1: 'Bea Root' } } });
  const m = f.people.get('F-4');
  assert.strictEqual(m.name, 'Mindy Kohn');
  assert.deepStrictEqual(m.parents, ['F-3']);
});

test('the same parent written in both columns is read as that parent and their spouse', () => {
  const rows = [H, ['F-1', 'Root Person', 'Ima', 'Family Member', '1', '', '', ''],
    ['F-2', 'Yehudis Yachnes', '', 'Family Member', '2', 'Root Person', '', 'Ben Yachnes'],
    ['F-3', 'Ben Yachnes', '', 'Spouse / Partner', '2', '', '', 'Yehudis Yachnes'],
    ['F-4', 'Nechama Yachnes', '', 'Family Member', '3', 'Ben Yachnes', 'Ben Yachnes', ''],
    ['F-5', 'Adina Yachnes', '', 'Family Member', '3', 'Yehudis Yachnes', 'Ben Yachnes', '']];
  const f = FT.buildFamily({ familyRows: rows, friendRows: [], rootName: 'Root Person' });
  assert.deepStrictEqual(f.people.get('F-2').children.sort(), ['F-4', 'F-5']);
  assert.ok(!f.people.get('F-4').stepOf, 'not drawn as a step-child');
  assert.ok(f.warnings.some(w => /both parents/.test(w.text)), 'the data check mentions it');
});
