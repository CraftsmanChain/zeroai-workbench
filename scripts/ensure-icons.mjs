import fs from 'fs/promises';
import path from 'path';

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyIfMissing(from, to) {
  if (await pathExists(to)) return false;
  await ensureDir(path.dirname(to));
  await fs.copyFile(from, to);
  return true;
}

async function main() {
  const projectRoot = process.cwd();
  const buildDir = path.join(projectRoot, 'build');
  await ensureDir(buildDir);

  const fallbackDir = path.join(
    projectRoot,
    'node_modules',
    'app-builder-lib',
    'templates',
    'icons',
    'proton-native'
  );

  const fallbackIcns = path.join(fallbackDir, 'proton-native.icns');
  const fallbackIco = path.join(fallbackDir, 'proton-native.ico');
  const fallbackPng = path.join(fallbackDir, 'linux', '1024x1024.png');

  await copyIfMissing(fallbackIcns, path.join(buildDir, 'icon.icns'));
  await copyIfMissing(fallbackIco, path.join(buildDir, 'icon.ico'));
  await copyIfMissing(fallbackPng, path.join(buildDir, 'icon.png'));
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
