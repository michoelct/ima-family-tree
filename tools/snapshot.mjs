// Saves the current Google Sheet into data/snapshot.json.
// The app loads this copy first (instant, works on bad venue Wi-Fi), then the live sheet.
// Run:  node tools/snapshot.mjs
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const require = createRequire(import.meta.url);
const cfgText = readFileSync(join(root, 'js', 'config.js'), 'utf8');
const sandbox = { window: {} };
new Function('window', cfgText)(sandbox.window);
const cfg = sandbox.window.FT_CONFIG;
const { parseCSV } = require(join(root, 'js', 'data.js'));

const url = gid => `https://docs.google.com/spreadsheets/d/${cfg.sheetId}/gviz/tq?tqx=out:csv&headers=1&gid=${gid}`;
async function get(gid) {
  const r = await fetch(url(gid));
  if (!r.ok) throw new Error(`Sheet tab ${gid}: HTTP ${r.status}`);
  return parseCSV(await r.text());
}
const familyRows = await get(cfg.familyGid);
const friendRows = await get(cfg.friendsGid);
const out = { fetchedAt: new Date().toISOString(), familyRows, friendRows };
writeFileSync(join(root, 'data', 'snapshot.json'), JSON.stringify(out, null, 1));
console.log(`Saved ${familyRows.length - 1} family rows and ${friendRows.length - 1} friend rows.`);
