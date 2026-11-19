// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const FT = Object.assign({}, require('../js/data.js'), require('../js/relations.js'), require('../js/layout.js'));

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
  assert.strictEqual(say(f, 'FAM-002', 'FAM-010'), 'Ima is your great-grandparent.');
  assert.strictEqual(say(f, 'FAM-002', 'FAM-033'), 'Sim is your second cousin.');
  assert.strictEqual(say(f, 'FAM-001', 'FAM-028'), 'Dovy is your first cousin.');
  assert.strictEqual(say(f, 'FAM-008', 'FAM-009'), 'Sara is your mother / father-in-law.');
  assert.strictEqual(say(f, 'FAM-028', 'FAM-008'), 'Ruti is married to your first cousin, Michoel.');
  assert.strictEqual(say(f, 'FAM-001', 'FAM-018'), 'Eli is your aunt / uncle.');
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
  assert.strictEqual(say(f, 'FAM-002', 'FAM-051'), 'Ruth is your parent.');
  assert.strictEqual(say(f, 'FAM-009', 'FAM-051'), 'Ruth is the parent of your grandchild Toss.');
  assert.strictEqual(say(f, 'FAM-051', 'FAM-001'), 'Michoel is Toss’s parent too.');
  assert.strictEqual(say(f, 'FAM-050', 'FAM-002'), 'Toss is your spouse Michoel’s child.');
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
  assert.strictEqual(say(f, 'FAM-021', 'FAM-060'), 'Ari is your spouse Mendy’s child.');
  assert.strictEqual(say(f, 'FAM-020', 'FAM-060'), 'Ari is part of your sibling Esti’s family.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-020'), 'Yossi is Esti’s sibling — you’re part of Esti & Mendy’s family.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-023'), 'Yermi is your sibling.');
  assert.strictEqual(say(f, 'FAM-060', 'FAM-021'), 'Esti is married to your parent, Mendy.');
  assert.ok(!/step/i.test(say(f, 'FAM-020', 'FAM-060') + say(f, 'FAM-021', 'FAM-060')));
});
