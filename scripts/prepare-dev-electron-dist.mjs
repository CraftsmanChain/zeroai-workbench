import fs from 'fs/promises';
import path from 'path';

const DEFAULT_APP_NAME = '元梦 AI';
const DEV_BUNDLE_ID = 'com.wage.app.dev';

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function escapeXml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function replacePlistStringValue(xml, key, value) {
  const escaped = escapeXml(value);
  const re = new RegExp(`(<key>${key}<\\/key>\\s*<string>)([\\s\\S]*?)(<\\/string>)`, 'm');
  if (re.test(xml)) {
    return xml.replace(re, `$1${escaped}$3`);
  }

  const insertion = `\t<key>${key}</key>\n\t<string>${escaped}</string>\n`;
  return xml.replace(/<\/dict>\s*<\/plist>\s*$/m, `${insertion}</dict>\n</plist>\n`);
}

async function patchElectronInfoPlist(infoPlistPath, appName) {
  const xml = await fs.readFile(infoPlistPath, 'utf8');
  let next = xml;
  next = replacePlistStringValue(next, 'CFBundleDisplayName', appName);
  next = replacePlistStringValue(next, 'CFBundleName', appName);
  next = replacePlistStringValue(next, 'CFBundleIdentifier', DEV_BUNDLE_ID);
  if (next !== xml) await fs.writeFile(infoPlistPath, next, 'utf8');
}

async function ensureAppBundleAlias(distPath, appName) {
  const sourceBundlePath = path.join(distPath, 'Electron.app');
  const targetBundlePath = path.join(distPath, `${appName}.app`);

  const sourceExists = await pathExists(sourceBundlePath);
  const targetExists = await pathExists(targetBundlePath);

  if (targetExists && !sourceExists) {
    await fs.symlink(`${appName}.app`, sourceBundlePath);
    return { appBundlePath: targetBundlePath };
  }

  if (!targetExists && sourceExists) {
    await fs.rename(sourceBundlePath, targetBundlePath);
    await fs.symlink(`${appName}.app`, sourceBundlePath);
    return { appBundlePath: targetBundlePath };
  }

  if (targetExists && sourceExists) {
    return { appBundlePath: targetBundlePath };
  }

  throw new Error('Electron.app not found after preparing dev dist');
}

async function readElectronVersion(projectRoot) {
  const pkgPath = path.join(projectRoot, 'node_modules', 'electron', 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  return String(pkg.version || '');
}

export async function prepareDevElectronDist(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const appName = options.appName || process.env.WAGE_APP_NAME || DEFAULT_APP_NAME;
  const markerSchema = 4;

  if (process.platform !== 'darwin') {
    return { distPath: null, appName };
  }

  const electronVersion = await readElectronVersion(projectRoot);
  const srcDist = path.join(projectRoot, 'node_modules', 'electron', 'dist');
  const dstDist = path.join(projectRoot, '.electron-dev-dist');
  const markerPath = path.join(dstDist, '.wage-electron-dev-dist.json');

  const markerOk = await (async () => {
    if (!(await pathExists(markerPath))) return false;
    try {
      const marker = JSON.parse(await fs.readFile(markerPath, 'utf8'));
      return (
        marker?.schema === markerSchema &&
        marker?.electronVersion === electronVersion &&
        marker?.appName === appName
      );
    } catch {
      return false;
    }
  })();

  if (!markerOk) {
    await fs.rm(dstDist, { recursive: true, force: true });
    await fs.cp(srcDist, dstDist, { recursive: true, dereference: false, verbatimSymlinks: true });
    await fs.writeFile(
      markerPath,
      JSON.stringify({ schema: markerSchema, electronVersion, appName }, null, 2),
      'utf8'
    );
  }

  const { appBundlePath } = await ensureAppBundleAlias(dstDist, appName);
  const infoPlistPath = path.join(appBundlePath, 'Contents', 'Info.plist');
  await patchElectronInfoPlist(infoPlistPath, appName);

  return { distPath: dstDist, appName, appBundlePath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  prepareDevElectronDist().then(({ distPath }) => {
    if (distPath) process.stdout.write(`${distPath}\n`);
  });
}
