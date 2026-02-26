import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const appTsx = path.join(root, 'src', 'App.tsx');
const electronMain = path.join(root, 'electron', 'main.ts');

const mustExist = (p) => {
  if (!fs.existsSync(p)) throw new Error(`Missing file: ${p}`);
};

const read = (p) => fs.readFileSync(p, 'utf-8');

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

mustExist(appTsx);
mustExist(electronMain);

const app = read(appTsx);
assert(app.includes('const splitModelRef'), 'App.tsx: splitModelRef not found');
assert(!app.includes("ref.split('/', 2)"), "App.tsx: found forbidden ref.split('/', 2)");
assert(!app.includes('nextRef.split'), 'App.tsx: found forbidden split usage on normalized refs');
assert(!app.includes('primaryRef.split'), 'App.tsx: found forbidden split usage on primaryRef');

const main = read(electronMain);
assert(!main.includes("primary.split('/', 2)"), "electron/main.ts: found forbidden primary.split('/', 2)");
assert(!main.includes("lastOllamaFallback.split('/', 2)"), "electron/main.ts: found forbidden lastOllamaFallback.split('/', 2)");

process.stdout.write('ok\n');
