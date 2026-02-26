import path from 'path';
import { spawn } from 'child_process';
import { prepareDevElectronDist } from './prepare-dev-electron-dist.mjs';

async function main() {
  const projectRoot = process.cwd();
  const { distPath, appBundlePath } = await prepareDevElectronDist({ projectRoot });

  const env = { ...process.env, OS_ACTIVITY_MODE: 'disable' };

  if (process.platform === 'darwin' && distPath && appBundlePath) {
    const electronBin = path.join(appBundlePath, 'Contents', 'MacOS', 'Electron');
    const args = ['.'];
    const child = spawn(electronBin, args, { stdio: 'inherit', env });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  const bin = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const electronBin = path.join(projectRoot, 'node_modules', '.bin', bin);
  const args = ['.'];

  const child = spawn(electronBin, args, { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err?.message || String(err)}\n`);
  process.exit(1);
});
