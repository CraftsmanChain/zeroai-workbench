const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const { notarize } = require('@electron/notarize');

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeApiKeyToTemp() {
  const raw = process.env.APPLE_API_KEY;
  if (!raw) return null;

  const p8Path = path.join(os.tmpdir(), `apple_api_key_${Date.now()}.p8`);
  const content = raw.includes('BEGIN PRIVATE KEY') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  await fs.writeFile(p8Path, content, { encoding: 'utf8', mode: 0o600 });
  return p8Path;
}

module.exports = async function afterSign(context) {
  if (process.platform !== 'darwin') return;

  const productFilename = context && context.packager && context.packager.appInfo && context.packager.appInfo.productFilename;
  const appOutDir = context && context.appOutDir;
  if (!productFilename || !appOutDir) return;

  const appPath = path.join(appOutDir, `${productFilename}.app`);
  if (!(await pathExists(appPath))) return;

  const apiKeyId = process.env.APPLE_API_KEY_ID;
  const apiIssuer = process.env.APPLE_API_ISSUER;
  const teamId = process.env.APPLE_TEAM_ID;

  if (apiKeyId && apiIssuer && process.env.APPLE_API_KEY) {
    const apiKeyPath = await writeApiKeyToTemp();
    if (!apiKeyPath) return;
    await notarize({
      appPath,
      appleApiKey: apiKeyPath,
      appleApiKeyId: apiKeyId,
      appleApiIssuer: apiIssuer,
      teamId,
    });
    return;
  }

  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  if (appleId && applePassword) {
    await notarize({
      appPath,
      appleId,
      appleIdPassword: applePassword,
      teamId,
    });
  }
};
