import { app, BrowserWindow, ipcMain, shell, net as electronNet } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { exec, execFile, spawn, spawnSync, ChildProcess } from 'child_process';
import util from 'util';
import net from 'net';

const APP_NAME = '元梦 AI';

const execAsync = util.promisify(exec);
const execFileAsync = util.promisify(execFile);

let win: BrowserWindow | null = null;
let webuiProcess: ChildProcess | null = null;
let ollamaProcess: ChildProcess | null = null;
const activeOllamaRequests = new Map<string, any>();
const activeOllamaRequestTimeouts = new Map<string, { firstByte?: NodeJS.Timeout; overall?: NodeJS.Timeout }>();
const activeOllamaPullRequests = new Map<string, any>();
const activeOllamaRunRequests = new Map<string, ChildProcess>();
const activeOpenClawAuthRequests = new Map<string, ChildProcess>();
let cachedLibraryTags: { fetchedAt: number; models: any[] } | null = null;

process.title = APP_NAME;
app.setName(APP_NAME);

// Fix PATH on macOS to ensure we find binaries like ollama, node, etc.
if (process.platform === 'darwin') {
  const commonPaths = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(os.homedir(), '.local/bin'),
    path.join(os.homedir(), '.openclaw-runtime', 'node', 'bin'),
    path.join(os.homedir(), '.openclaw-runtime', 'pnpm', 'node_modules', '.bin'),
    path.join(os.homedir(), '.openclaw-runtime'),
    // Add user specific NVM path if it exists
    path.join(os.homedir(), '.nvm/versions/node/v24.12.0/bin'),
    '/Library/Frameworks/Python.framework/Versions/3.10/bin'
  ];
  const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
  process.env.PATH = `${commonPaths.join(':')}:${basePath}`;
}

function getOllamaPath(): string {
  const isDev = !app.isPackaged;
  const binaryName = process.platform === 'win32' ? 'ollama.exe' : 'ollama';
  
  if (isDev) {
    // In development, it's in resources/bin
    return path.join(__dirname, '../../resources/bin', binaryName);
  } else {
    // In production, it's in Resources/resources/bin
    return path.join(process.resourcesPath, 'resources/bin', binaryName);
  }
}

function getOfflineAgentBinDir(): string {
  return path.join(os.homedir(), '.openclaw', 'agent', 'bin');
}

function resolveCommandFromPath(cmd: string): string | null {
  const isExecutableFile = (p: string) => {
    try {
      const st = fs.statSync(p);
      if (!st.isFile()) return false;
      if (process.platform === 'win32') return true;
      return (st.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  };

  try {
    if (cmd.includes('/') || (process.platform === 'win32' && cmd.includes('\\'))) {
      const p = cmd.trim();
      return p && isExecutableFile(p) ? p : null;
    }

    const basePath = process.env.PATH || '/usr/bin:/bin:/usr/sbin:/sbin';
    for (const dir of basePath.split(path.delimiter).filter(Boolean)) {
      const candidate = path.join(dir, cmd);
      if (isExecutableFile(candidate)) return candidate;
    }

    const res = spawnSync('/usr/bin/which', [cmd], { encoding: 'utf-8', timeout: 1500 });
    const out = (res.stdout || '').toString().trim();
    if (res.status === 0 && out && isExecutableFile(out)) return out;
    return null;
  } catch {
    return null;
  }
}

function resolveOllamaCliPathAny(): string | null {
  const runtime = path.join(os.homedir(), '.openclaw-runtime', process.platform === 'win32' ? 'ollama.exe' : 'ollama');
  if (fs.existsSync(runtime)) return runtime;
  const offline = path.join(getOfflineAgentBinDir(), process.platform === 'win32' ? 'ollama.exe' : 'ollama');
  if (fs.existsSync(offline)) return offline;
  if (process.platform === 'darwin') {
    if (fs.existsSync('/usr/local/bin/ollama')) return '/usr/local/bin/ollama';
    if (fs.existsSync('/opt/homebrew/bin/ollama')) return '/opt/homebrew/bin/ollama';
    if (fs.existsSync('/Applications/Ollama.app/Contents/Resources/ollama')) return '/Applications/Ollama.app/Contents/Resources/ollama';
    if (fs.existsSync(path.join(os.homedir(), 'Applications/Ollama.app/Contents/Resources/ollama'))) {
      return path.join(os.homedir(), 'Applications/Ollama.app/Contents/Resources/ollama');
    }
  }
  const bundled = getOllamaPath();
  if (fs.existsSync(bundled)) return bundled;
  return resolveCommandFromPath('ollama');
}

function resolveOllamaCliPathSystem(): string | null {
  if (process.platform === 'darwin') {
    if (fs.existsSync('/usr/local/bin/ollama')) return '/usr/local/bin/ollama';
    if (fs.existsSync('/opt/homebrew/bin/ollama')) return '/opt/homebrew/bin/ollama';
    if (fs.existsSync('/Applications/Ollama.app/Contents/Resources/ollama')) return '/Applications/Ollama.app/Contents/Resources/ollama';
    if (fs.existsSync(path.join(os.homedir(), 'Applications/Ollama.app/Contents/Resources/ollama'))) {
      return path.join(os.homedir(), 'Applications/Ollama.app/Contents/Resources/ollama');
    }
  }
  return resolveCommandFromPath('ollama');
}

async function runOllamaCli(args: string[], opts?: { timeoutMs?: number; maxBuffer?: number }) {
  const cli = resolveOllamaCliPathAny();
  if (!cli) {
    return { status: 'error', message: 'Ollama not found (System or Offline)' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(cli, args, {
      maxBuffer: opts?.maxBuffer ?? 10 * 1024 * 1024,
      timeout: opts?.timeoutMs ?? 25_000,
    } as any);
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { status: 'ok', output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'Command failed', output };
  }
}

function findOllamaPsLine(psText: string, model: string) {
  const lines = (psText || '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('NAME')) continue;
    const name = line.trim().split(/\s+/)[0];
    if (name === model) return line;
  }
  return null;
}

async function forceStopOllamaModel(model: string, opts?: { force?: boolean }) {
  const target = (model || '').trim();
  if (!target) return { status: 'error', message: 'Missing model' };

  await runOllamaCli(['stop', target], { timeoutMs: 15_000 }).catch(() => {});

  const start = Date.now();
  while (Date.now() - start < 10_000) {
    const ps = await runOllamaCli(['ps'], { timeoutMs: 6_000, maxBuffer: 2 * 1024 * 1024 });
    const line = ps.status === 'ok' ? findOllamaPsLine(ps.output || '', target) : null;
    if (!line) return { status: 'ok' };
    if (!opts?.force) return { status: 'ok', message: 'Stopping...' };
    await new Promise((r) => setTimeout(r, 800));
  }

  if (opts?.force) {
    try {
      const plist = getOllamaLaunchAgentPlistPath();
      if (fs.existsSync(plist)) {
        await launchctlUnload(plist);
        await launchctlLoad(plist);
        return { status: 'ok', message: 'Ollama restarted to release stuck model' };
      }
    } catch {}
  }
  return { status: 'error', message: 'Model stop timeout' };
}

function parseOllamaList(stdout: string): { name: string }[] {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const models: { name: string }[] = [];
  for (const line of lines) {
    if (line.startsWith('NAME')) continue;
    const parts = line.split(/\s+/);
    const name = parts[0];
    if (!name) continue;
    models.push({ name });
  }
  return models;
}

function resolveOpenClawCliPathAny(): string | null {
  const offline = path.join(getOfflineAgentBinDir(), process.platform === 'win32' ? 'openclaw-cn.exe' : 'openclaw-cn');
  if (fs.existsSync(offline)) return offline;
  if (process.platform === 'darwin') {
    if (fs.existsSync('/usr/local/bin/openclaw-cn')) return '/usr/local/bin/openclaw-cn';
    if (fs.existsSync('/opt/homebrew/bin/openclaw-cn')) return '/opt/homebrew/bin/openclaw-cn';
  }
  return resolveCommandFromPath('openclaw-cn');
}

function resolveOpenClawCliPathSystem(): string | null {
  if (process.platform === 'darwin') {
    if (fs.existsSync('/usr/local/bin/openclaw-cn')) return '/usr/local/bin/openclaw-cn';
    if (fs.existsSync('/opt/homebrew/bin/openclaw-cn')) return '/opt/homebrew/bin/openclaw-cn';
  }
  return resolveCommandFromPath('openclaw-cn');
}

function resolveNvmNodeCliPathAny(): string | null {
  const home = os.homedir();
  const candidates: string[] = [];
  candidates.push(path.join(home, '.openclaw-runtime', 'node', 'bin', 'node'));
  candidates.push(path.join(home, '.openclaw', 'runtime', 'node', 'bin', 'node'));
  candidates.push(path.join(home, '.nvm/versions/node/v24.12.0/bin/node'));
  try {
    const versionsDir = path.join(home, '.nvm/versions/node');
    if (fs.existsSync(versionsDir)) {
      const entries = fs.readdirSync(versionsDir).filter(Boolean);
      for (const v of entries) {
        candidates.push(path.join(versionsDir, v, 'bin', 'node'));
      }
    }
  } catch {}
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function replaceUserHomePrefixesInJsonTree(rootDir: string, home: string) {
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.toLowerCase().endsWith('.json')) continue;
      try {
        const raw = fs.readFileSync(abs, 'utf-8');
        const prefixes = raw.match(/\/Users\/[^\/\s"'<>]+(?=\/)/g) || [];
        const unique = Array.from(new Set(prefixes)).filter((p) => p && p !== home);
        if (!unique.length) continue;
        let next = raw;
        for (const p of unique) next = next.replaceAll(p, home);
        if (next === raw) continue;
        const tmpPath = `${abs}.tmp.${process.pid}.${Date.now()}`;
        fs.writeFileSync(tmpPath, next, 'utf-8');
        fs.renameSync(tmpPath, abs);
      } catch {}
    }
  };
  walk(rootDir);
}

function ensureZshrcPathExportLine() {
  const zshrcPath = path.join(os.homedir(), '.zshrc');
  const home = os.homedir();
  const line = `export PATH="${home}/.openclaw-runtime/node/bin:${home}/.openclaw-runtime/pnpm/node_modules/.bin:${home}/.openclaw-runtime:$PATH"`;
  try {
    const raw = fs.existsSync(zshrcPath) ? fs.readFileSync(zshrcPath, 'utf-8') : '';
    const parts = raw.split(/\r?\n/);
    const matcher = /^\s*export\s+PATH\s*=\s*["']?.*\.openclaw-runtime\/.*$/;
    let changed = false;
    let replaced = false;
    const nextParts = parts.map((p) => {
      if (!matcher.test(p)) return p;
      if (p.trim() === line.trim()) {
        replaced = true;
        return p;
      }
      changed = true;
      replaced = true;
      return line;
    });
    if (!replaced) {
      if (nextParts.includes(line)) return { status: 'ok', changed: false };
      const suffix = raw && !raw.endsWith('\n') ? '\n' : '';
      fs.writeFileSync(zshrcPath, `${raw}${suffix}${line}\n`, 'utf-8');
      return { status: 'ok', changed: true };
    }
    if (!changed) return { status: 'ok', changed: false };
    fs.writeFileSync(zshrcPath, `${nextParts.join('\n')}\n`, 'utf-8');
    return { status: 'ok', changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to update ~/.zshrc' };
  }
}

function resolveNodeCliPathAny(): string | null {
  const fromPath = resolveCommandFromPath('node');
  if (fromPath) return fromPath;
  return resolveNvmNodeCliPathAny();
}

function resolveNpmCliPathAny(): string | null {
  const fromPath = resolveCommandFromPath('npm');
  if (fromPath) return fromPath;
  const node = resolveNvmNodeCliPathAny();
  if (!node) return null;
  const npm = path.join(path.dirname(node), 'npm');
  if (fs.existsSync(npm)) return npm;
  return null;
}

function isMockOpenClawCli(cliPath: string) {
  try {
    const raw = fs.readFileSync(cliPath, 'utf-8');
    return raw.includes('Mock OpenClaw');
  } catch {
    return false;
  }
}

function stripAnsiAndControl(input: string) {
  const s = (input || '').toString();
  return s
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r/g, '')
    .replace(/\u0000/g, '');
}

function extractAuthUrlFromText(input: string) {
  const text = stripAnsiAndControl(input);
  const re = /https:\/\//g;
  const allowed = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]/;
  const isSkippable = (ch: string) => {
    if (!ch) return false;
    if (/\s/.test(ch)) return true;
    const cp = ch.codePointAt(0) || 0;
    if (cp >= 0x2500 && cp <= 0x257f) return true;
    if (cp >= 0x2580 && cp <= 0x259f) return true;
    return ch === '╭' || ch === '╮' || ch === '╰' || ch === '╯';
  };
  while (true) {
    const m = re.exec(text);
    if (!m) break;
    const start = m.index;
    let i = start + 'https://'.length;
    let rest = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (isSkippable(ch)) continue;
      if (allowed.test(ch)) {
        rest += ch;
        continue;
      }
      break;
    }
    const url = `https://${rest}`;
    try {
      const u = new URL(url);
      if (!/qwen\.ai$/i.test(u.hostname) && !/\.qwen\.ai$/i.test(u.hostname)) continue;
      return url;
    } catch {}
  }
  return '';
}

function getAuthProfilesPath() {
  return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json');
}

function getFileMtimeMsSafe(p: string) {
  try {
    return fs.statSync(p).mtimeMs || 0;
  } catch {
    return 0;
  }
}

function hasValidQwenPortalAuthProfile(opts?: { requireMtimeAfterMs?: number }) {
  const p = getAuthProfilesPath();
  try {
    if (!fs.existsSync(p)) return false;
    const mtime = getFileMtimeMsSafe(p);
    if (typeof opts?.requireMtimeAfterMs === 'number' && mtime <= opts.requireMtimeAfterMs) return false;
    const raw = fs.readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw);
    const profiles = parsed?.profiles && typeof parsed.profiles === 'object' ? parsed.profiles : {};
    for (const v of Object.values(profiles)) {
      const pr: any = v as any;
      if (!pr || typeof pr !== 'object') continue;
      if ((pr.provider || '') !== 'qwen-portal') continue;
      const access = (pr.access || '').toString();
      const expires = Number(pr.expires || 0);
      if (access.length > 10 && expires > Date.now() + 5_000) return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function runOpenClawCli(args: string[], opts?: { timeoutMs?: number }) {
  const cli = resolveOpenClawCliPathAny();
  if (!cli) {
    return { status: 'error', message: 'openclaw-cn not found (System or Offline)' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(cli, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: opts?.timeoutMs ?? 25_000,
      env: process.env,
    } as any);
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { status: 'ok', output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'Command failed', output };
  }
}

async function ensureNodeRuntimeInstalled(opts?: { send?: (msg: string) => void }) {
  const send = opts?.send || (() => {});
  const existing = resolveNodeCliPathAny();
  if (existing) return { status: 'ok', node: existing };
  if (process.platform !== 'darwin') return { status: 'error', message: '需要预先安装 Node 22+（当前仅实现 macOS 自动安装）' };

  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  const distArch = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  const runtimeDir = path.join(os.homedir(), '.openclaw', 'runtime');
  const nodeRoot = path.join(runtimeDir, 'node');
  fs.mkdirSync(runtimeDir, { recursive: true });

  send('下载并安装 Node 运行时（Node 22+）...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-node-'));
  const indexPath = path.join(tmpDir, 'index.json');
  const tarPath = path.join(tmpDir, 'node.tar.gz');

  await execFileAsync('curl', ['-fsSL', 'https://nodejs.org/dist/index.json', '-o', indexPath], { timeout: 60_000 } as any);
  const index = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
  const pickLts = Array.isArray(index)
    ? index.find((v: any) => {
        const ver = typeof v?.version === 'string' ? v.version : '';
        const m = ver.match(/^v(\d+)\./);
        const major = m ? Number(m[1]) : 0;
        return Boolean(v?.lts) && major >= 22;
      })
    : null;
  const pickAny = Array.isArray(index)
    ? index.find((v: any) => {
        const ver = typeof v?.version === 'string' ? v.version : '';
        const m = ver.match(/^v(\d+)\./);
        const major = m ? Number(m[1]) : 0;
        return major >= 22;
      })
    : null;
  const version = ((pickLts || pickAny)?.version || '').toString();
  if (!version) return { status: 'error', message: '无法解析 Node 版本（需要 Node 22+）' };
  const url = `https://nodejs.org/dist/${version}/node-${version}-${distArch}.tar.gz`;
  send(`下载 Node：${version} (${distArch})`);
  await execFileAsync('curl', ['-fL', url, '-o', tarPath], { timeout: 10 * 60_000 } as any);

  const extractDir = path.join(tmpDir, 'extract');
  fs.mkdirSync(extractDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarPath, '-C', extractDir], { timeout: 5 * 60_000 } as any);
  const extractedEntries = fs.readdirSync(extractDir).filter(Boolean);
  const extractedRoot = extractedEntries.length === 1 ? path.join(extractDir, extractedEntries[0]) : extractDir;
  const binNode = path.join(extractedRoot, 'bin', 'node');
  if (!fs.existsSync(binNode)) return { status: 'error', message: 'Node 安装包结构异常（缺少 bin/node）' };

  fs.rmSync(nodeRoot, { recursive: true, force: true });
  fs.renameSync(extractedRoot, nodeRoot);
  const node = path.join(nodeRoot, 'bin', 'node');
  if (!fs.existsSync(node)) return { status: 'error', message: 'Node 安装失败（缺少 node 可执行文件）' };
  send(`Node 已安装：${node}`);
  return { status: 'ok', node };
}

async function ensureOpenClawCnInstalled(opts?: { send?: (msg: string) => void }) {
  const send = opts?.send || (() => {});
  const ensuredNode = await ensureNodeRuntimeInstalled({ send });
  if (ensuredNode.status !== 'ok') return ensuredNode;
  const node = resolveNodeCliPathAny();
  const npm = resolveNpmCliPathAny();
  if (!node || !npm) return { status: 'error', message: 'Node/npm 未就绪（需要 Node 22+）' };

  const binDir = getOfflineAgentBinDir();
  const wrapperPath = path.join(binDir, process.platform === 'win32' ? 'openclaw-cn.exe' : 'openclaw-cn');

  const existing = resolveOpenClawCliPathAny();
  if (existing && !isMockOpenClawCli(existing) && fs.existsSync(existing)) {
    return { status: 'ok', message: 'openclaw-cn 已存在' };
  }

  const appDir = path.join(os.homedir(), '.openclaw', 'agent', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  send('安装 openclaw-cn（npm）...');
  await execFileAsync(npm, ['install', '--prefix', appDir, 'openclaw-cn@latest'], {
    timeout: 12 * 60_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, PATH: `${path.dirname(node)}:${process.env.PATH || ''}` },
  } as any);

  const pkgPath = path.join(appDir, 'node_modules', 'openclaw-cn', 'package.json');
  if (!fs.existsSync(pkgPath)) return { status: 'error', message: 'openclaw-cn 安装失败：缺少 package.json' };
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const binField = pkg?.bin;
  const binRel =
    typeof binField === 'string'
      ? binField
      : typeof binField === 'object' && binField
        ? (binField['openclaw-cn'] || binField['clawdbot-cn'] || Object.values(binField)[0])
        : '';
  const rel = typeof binRel === 'string' ? binRel : '';
  if (!rel) return { status: 'error', message: 'openclaw-cn 安装失败：未找到 bin 入口' };
  const entryAbs = path.join(appDir, 'node_modules', 'openclaw-cn', rel);
  if (!fs.existsSync(entryAbs)) return { status: 'error', message: `openclaw-cn 安装失败：入口不存在 ${entryAbs}` };

  fs.mkdirSync(binDir, { recursive: true });
  const wrapper = `#!/bin/bash
set -euo pipefail
exec "${node}" "${entryAbs}" "$@"
`;
  fs.writeFileSync(wrapperPath, wrapper, { encoding: 'utf-8', mode: 0o755 });
  try {
    fs.chmodSync(wrapperPath, 0o755);
  } catch {}
  send(`openclaw-cn 已就绪：${wrapperPath}`);
  return { status: 'ok', message: 'openclaw-cn installed' };
}

async function installOpenClawCnToSystemPathBestEffort(cliPath: string, opts?: { send?: (msg: string) => void }) {
  const send = opts?.send || (() => {});
  if (process.platform !== 'darwin') return;
  const runtimeCli = path.join(os.homedir(), '.openclaw-runtime', 'node', 'bin', 'openclaw-cn');
  const src = runtimeCli && fs.existsSync(runtimeCli) ? runtimeCli : cliPath;
  if (!src || !fs.existsSync(src)) return;

  const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const trySymlink = async (dir: string) => {
    const dst = path.join(dir, 'openclaw-cn');
    try {
      if (fs.existsSync(dst)) {
        try {
          fs.unlinkSync(dst);
        } catch {}
      }
      fs.symlinkSync(src, dst);
      try {
        fs.chmodSync(dst, 0o755);
      } catch {}
      send(`已创建 openclaw-cn 软链：${dst} → ${src}`);
      return true;
    } catch {
      return false;
    }
  };

  const candidates = ['/usr/local/bin', '/opt/homebrew/bin'];
  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      fs.accessSync(dir, fs.constants.W_OK);
      const ok = await trySymlink(dir);
      if (ok) return;
    } catch {}
  }

  for (const dir of candidates) {
    try {
      const cmd = `mkdir -p ${shellQuote(dir)} && ln -sf ${shellQuote(src)} ${shellQuote(path.join(dir, 'openclaw-cn'))} && chmod 755 ${shellQuote(path.join(dir, 'openclaw-cn'))}`;
      const res = await runShellAsAdmin(cmd);
      if (res?.status === 'ok') {
        send(`已创建 openclaw-cn 软链（管理员权限）：${path.join(dir, 'openclaw-cn')}`);
        if (res.output) send(res.output);
        return;
      }
    } catch {}
  }
  send('未能写入 /usr/local/bin 或 /opt/homebrew/bin（权限不足），已跳过 PATH 安装。');
}

async function restartOpenClawBestEffort() {
  const rr = await runOpenClawCli(['gateway', 'restart'], { timeoutMs: 60_000 });
  if (rr.status === 'ok') return rr;
  const st = await runOpenClawCli(['gateway', 'stop'], { timeoutMs: 30_000 });
  const ss = await runOpenClawCli(['gateway', 'start'], { timeoutMs: 60_000 });
  if (ss.status === 'ok') return ss;
  const combined = [rr.output, st.output, ss.output].filter(Boolean).join('\n').trim();
  return { status: 'error', message: ss.message || rr.message || 'OpenClaw restart failed', output: combined };
}

async function isLocalPortOpen(port: number, timeoutMs: number) {
  return await new Promise<boolean>((res) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      res(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      res(false);
    });
    socket.on('error', () => res(false));
    socket.connect(port, '127.0.0.1');
  });
}

function getLaunchAgentsDir(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}

function getOllamaLaunchAgentPlistPath(): string {
  return path.join(getLaunchAgentsDir(), 'com.ollama.serve.plist');
}

function getGatewayLaunchAgentPlistPath(): string {
  return path.join(getLaunchAgentsDir(), 'com.clawdbot.gateway.plist');
}

function resolveGatewayConfigPathFromPlist(plistPath: string): string | null {
  try {
    if (!fs.existsSync(plistPath)) return null;
    const raw = fs.readFileSync(plistPath, 'utf-8');
    const home = os.homedir();
    const expanded = raw
      .replaceAll('${HOME}', home)
      .replaceAll('$HOME', home)
      .replace(/~(?=\/)/g, home);
    const matches = expanded.match(/([^\s"'<>]*openclaw\.json)/g) || [];
    for (const m of matches) {
      const candidate = m.trim();
      if (!candidate) continue;
      if (candidate.includes('~')) continue;
      if (fs.existsSync(candidate)) return candidate;
    }
    const fallback = matches[0]?.trim();
    return fallback || null;
  } catch {
    return null;
  }
}

function getEffectiveOpenClawConfigPath(): string {
  const fromPlist = resolveGatewayConfigPathFromPlist(getGatewayLaunchAgentPlistPath());
  if (fromPlist) return fromPlist;
  return getOpenClawConfigPath();
}

function resolveGatewayTokenFromPlist(plistPath: string): string | null {
  try {
    if (!fs.existsSync(plistPath)) return null;
    const raw = fs.readFileSync(plistPath, 'utf-8');
    const m = raw.match(/<key>\s*OPENCLAW_GATEWAY_TOKEN\s*<\/key>\s*<string>\s*([^<\s]+)\s*<\/string>/i);
    const token = m?.[1]?.trim();
    return token || null;
  } catch {
    return null;
  }
}

function getEffectiveGatewayToken(): string | null {
  const fromPlist = resolveGatewayTokenFromPlist(getGatewayLaunchAgentPlistPath());
  if (fromPlist) return fromPlist;
  const fromConfig = readGatewayTokenFromConfig(getEffectiveOpenClawConfigPath());
  return fromConfig;
}

function readGatewayTokenFromConfig(configPath: string): string | null {
  try {
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const token = parsed?.gateway?.auth?.token;
    if (typeof token === 'string' && token.trim()) return token.trim();
    return null;
  } catch {
    return null;
  }
}

function setGatewayTokenInConfig(configPath: string, token: string): boolean {
  try {
    if (!fs.existsSync(configPath)) return false;
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.gateway || typeof parsed.gateway !== 'object') parsed.gateway = {};
    if (!parsed.gateway.auth || typeof parsed.gateway.auth !== 'object') parsed.gateway.auth = {};
    if ((parsed.gateway.auth.token || '') === token) return false;
    parsed.gateway.auth.token = token;
    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, parsed);
    return true;
  } catch {
    return false;
  }
}

function setGatewayTokenInPlist(plistPath: string, token: string): boolean {
  try {
    if (!fs.existsSync(plistPath)) return false;
    const raw = fs.readFileSync(plistPath, 'utf-8');
    const re =
      /(<key>\s*OPENCLAW_GATEWAY_TOKEN\s*<\/key>\s*<string>\s*)([^<\s]+)(\s*<\/string>)/i;
    if (re.test(raw)) {
      const next = raw.replace(re, `$1${token}$3`);
      if (next === raw) return false;
      const tmpPath = `${plistPath}.tmp.${process.pid}.${Date.now()}`;
      fs.writeFileSync(tmpPath, next, 'utf-8');
      fs.renameSync(tmpPath, plistPath);
      return true;
    }
    const insertRe = /(<key>\s*EnvironmentVariables\s*<\/key>\s*<dict>)/i;
    if (!insertRe.test(raw)) return false;
    const injected = raw.replace(
      insertRe,
      `$1\n    <key>OPENCLAW_GATEWAY_TOKEN</key>\n    <string>${token}</string>`,
    );
    const tmpPath = `${plistPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, injected, 'utf-8');
    fs.renameSync(tmpPath, plistPath);
    return true;
  } catch {
    return false;
  }
}

function ensureOllamaOpenAiCompatInConfigFile(configPath: string) {
  try {
    if (!fs.existsSync(configPath)) return { status: 'error', message: 'Config not found' };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(raw);
    cfg.models = typeof cfg.models === 'object' && cfg.models ? cfg.models : {};
    cfg.models.providers = typeof cfg.models.providers === 'object' && cfg.models.providers ? cfg.models.providers : {};
    const prev = typeof cfg.models.providers.ollama === 'object' && cfg.models.providers.ollama ? cfg.models.providers.ollama : {};
    const baseUrl = typeof prev.baseUrl === 'string' && prev.baseUrl.trim() ? prev.baseUrl.trim() : 'http://127.0.0.1:11434/v1';
    const normalizedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/v1`;
    const apiKey = typeof prev.apiKey === 'string' && prev.apiKey.trim() ? prev.apiKey.trim() : 'a';
    const api = typeof prev.api === 'string' && prev.api.trim() ? prev.api.trim() : 'openai-completions';
    cfg.models.providers.ollama = {
      ...prev,
      baseUrl: normalizedBaseUrl,
      apiKey,
      api,
      models: Array.isArray(prev.models) ? prev.models : [],
    };
    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, cfg);
    return { status: 'ok' };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to patch config' };
  }
}

function ensureOllamaOpenAiCompatInModelsFile(modelsPath: string) {
  try {
    if (!fs.existsSync(modelsPath)) return { status: 'ok', changed: false };
    const raw = fs.readFileSync(modelsPath, 'utf-8');
    const cfg = JSON.parse(raw);
    cfg.providers = typeof cfg.providers === 'object' && cfg.providers ? cfg.providers : {};
    const prev = typeof cfg.providers.ollama === 'object' && cfg.providers.ollama ? cfg.providers.ollama : {};
    const baseUrl = typeof prev.baseUrl === 'string' && prev.baseUrl.trim() ? prev.baseUrl.trim() : 'http://127.0.0.1:11434/v1';
    const normalizedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/v1`;
    const apiKey = typeof prev.apiKey === 'string' && prev.apiKey.trim() ? prev.apiKey.trim() : 'a';
    const api = typeof prev.api === 'string' && prev.api.trim() ? prev.api.trim() : 'openai-completions';
    cfg.providers.ollama = {
      ...prev,
      baseUrl: normalizedBaseUrl,
      apiKey,
      api,
      models: Array.isArray(prev.models) ? prev.models : [],
    };
    const tmpPath = `${modelsPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(cfg, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmpPath, modelsPath);
    return { status: 'ok', changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to patch models.json' };
  }
}

function ensureAgentModelsFileSyncedWithConfig(modelsPath: string, configPath: string) {
  try {
    if (!fs.existsSync(modelsPath)) return { status: 'ok', changed: false };
    if (!fs.existsSync(configPath)) return { status: 'ok', changed: false };

    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw || '{}');
    const cfgProviders = config?.models?.providers && typeof config.models.providers === 'object' ? config.models.providers : {};

    const modelsRaw = fs.readFileSync(modelsPath, 'utf-8');
    const modelsCfg = JSON.parse(modelsRaw || '{}');
    modelsCfg.providers = typeof modelsCfg.providers === 'object' && modelsCfg.providers ? modelsCfg.providers : {};

    const normalizeBaseUrlLoose = (raw: any, fallback: string) => {
      const v = typeof raw === 'string' ? raw.trim() : '';
      const base = v || fallback;
      return base.replace(/\/+$/, '');
    };

    const normalizeBaseUrlEnsureV1 = (raw: any, fallback: string) => {
      const noTrail = normalizeBaseUrlLoose(raw, fallback);
      return noTrail.endsWith('/v1') ? noTrail : `${noTrail}/v1`;
    };

    const syncProvider = (pid: string, defaults?: { baseUrl?: string; apiKey?: string; api?: string }) => {
      const fromConfig = cfgProviders?.[pid] ?? null;
      const prev = typeof modelsCfg.providers[pid] === 'object' && modelsCfg.providers[pid] ? modelsCfg.providers[pid] : {};
      const baseUrl = normalizeBaseUrlLoose(fromConfig?.baseUrl ?? prev.baseUrl, defaults?.baseUrl || 'https://api.openai.com/v1');
      const apiKey =
        typeof (fromConfig?.apiKey ?? prev.apiKey ?? defaults?.apiKey) === 'string'
          ? (fromConfig?.apiKey ?? prev.apiKey ?? defaults?.apiKey).trim()
          : '';
      const api =
        typeof (fromConfig?.api ?? prev.api ?? defaults?.api) === 'string'
          ? (fromConfig?.api ?? prev.api ?? defaults?.api).trim()
          : 'openai-completions';
      const models = Array.isArray(fromConfig?.models) ? fromConfig.models : Array.isArray(prev.models) ? prev.models : [];
      modelsCfg.providers[pid] = { ...prev, ...fromConfig, baseUrl, apiKey, api, models };
    };

    if (cfgProviders.ollama || modelsCfg.providers.ollama) {
      syncProvider('ollama', { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'a', api: 'openai-completions' });
      try {
        const prev = modelsCfg.providers.ollama;
        const baseUrl = normalizeBaseUrlEnsureV1(prev?.baseUrl, 'http://127.0.0.1:11434/v1');
        modelsCfg.providers.ollama = { ...prev, baseUrl };
      } catch {}

      const primary = typeof config?.agents?.defaults?.model?.primary === 'string' ? config.agents.defaults.model.primary.trim() : '';
      const fallbacks = Array.isArray(config?.agents?.defaults?.model?.fallbacks) ? config.agents.defaults.model.fallbacks : [];
      const lastOllamaFallback =
        fallbacks
          .map((v: any) => (v ?? '').toString().trim())
          .filter((v: string) => v.startsWith('ollama/'))
          .slice(-1)[0] || '';
      const keepOllamaModelId = (() => {
        if (primary.startsWith('ollama/')) return primary.slice('ollama/'.length).trim();
        if (lastOllamaFallback.startsWith('ollama/')) return lastOllamaFallback.slice('ollama/'.length).trim();
        return '';
      })();

      if (keepOllamaModelId) {
        const prev = modelsCfg.providers.ollama;
        const kept = (Array.isArray(prev.models) ? prev.models : []).filter(
          (m: any) => (m?.id || m?.name || '').toString().trim() === keepOllamaModelId,
        );
        if (!kept.length) {
          kept.push({
            id: keepOllamaModelId,
            name: keepOllamaModelId,
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 128000,
            maxTokens: 8192,
          });
        }
        modelsCfg.providers.ollama = { ...prev, models: kept };
      }
    }

    if (cfgProviders['qwen-portal'] || modelsCfg.providers['qwen-portal']) {
      syncProvider('qwen-portal', { baseUrl: 'https://portal.qwen.ai/v1', api: 'openai-completions' });
    }

    if (cfgProviders.zai || modelsCfg.providers.zai) {
      const envKey = typeof config?.env?.ZAI_API_KEY === 'string' ? config.env.ZAI_API_KEY.trim() : '';
      const fromConfig = cfgProviders?.zai ?? {};
      const prev = typeof modelsCfg.providers.zai === 'object' && modelsCfg.providers.zai ? modelsCfg.providers.zai : {};
      const baseUrl = normalizeBaseUrlLoose(fromConfig?.baseUrl ?? prev.baseUrl, 'https://api.z.ai/v1');
      const api = typeof (fromConfig?.api ?? prev.api) === 'string' ? (fromConfig?.api ?? prev.api).trim() : 'openai-completions';
      const models = Array.isArray(fromConfig?.models) ? fromConfig.models : Array.isArray(prev.models) ? prev.models : [];
      const apiKeyFromConfig = typeof fromConfig?.apiKey === 'string' ? fromConfig.apiKey.trim() : '';
      const apiKey = envKey || apiKeyFromConfig || (typeof prev.apiKey === 'string' ? prev.apiKey.trim() : '');
      modelsCfg.providers.zai = { ...prev, ...fromConfig, baseUrl, apiKey, api, models };
    }

    const tmpPath = `${modelsPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(modelsCfg, null, 2)}\n`, 'utf-8');
    fs.renameSync(tmpPath, modelsPath);
    return { status: 'ok', changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to sync models.json' };
  }
}

function replaceHomeTokensInFile(filePath: string, home: string) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const next = raw
      .replaceAll('${HOME}', home)
      .replaceAll('$HOME', home)
      .replace(/~(?=\/)/g, home);
    if (next === raw) return;
    const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, next, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {}
}

function escapeAppleScriptDoubleQuotedString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function runShellAsAdmin(cmd: string, timeoutMs = 120_000) {
  const esc = escapeAppleScriptDoubleQuotedString(cmd);
  const script = `do shell script "${esc}" with administrator privileges`;
  const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], { timeout: timeoutMs } as any);
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return { status: 'ok', output };
}

async function launchctlLoad(plistPath: string) {
  try {
    await execFileAsync('launchctl', ['unload', plistPath], { timeout: 10_000 } as any);
  } catch {}
  const { stdout, stderr } = await execFileAsync('launchctl', ['load', plistPath], { timeout: 20_000 } as any);
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return { status: 'ok', output };
}

async function launchctlUnload(plistPath: string) {
  const { stdout, stderr } = await execFileAsync('launchctl', ['unload', plistPath], { timeout: 20_000 } as any);
  const output = [stdout, stderr].filter(Boolean).join('\n').trim();
  return { status: 'ok', output };
}

async function isOllamaServeRunning() {
  try {
    const { stdout } = await execAsync('ps ax -o command=');
    const text = (stdout || '').toString();
    return text.split('\n').some((line) => line.includes('ollama') && line.includes(' serve'));
  } catch {
    return false;
  }
}

function readTailText(filePath: string, opts?: { maxBytes?: number; maxLines?: number }) {
  const maxBytes = opts?.maxBytes ?? 512 * 1024;
  const maxLines = opts?.maxLines ?? 200;
  try {
    if (!fs.existsSync(filePath)) return { status: 'error', message: `文件不存在：${filePath}`, text: '' };
    const st = fs.statSync(filePath);
    const size = Number(st.size || 0);
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n');
      const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
      return { status: 'ok', text: tail, filePath };
    } finally {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  } catch (e: any) {
    return { status: 'error', message: e?.message || '读取日志失败', text: '' };
  }
}

function buildOllamaLaunchAgentPlist(ollamaPath: string) {
  const stdoutPath = path.join(os.homedir(), 'Library', 'Logs', 'ollama-serve.out.log');
  const stderrPath = path.join(os.homedir(), 'Library', 'Logs', 'ollama-serve.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ollama.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>${ollamaPath}</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${stdoutPath}</string>
  <key>StandardErrorPath</key><string>${stderrPath}</string>
</dict>
</plist>
`;
}

function buildGatewayLaunchAgentPlist(token: string) {
  const stdoutPath = path.join(os.homedir(), 'Library', 'Logs', 'openclaw-gateway.out.log');
  const stderrPath = path.join(os.homedir(), 'Library', 'Logs', 'openclaw-gateway.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.clawdbot.gateway</string>
  <key>ProgramArguments</key>
  <array>
    <string>\${HOME}/.openclaw/agent/bin/openclaw-cn</string>
    <string>gateway</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${stdoutPath}</string>
  <key>StandardErrorPath</key><string>${stderrPath}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENCLAW_GATEWAY_TOKEN</key>
    <string>${token}</string>
  </dict>
</dict>
</plist>
`;
}

async function ensureOllamaRunning() {
  const cli = resolveOllamaCliPathAny();
  if (!cli) {
    return { status: 'error', message: 'Ollama not found (System or Offline)' };
  }
  const tryList = async () => {
    const { stdout } = await execFileAsync(cli, ['list'], { timeout: 20_000 } as any);
    return stdout ? stdout.toString() : '';
  };

  try {
    const models = await tryList();
    const running = (await isOllamaServeRunning()) && (await isLocalPortOpen(11434, 800));
    if (running) return { status: 'ok', models };
  } catch {}

  return await new Promise<{ status: string; models?: string; message?: string }>((resolve) => {
    ollamaProcess = spawn(cli, ['serve'], { stdio: 'ignore', detached: false });
    ollamaProcess.on('error', (err) => resolve({ status: 'error', message: `Failed to spawn ollama: ${err.message}` }));
    let checks = 0;
    const waitForStart = setInterval(async () => {
      checks += 1;
      try {
        const models = await tryList();
        const running = (await isOllamaServeRunning()) && (await isLocalPortOpen(11434, 800));
        if (running) {
          clearInterval(waitForStart);
          resolve({ status: 'ok', models });
          return;
        }
      } catch {}
      if (checks > 18) {
        clearInterval(waitForStart);
        resolve({ status: 'error', message: 'Timeout waiting for ollama' });
      }
    }, 1000);
  });
}

async function ensureOllamaRunningSystem() {
  const cli = resolveOllamaCliPathAny();
  if (!cli) {
    return { status: 'error', message: 'Ollama 未安装' };
  }
  try {
    const { stdout } = await execFileAsync(cli, ['list'], { timeout: 20_000 } as any);
    const models = stdout ? stdout.toString() : '';
    const running = (await isOllamaServeRunning()) && (await isLocalPortOpen(11434, 800));
    if (running) return { status: 'ok', models };
  } catch {}

  return await new Promise<{ status: string; models?: string; message?: string }>((resolve) => {
    ollamaProcess = spawn(cli, ['serve'], { stdio: 'ignore', detached: false });
    ollamaProcess.on('error', (err) => resolve({ status: 'error', message: `Failed to spawn ollama: ${err.message}` }));
    let checks = 0;
    const waitForStart = setInterval(async () => {
      checks += 1;
      try {
        const { stdout } = await execFileAsync(cli, ['list'], { timeout: 10_000 } as any);
        const models = stdout ? stdout.toString() : '';
        const running = (await isOllamaServeRunning()) && (await isLocalPortOpen(11434, 800));
        if (running) {
          clearInterval(waitForStart);
          resolve({ status: 'ok', models });
          return;
        }
      } catch {}
      if (checks > 18) {
        clearInterval(waitForStart);
        resolve({ status: 'error', message: 'Timeout waiting for ollama' });
      }
    }, 1000);
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: true,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(async () => {
  try {
    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    await runOpenClawCli(['gateway', 'restart'], { timeoutMs: 60_000 }).catch(() => {});
  } catch {}
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  if (webuiProcess) {
    webuiProcess.kill();
    webuiProcess = null;
  }
  if (ollamaProcess) {
    ollamaProcess.kill();
    ollamaProcess = null;
  }
  for (const [id, proc] of activeOpenClawAuthRequests.entries()) {
    try {
      proc.kill();
    } catch {}
    activeOpenClawAuthRequests.delete(id);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- IPC Handlers ---

// 1. Check Ollama
ipcMain.handle('check-ollama', async () => {
  const cli = resolveOllamaCliPathAny();
  if (!cli) return { status: 'error', message: 'Ollama 未安装' };
  try {
    const { stdout } = await execFileAsync(cli, ['list'], { timeout: 20_000 } as any);
    const models = stdout ? stdout.toString() : '';
    const running = (await isOllamaServeRunning()) && (await isLocalPortOpen(11434, 800));
    if (!running) {
      return { status: 'error', message: 'Ollama 未运行（需要启动 ollama serve）' };
    }
    return { status: 'ok', models };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'ollama list failed' };
  }
});

// 2. Check OpenClaw
ipcMain.handle('check-openclaw', async () => {
  try {
    const ready = await isLocalPortOpen(18789, 800);
    return { status: 'ok', ready };
  } catch (e: any) {
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('openclaw-gateway-status', async () => {
  return await runOpenClawCli(['gateway', 'status'], { timeoutMs: 25_000 });
});

ipcMain.handle('openclaw-doctor-repair', async () => {
  return await runOpenClawCli(['doctor', '--repair'], { timeoutMs: 180_000 });
});

ipcMain.handle('openclaw-restart', async () => {
  return await restartOpenClawBestEffort();
});

ipcMain.handle('openclaw-models-status', async () => {
  return await runOpenClawCli(['models', 'status'], { timeoutMs: 25_000 });
});

ipcMain.handle('openclaw-status', async () => {
  return await runOpenClawCli(['status'], { timeoutMs: 25_000 });
});

ipcMain.handle('openclaw-security-audit', async (_event, { deep }: { deep?: boolean }) => {
  const args = deep ? ['security', 'audit', '--deep'] : ['security', 'audit'];
  return await runOpenClawCli(args, { timeoutMs: deep ? 180_000 : 45_000 });
});

ipcMain.handle('openclaw-fix-permissions', async () => {
  const configPath = getEffectiveOpenClawConfigPath();
  const stateDir = path.join(os.homedir(), '.openclaw');
  const credentialsDir = path.join(os.homedir(), '.openclaw', 'credentials');
  const results: any = { status: 'ok', changed: false, items: [] as any[] };
  try {
    if (configPath) {
      try {
        fs.chmodSync(configPath, 0o600);
        results.changed = true;
        results.items.push({ target: configPath, mode: '600', status: 'ok' });
      } catch (e: any) {
        results.items.push({ target: configPath, mode: '600', status: 'error', message: e?.message || 'chmod failed' });
      }
    } else {
      results.items.push({ target: 'openclaw.json', mode: '600', status: 'error', message: 'Config path not found' });
    }
    try {
      fs.chmodSync(stateDir, 0o700);
      results.changed = true;
      results.items.push({ target: stateDir, mode: '700', status: 'ok' });
    } catch (e: any) {
      results.items.push({ target: stateDir, mode: '700', status: 'error', message: e?.message || 'chmod failed' });
    }
    try {
      if (!fs.existsSync(credentialsDir)) {
        results.items.push({ target: credentialsDir, mode: '700', status: 'ok', message: 'Credentials dir not found; skipped' });
      } else {
        fs.chmodSync(credentialsDir, 0o700);
        results.changed = true;
        results.items.push({ target: credentialsDir, mode: '700', status: 'ok' });
      }
    } catch (e: any) {
      results.items.push({ target: credentialsDir, mode: '700', status: 'error', message: e?.message || 'chmod failed' });
    }
    const hasError = results.items.some((it: any) => it?.status !== 'ok');
    if (hasError) {
      results.status = 'error';
      results.message = 'Some permission fixes failed';
    }
    return results;
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to fix permissions' };
  }
});

ipcMain.handle('openclaw-repair-config', async () => {
  try {
    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };

    const safeParse = (text: string) => {
      try {
        const v = JSON.parse(text);
        return v && typeof v === 'object' ? v : {};
      } catch {
        return {};
      }
    };

    const deepMerge = (base: any, override: any): any => {
      if (Array.isArray(override)) return override;
      if (override && typeof override === 'object') {
        const out: any = Array.isArray(base) ? [] : { ...(base && typeof base === 'object' ? base : {}) };
        for (const [k, v] of Object.entries(override)) {
          const prev = (out as any)[k];
          (out as any)[k] = deepMerge(prev, v);
        }
        return out;
      }
      return override === undefined ? base : override;
    };

    const currentRaw = fs.readFileSync(configPath, 'utf-8');
    const currentCfg = safeParse(currentRaw || '{}');

    const templatePath = getDefaultOpenClawConfigTemplatePath();
    const templateRaw = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf-8') : '';
    const templateCfg = templateRaw ? safeParse(templateRaw) : {};

    const merged = deepMerge(templateCfg, currentCfg);

    merged.agents = typeof merged.agents === 'object' && merged.agents ? merged.agents : {};
    merged.agents.defaults = typeof merged.agents.defaults === 'object' && merged.agents.defaults ? merged.agents.defaults : {};
    merged.agents.defaults.model =
      typeof merged.agents.defaults.model === 'object' && merged.agents.defaults.model ? merged.agents.defaults.model : {};

    const primary = typeof merged.agents.defaults.model.primary === 'string' ? merged.agents.defaults.model.primary.trim() : '';
    if (!primary) merged.agents.defaults.model.primary = 'qwen-portal/coder-model';

    merged.models = typeof merged.models === 'object' && merged.models ? merged.models : {};
    merged.models.providers = typeof merged.models.providers === 'object' && merged.models.providers ? merged.models.providers : {};
    const ensureProvider = (pid: string, defaults: any) => {
      const prev = typeof merged.models.providers[pid] === 'object' && merged.models.providers[pid] ? merged.models.providers[pid] : {};
      merged.models.providers[pid] = { ...defaults, ...prev };
    };
    ensureProvider('ollama', { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'a', api: 'openai-completions', models: [] });
    ensureProvider('qwen-portal', { baseUrl: 'https://portal.qwen.ai/v1', api: 'openai-completions', apiKey: '' });
    ensureProvider('zai', { baseUrl: 'https://api.z.ai/v1', api: 'openai-completions', apiKey: '' });

    const getInstalledOllamaModels = async () => {
      try {
        const list = await runOllamaCli(['list'], { timeoutMs: 15_000, maxBuffer: 2 * 1024 * 1024 });
        if (list.status !== 'ok') return [] as string[];
        return parseOllamaList(list.output || '').map((m) => (m?.name || '').trim()).filter(Boolean);
      } catch {
        return [] as string[];
      }
    };

    const localNames = await getInstalledOllamaModels();
    const keepName = localNames.find((n) => n && !n.includes(':cloud') && !n.includes('-cloud') && !n.startsWith('x/')) || localNames[0] || '';
    if (keepName) {
      const prev = merged.models.providers.ollama;
      const prevModels = Array.isArray(prev.models) ? prev.models : [];
      const kept = prevModels.filter((m: any) => (m?.id || m?.name || '').toString().trim() === keepName);
      if (!kept.length) {
        kept.unshift({
          id: keepName,
          name: keepName,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 8192,
        });
      }
      merged.models.providers.ollama = { ...prev, models: kept };

      const mergedPrimary = typeof merged.agents.defaults.model.primary === 'string' ? merged.agents.defaults.model.primary.trim() : '';
      if (!mergedPrimary || mergedPrimary === 'qwen-portal/coder-model') {
        merged.agents.defaults.model.primary = `ollama/${keepName}`;
      }
    }

    if (!Array.isArray(merged.agents.defaults.model.fallbacks) || merged.agents.defaults.model.fallbacks.length === 0) {
      const p = typeof merged.agents.defaults.model.primary === 'string' ? merged.agents.defaults.model.primary.trim() : '';
      const fallbacks: string[] = [];
      if (p) fallbacks.push(p);
      fallbacks.push('zai/glm-4.7-flash');
      if (keepName) fallbacks.push(`ollama/${keepName}`);
      merged.agents.defaults.model.fallbacks = Array.from(new Set(fallbacks)).filter(Boolean);
    }

    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, merged);
    try {
      normalizeOpenClawConfigFile(configPath);
      ensureOllamaOpenAiCompatInConfigFile(configPath);
      const modelsPath = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'models.json');
      ensureOllamaOpenAiCompatInModelsFile(modelsPath);
      ensureAgentModelsFileSyncedWithConfig(modelsPath, configPath);
    } catch {}

    const rr = await restartOpenClawBestEffort();
    return { status: rr.status, output: rr.output, message: rr.message, changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to repair config' };
  }
});

ipcMain.handle('openclaw-network-online', async () => {
  try {
    const online = await checkOnlineByQwenPortal(2500);
    return { status: 'ok', online };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Network check failed', online: false };
  }
});

ipcMain.handle('openclaw-last-llm-error', async () => {
  try {
    const sessionFile = getActiveMainSessionFilePath();
    if (!sessionFile) return { status: 'ok', found: false };
    const last = parseLastJsonlRecord(sessionFile);
    if (!last || typeof last !== 'object') return { status: 'ok', found: false };
    if (last.type !== 'message') return { status: 'ok', found: false };
    const msg = last.message || null;
    const role = msg?.role;
    if (role !== 'assistant') return { status: 'ok', found: false };
    const errorMessage = (msg?.errorMessage || '').toString();
    const stopReason = (msg?.stopReason || '').toString();
    const provider = (msg?.provider || '').toString();
    const model = (msg?.model || '').toString();
    const timestamp = (msg?.timestamp || last.timestamp || '').toString();
    const hasError = Boolean(errorMessage) || stopReason === 'error';
    if (!hasError) return { status: 'ok', found: false };
    return {
      status: 'ok',
      found: true,
      provider,
      model,
      errorMessage,
      stopReason,
      timestamp,
      sessionFile,
    };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to read session error', found: false };
  }
});

ipcMain.handle('openclaw-session-stall-status', async () => {
  try {
    const sessionFile = getActiveMainSessionFilePath();
    if (!sessionFile) return { status: 'ok', found: false };
    const markers = parseRecentChatMarkersFromJsonl(sessionFile);
    if (!markers) return { status: 'ok', found: false };
    const lastUserAt = (markers.lastUserAt || '').toString();
    const lastAssistantAt = (markers.lastAssistantAt || '').toString();
    if (!lastUserAt) return { status: 'ok', found: false };
    const userMs = Date.parse(lastUserAt);
    const asstMs = lastAssistantAt ? Date.parse(lastAssistantAt) : NaN;
    const pending = Number.isFinite(userMs) && (!Number.isFinite(asstMs) || userMs > asstMs);
    const ageMs = Number.isFinite(userMs) ? Math.max(0, Date.now() - userMs) : null;
    return {
      status: 'ok',
      found: true,
      pending,
      ageMs,
      lastUserAt,
      lastAssistantAt: lastAssistantAt || null,
      lastAssistantErrorMessage: markers.lastAssistantErrorMessage || null,
      lastAssistantStopReason: markers.lastAssistantStopReason || null,
      lastAssistantProvider: markers.lastAssistantProvider || null,
      lastAssistantModel: markers.lastAssistantModel || null,
      sessionFile,
    };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to read session stall status', found: false };
  }
});

ipcMain.handle('openclaw-set-primary-model', async (_event, { ref }) => {
  try {
    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const modelRef = typeof ref === 'string' ? ref.trim() : '';
    if (!modelRef || !modelRef.includes('/')) return { status: 'error', message: 'Invalid model ref' };
    config.agents = typeof config.agents === 'object' && config.agents ? config.agents : {};
    config.agents.defaults = typeof config.agents.defaults === 'object' && config.agents.defaults ? config.agents.defaults : {};
    config.agents.defaults.model = typeof config.agents.defaults.model === 'object' && config.agents.defaults.model ? config.agents.defaults.model : {};
    if (config.agents.defaults.model.primary === modelRef) return { status: 'ok', changed: false };
    config.agents.defaults.model.primary = modelRef;
    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, config);
    const rr = await restartOpenClawBestEffort();
    return { status: rr.status, output: rr.output, message: rr.message, changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to set primary model' };
  }
});

ipcMain.handle('openclaw-switch-to-local-ollama', async () => {
  try {
    const portOk = await isLocalPortOpen(11434, 800);
    if (!portOk) return { status: 'error', message: '本地 Ollama 未就绪（11434 不可用）' };

    const list = await runOllamaCli(['list'], { timeoutMs: 15_000, maxBuffer: 2 * 1024 * 1024 });
    if (list.status !== 'ok') return { status: 'error', message: list.message || 'ollama list failed', output: list.output };
    const models = parseOllamaList(list.output || '');
    const picked = models.find((m) => m?.name && !m.name.includes(':cloud') && !m.name.includes('-cloud') && !m.name.startsWith('x/'))?.name || models[0]?.name;
    const model = (picked || '').trim();
    if (!model) return { status: 'error', message: '未发现本地 Ollama 模型' };

    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    config.models = typeof config.models === 'object' && config.models ? config.models : {};
    config.models.providers = typeof config.models.providers === 'object' && config.models.providers ? config.models.providers : {};
    const prevOllama = typeof config.models.providers.ollama === 'object' && config.models.providers.ollama ? config.models.providers.ollama : {};
    config.models.providers.ollama = {
      ...prevOllama,
      baseUrl: prevOllama.baseUrl || 'http://127.0.0.1:11434/v1',
      api: prevOllama.api || 'openai-completions',
      apiKey:
        typeof prevOllama.apiKey === 'string' && prevOllama.apiKey.trim()
          ? prevOllama.apiKey.trim()
          : 'a',
      models: Array.isArray(prevOllama.models) ? prevOllama.models : [],
    };
    const existingIds = new Set((config.models.providers.ollama.models || []).map((m: any) => (m?.id || m?.name || '').toString()));
    const keptModels = (config.models.providers.ollama.models || []).filter(
      (m: any) => (m?.id || m?.name || '').toString().trim() === model,
    );
    if (!existingIds.has(model)) {
      keptModels.unshift({
        id: model,
        name: model,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
      });
    }
    for (const m of keptModels) {
      const ctx = Number(m?.contextWindow || 0);
      if (!Number.isFinite(ctx) || ctx < 16000) m.contextWindow = 32768;
      const mt = Number(m?.maxTokens || 0);
      if (!Number.isFinite(mt) || mt < 1024) m.maxTokens = 8192;
    }
    config.models.providers.ollama.models = keptModels;

    config.agents = typeof config.agents === 'object' && config.agents ? config.agents : {};
    config.agents.defaults = typeof config.agents.defaults === 'object' && config.agents.defaults ? config.agents.defaults : {};
    config.agents.defaults.model = typeof config.agents.defaults.model === 'object' && config.agents.defaults.model ? config.agents.defaults.model : {};
    config.agents.defaults.model.primary = `ollama/${model}`;
    config.agents.defaults.models =
      typeof config.agents.defaults.models === 'object' && config.agents.defaults.models ? config.agents.defaults.models : {};
    for (const k of Object.keys(config.agents.defaults.models)) {
      if (!k.startsWith('ollama/')) continue;
      try {
        delete config.agents.defaults.models[k];
      } catch {}
    }
    const ref = `ollama/${model}`;
    config.agents.defaults.models[ref] =
      typeof config.agents.defaults.models[ref] === 'object' && config.agents.defaults.models[ref]
        ? config.agents.defaults.models[ref]
        : {};
    if (!config.agents.defaults.models[ref].alias) {
      config.agents.defaults.models[ref].alias = 'ollama';
    }

    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, config);
    const rr = await restartOpenClawBestEffort();
    return { status: rr.status, output: rr.output, message: rr.message, model };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to switch to local ollama' };
  }
});

ipcMain.handle('openclaw-set-local-ollama-model', async (_event, { model }) => {
  try {
    const picked = (typeof model === 'string' ? model : '').trim();
    if (!picked) return { status: 'error', message: 'Missing model' };

    const portOk = await isLocalPortOpen(11434, 800);
    if (!portOk) return { status: 'error', message: '本地 Ollama 未就绪（11434 不可用）' };

    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    config.models = typeof config.models === 'object' && config.models ? config.models : {};
    config.models.providers = typeof config.models.providers === 'object' && config.models.providers ? config.models.providers : {};
    const prevOllama = typeof config.models.providers.ollama === 'object' && config.models.providers.ollama ? config.models.providers.ollama : {};
    config.models.providers.ollama = {
      ...prevOllama,
      baseUrl: prevOllama.baseUrl || 'http://127.0.0.1:11434/v1',
      api: prevOllama.api || 'openai-completions',
      apiKey:
        typeof prevOllama.apiKey === 'string' && prevOllama.apiKey.trim()
          ? prevOllama.apiKey.trim()
          : 'a',
      models: Array.isArray(prevOllama.models) ? prevOllama.models : [],
    };
    const existingIds = new Set((config.models.providers.ollama.models || []).map((m: any) => (m?.id || m?.name || '').toString()));
    const keptModels = (config.models.providers.ollama.models || []).filter(
      (m: any) => (m?.id || m?.name || '').toString().trim() === picked,
    );
    if (!existingIds.has(picked)) {
      keptModels.unshift({
        id: picked,
        name: picked,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
      });
    }
    for (const m of keptModels) {
      const ctx = Number(m?.contextWindow || 0);
      if (!Number.isFinite(ctx) || ctx < 16000) m.contextWindow = 32768;
      const mt = Number(m?.maxTokens || 0);
      if (!Number.isFinite(mt) || mt < 1024) m.maxTokens = 8192;
    }
    config.models.providers.ollama.models = keptModels;

    config.agents = typeof config.agents === 'object' && config.agents ? config.agents : {};
    config.agents.defaults = typeof config.agents.defaults === 'object' && config.agents.defaults ? config.agents.defaults : {};
    config.agents.defaults.model = typeof config.agents.defaults.model === 'object' && config.agents.defaults.model ? config.agents.defaults.model : {};
    config.agents.defaults.model.primary = `ollama/${picked}`;
    config.agents.defaults.models =
      typeof config.agents.defaults.models === 'object' && config.agents.defaults.models ? config.agents.defaults.models : {};
    for (const k of Object.keys(config.agents.defaults.models)) {
      if (!k.startsWith('ollama/')) continue;
      try {
        delete config.agents.defaults.models[k];
      } catch {}
    }
    const ref = `ollama/${picked}`;
    config.agents.defaults.models[ref] =
      typeof config.agents.defaults.models[ref] === 'object' && config.agents.defaults.models[ref]
        ? config.agents.defaults.models[ref]
        : {};
    if (!config.agents.defaults.models[ref].alias) {
      config.agents.defaults.models[ref].alias = 'ollama';
    }

    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, config);
    const rr = await restartOpenClawBestEffort();
    return { status: rr.status, output: rr.output, message: rr.message, model: picked };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to set local ollama model' };
  }
});

ipcMain.handle('openclaw-add-model', async (_event, { providerId, baseUrl, apiKey, api, modelId, setPrimary }) => {
  try {
    let pid = (typeof providerId === 'string' ? providerId : '').trim();
    let mid = (typeof modelId === 'string' ? modelId : '').trim();
    if (!pid) return { status: 'error', message: 'Missing providerId' };
    if (!mid) return { status: 'error', message: 'Missing modelId' };

    const looksLikeGlm47 = (() => {
      const lower = mid.toLowerCase();
      return lower === 'glm-4.7' || lower === 'zai-org/glm-4.7';
    })();
    if (looksLikeGlm47 && pid.trim().toLowerCase() === 'nvidia') {
      pid = 'zai';
      mid = 'glm-4.7';
    }

    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    config.models = typeof config.models === 'object' && config.models ? config.models : {};
    config.models.providers = typeof config.models.providers === 'object' && config.models.providers ? config.models.providers : {};
    const prev = typeof config.models.providers[pid] === 'object' && config.models.providers[pid] ? config.models.providers[pid] : {};
    const prevModels = Array.isArray(prev.models) ? prev.models : [];

    const nextProvider = { ...prev };
    const rawBaseUrl = typeof baseUrl === 'string' ? baseUrl.trim() : '';
    if (pid === 'zai') {
      const normalized = (rawBaseUrl || 'https://api.z.ai/v1').replace(/\/+$/, '');
      nextProvider.baseUrl = normalized;
    } else if (rawBaseUrl) {
      const normalized = rawBaseUrl.replace(/\/+$/, '');
      nextProvider.baseUrl = normalized;
    }
    if (typeof apiKey === 'string') nextProvider.apiKey = apiKey.trim();
    if (typeof api === 'string' && api.trim()) nextProvider.api = api.trim();
    nextProvider.models = prevModels;

    const existingIds = new Set((nextProvider.models || []).map((m: any) => (m?.id || m?.name || '').toString()));
    if (!existingIds.has(mid)) {
      nextProvider.models.unshift({
        id: mid,
        name: mid,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      });
    }
    config.models.providers[pid] = nextProvider;

    const ref = `${pid}/${mid}`;
    config.agents = typeof config.agents === 'object' && config.agents ? config.agents : {};
    config.agents.defaults = typeof config.agents.defaults === 'object' && config.agents.defaults ? config.agents.defaults : {};
    config.agents.defaults.model = typeof config.agents.defaults.model === 'object' && config.agents.defaults.model ? config.agents.defaults.model : {};
    config.agents.defaults.models =
      typeof config.agents.defaults.models === 'object' && config.agents.defaults.models ? config.agents.defaults.models : {};
    if (!config.agents.defaults.models[ref] || typeof config.agents.defaults.models[ref] !== 'object') {
      config.agents.defaults.models[ref] = {};
    }
    if (!config.agents.defaults.models[ref].alias) {
      config.agents.defaults.models[ref].alias = pid.slice(0, 16);
    }

    if (pid === 'zai' && typeof apiKey === 'string' && apiKey.trim()) {
      config.env = typeof config.env === 'object' && config.env ? config.env : {};
      config.env.ZAI_API_KEY = apiKey.trim();
    }
    if (Boolean(setPrimary)) {
      config.agents.defaults.model.primary = ref;
    }

    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, config);
    const rr = await restartOpenClawBestEffort();
    return { status: rr.status, output: rr.output, message: rr.message, ref, changed: true };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Failed to add model' };
  }
});

ipcMain.handle('openclaw-auth-login-start', async (_event, { requestId, provider }) => {
  const resolvedRequestId = requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    for (const [id, proc] of activeOpenClawAuthRequests.entries()) {
      try {
        proc.kill();
      } catch {}
      activeOpenClawAuthRequests.delete(id);
    }

    const cli = resolveOpenClawCliPathAny();
    if (!cli) return { status: 'error', message: 'openclaw-cn not found (System or Offline)' };
    const p = typeof provider === 'string' ? provider.trim() : '';
    if (!p) return { status: 'error', message: 'Provider is required' };

    const baseArgs = ['models', 'auth', 'login', '--provider', p];
    const toSingleLineCmd = () => {
      const parts = ['openclaw-cn', ...baseArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))];
      return parts.join(' ');
    };
    const spawnWithTty = () => {
      if (process.platform === 'darwin') {
        const scriptPath = fs.existsSync('/usr/bin/script') ? '/usr/bin/script' : 'script';
        return spawn(scriptPath, ['-q', '/dev/null', cli, ...baseArgs], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
      }
      return spawn(cli, baseArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    };
    const proc = spawnWithTty();
    activeOpenClawAuthRequests.set(resolvedRequestId, proc);
    const startedAtMs = Date.now();
    const initialProfilesMtime = getFileMtimeMsSafe(getAuthProfilesPath());
    let authDetected = 0;
    const authPoll =
      p === 'qwen-portal'
        ? setInterval(() => {
            try {
              if (proc.killed) return;
              const requireAfter = Math.max(startedAtMs, initialProfilesMtime);
              const ok = hasValidQwenPortalAuthProfile({ requireMtimeAfterMs: requireAfter });
              if (!ok) return;
              authDetected += 1;
              if (authDetected < 2) return;
              try {
                proc.kill();
              } catch {}
              if (win && !win.isDestroyed()) {
                win.webContents.send('openclaw-auth-chunk', {
                  requestId: resolvedRequestId,
                  stream: 'stdout',
                  data: '检测到 Qwen OAuth 已写入鉴权文件，结束等待。\n',
                });
              }
            } catch {}
          }, 1200)
        : null;

    let buffer = '';
    let flushTimer: NodeJS.Timeout | null = null;
    let openedUrl = '';
    const flush = () => {
      flushTimer = null;
      if (!buffer) return;
      if (win && !win.isDestroyed()) {
        win.webContents.send('openclaw-auth-chunk', { requestId: resolvedRequestId, stream: 'stdout', data: buffer });
      }
      buffer = '';
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 50);
    };
    const maybeOpenAuthUrl = (text: string) => {
      if (openedUrl) return;
      const url = extractAuthUrlFromText(text);
      if (!url) return;
      openedUrl = url;
      try {
        shell.openExternal(url);
      } catch {}
      const code = (() => {
        try {
          const u = new URL(url);
          return u.searchParams.get('user_code') || '';
        } catch {
          return '';
        }
      })();
      if (win && !win.isDestroyed()) {
        win.webContents.send('openclaw-auth-chunk', { requestId: resolvedRequestId, authUrl: url, userCode: code });
      }
    };
    const append = (d: Buffer) => {
      const s = stripAnsiAndControl(d.toString());
      if (!s) return;
      buffer += s;
      if (buffer.length > 250_000) buffer = buffer.slice(-250_000);
      maybeOpenAuthUrl(buffer);
      if (buffer.length > 24_000) flush();
      else scheduleFlush();
    };

    proc.stdout?.on('data', (d) => append(d as Buffer));
    proc.stderr?.on('data', (d) => append(d as Buffer));
    proc.on('exit', (code, signal) => {
      activeOpenClawAuthRequests.delete(resolvedRequestId);
      if (authPoll) clearInterval(authPoll);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
      if (win && !win.isDestroyed()) {
        win.webContents.send('openclaw-auth-chunk', { requestId: resolvedRequestId, done: true, code, signal });
      }
    });
    proc.on('error', (err: any) => {
      activeOpenClawAuthRequests.delete(resolvedRequestId);
      if (authPoll) clearInterval(authPoll);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      buffer += `\n[error] ${err?.message || 'spawn error'}\n`;
      flush();
      if (win && !win.isDestroyed()) {
        win.webContents.send('openclaw-auth-chunk', { requestId: resolvedRequestId, error: err?.message || 'spawn error', done: true });
      }
    });

    if (win && !win.isDestroyed()) {
      win.webContents.send('openclaw-auth-chunk', {
        requestId: resolvedRequestId,
        stream: 'stdout',
        data: `$ ${toSingleLineCmd()}\n`,
      });
    }
    return { status: 'ok', requestId: resolvedRequestId };
  } catch (e: any) {
    activeOpenClawAuthRequests.delete(resolvedRequestId);
    return { status: 'error', message: e?.message || 'Failed to start auth login' };
  }
});

ipcMain.handle('openclaw-auth-login-stop', async (_event, { requestId }) => {
  const proc = activeOpenClawAuthRequests.get(requestId);
  if (!proc) return { status: 'error', message: 'Process not found' };
  try {
    proc.kill();
  } finally {
    activeOpenClawAuthRequests.delete(requestId);
  }
  return { status: 'ok' };
});

ipcMain.handle('ollama-service-start', async () => {
  try {
    const plist = getOllamaLaunchAgentPlistPath();
    if (!fs.existsSync(plist)) {
      const systemOllama = resolveOllamaCliPathSystem();
      if (!systemOllama) return { status: 'error', message: '未检测到系统 Ollama（/usr/local/bin/ollama 或 PATH）' };
      fs.mkdirSync(getLaunchAgentsDir(), { recursive: true });
      fs.writeFileSync(plist, buildOllamaLaunchAgentPlist(systemOllama), 'utf-8');
    }
    const res = await launchctlLoad(plist);
    return { status: 'ok', output: res.output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'launchctl load failed', output };
  }
});

ipcMain.handle('ollama-service-stop', async () => {
  try {
    const plist = getOllamaLaunchAgentPlistPath();
    if (!fs.existsSync(plist)) return { status: 'error', message: `未找到启动配置：${plist}` };
    const res = await launchctlUnload(plist);
    return { status: 'ok', output: res.output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'launchctl unload failed', output };
  }
});

ipcMain.handle('gateway-service-start', async () => {
  try {
    const plist = getGatewayLaunchAgentPlistPath();
    const installed = await ensureOpenClawCnInstalled();
    if (installed.status !== 'ok') return installed;
    if (!fs.existsSync(plist)) {
      fs.mkdirSync(getLaunchAgentsDir(), { recursive: true });
      const configPath = getEffectiveOpenClawConfigPath();
      ensureOpenClawConfigExists(configPath);
      const existingToken = getEffectiveGatewayToken();
      const token = existingToken || crypto.randomBytes(24).toString('hex');
      if (!existingToken) setGatewayTokenInConfig(configPath, token);
      fs.writeFileSync(plist, buildGatewayLaunchAgentPlist(token), 'utf-8');
    }
    const res = await launchctlLoad(plist);
    return { status: 'ok', output: res.output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'launchctl load failed', output };
  }
});

ipcMain.handle('gateway-service-stop', async () => {
  try {
    const plist = getGatewayLaunchAgentPlistPath();
    if (!fs.existsSync(plist)) return { status: 'error', message: `未找到启动配置：${plist}` };
    const res = await launchctlUnload(plist);
    return { status: 'ok', output: res.output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'launchctl unload failed', output };
  }
});

function getOpenClawConfigPath() {
  return path.join(os.homedir(), '.openclaw', 'openclaw.json');
}

function getOpenClawMainSessionsIndexPath() {
  return path.join(os.homedir(), '.openclaw', 'agents', 'main', 'sessions', 'sessions.json');
}

function getLegacyOpenClawConfigPath() {
  return path.join(app.getPath('appData'), 'wage-app', 'config', 'openclaw.json');
}

function getDefaultOpenClawConfigTemplatePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'default-openclaw.json')
    : path.join(__dirname, '../resources/default-openclaw.json');
}

function getBundledAgentPackagePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'agent.gz')
    : path.join(__dirname, '../resources/agent.gz');
}

const DEFAULT_TEMPLATE_GATEWAY_TOKEN = '14f34e79f0c3693a634f9c24fd2739cf5dd6390ffe1812f6';

function stripWrappedBackticks(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('`') && trimmed.endsWith('`')) {
    return trimmed.slice(1, -1).trim();
  }
  return value;
}

function deepStripWrappedBackticks(input: any): { value: any; changed: boolean } {
  let changed = false;
  if (typeof input === 'string') {
    const next = stripWrappedBackticks(input);
    return { value: next, changed: next !== input };
  }
  if (Array.isArray(input)) {
    const nextArr = input.map((v) => {
      const res = deepStripWrappedBackticks(v);
      changed = changed || res.changed;
      return res.value;
    });
    return { value: nextArr, changed };
  }
  if (input && typeof input === 'object') {
    const nextObj: any = {};
    for (const [k, v] of Object.entries(input)) {
      const res = deepStripWrappedBackticks(v);
      changed = changed || res.changed;
      nextObj[k] = res.value;
    }
    return { value: nextObj, changed };
  }
  return { value: input, changed: false };
}

function sanitizeOpenClawConfigObject(config: any): { config: any; changed: boolean } {
  let changed = false;
  const stripped = deepStripWrappedBackticks(config);
  config = stripped.value;
  changed = changed || stripped.changed;

  const home = os.homedir();
  const expandTilde = (input: any): { value: any; changed: boolean } => {
    if (typeof input === 'string') {
      if (input === '~') return { value: home, changed: true };
      if (input.startsWith('~/')) return { value: `${home}/${input.slice(2)}`, changed: true };
      if (input.startsWith('~\\')) return { value: `${home}\\${input.slice(2)}`, changed: true };
      return { value: input, changed: false };
    }
    if (Array.isArray(input)) {
      let anyChanged = false;
      const next = input.map((v) => {
        const res = expandTilde(v);
        anyChanged = anyChanged || res.changed;
        return res.value;
      });
      return { value: next, changed: anyChanged };
    }
    if (input && typeof input === 'object') {
      let anyChanged = false;
      const nextObj: any = {};
      for (const [k, v] of Object.entries(input)) {
        const res = expandTilde(v);
        anyChanged = anyChanged || res.changed;
        nextObj[k] = res.value;
      }
      return { value: nextObj, changed: anyChanged };
    }
    return { value: input, changed: false };
  };
  const expanded = expandTilde(config);
  config = expanded.value;
  changed = changed || expanded.changed;

  if (config?.meta && typeof config.meta === 'object' && (config.meta as any).wage) {
    delete (config.meta as any).wage;
    changed = true;
  }

  const ollamaProvider = config?.models?.providers?.ollama;
  if (ollamaProvider && typeof ollamaProvider === 'object') {
    const models = (ollamaProvider as any).models;
    if (Array.isArray(models)) {
      for (const m of models) {
        if (m && typeof m === 'object' && 'local' in (m as any)) {
          delete (m as any).local;
          changed = true;
        }
      }
    }
    const prevApi = (ollamaProvider as any).api;
    if (typeof prevApi !== 'string' || !prevApi.trim()) {
      (ollamaProvider as any).api = 'openai-completions';
      changed = true;
    } else if (prevApi.trim() !== prevApi) {
      (ollamaProvider as any).api = prevApi.trim();
      changed = true;
    }
    const prevBaseUrl = (ollamaProvider as any).baseUrl;
    if (typeof prevBaseUrl === 'string' && prevBaseUrl.trim()) {
      const base = prevBaseUrl.trim().replace(/\/+$/, '');
      const normalized = base.endsWith('/v1') ? base : `${base}/v1`;
      if (normalized !== prevBaseUrl) {
        (ollamaProvider as any).baseUrl = normalized;
        changed = true;
      }
    } else {
      (ollamaProvider as any).baseUrl = 'http://127.0.0.1:11434/v1';
      changed = true;
    }
    const prevKey = (ollamaProvider as any).apiKey;
    if (typeof prevKey !== 'string' || !prevKey.trim()) {
      (ollamaProvider as any).apiKey = 'a';
      changed = true;
    } else if (prevKey.trim() !== prevKey) {
      (ollamaProvider as any).apiKey = prevKey.trim();
      changed = true;
    }
  }

  const modelDefaults = config?.agents?.defaults?.model;
  if (modelDefaults && typeof modelDefaults === 'object' && !Array.isArray(modelDefaults)) {
    if ('fallback' in (modelDefaults as any)) {
      delete (modelDefaults as any).fallback;
      changed = true;
    }
    if ('policy' in (modelDefaults as any)) {
      delete (modelDefaults as any).policy;
      changed = true;
    }
  }

  try {
    const ensureProviderBase = (pid: string, defaults: any) => {
      config.models = typeof config.models === 'object' && config.models ? config.models : {};
      config.models.providers = typeof config.models.providers === 'object' && config.models.providers ? config.models.providers : {};
      const prev = typeof config.models.providers[pid] === 'object' && config.models.providers[pid] ? config.models.providers[pid] : {};
      const next = { ...defaults, ...prev };
      config.models.providers[pid] = next;
      return next;
    };

    const primaryRef = typeof config?.agents?.defaults?.model?.primary === 'string' ? config.agents.defaults.model.primary.trim() : '';
    const fallbacks = Array.isArray(config?.agents?.defaults?.model?.fallbacks) ? config.agents.defaults.model.fallbacks : [];
    const lastOllamaFallback =
      fallbacks
        .map((v: any) => (v ?? '').toString().trim())
        .filter((v: string) => v.startsWith('ollama/'))
        .slice(-1)[0] || '';
    const keepOllamaModelId = (() => {
      if (primaryRef.startsWith('ollama/')) return primaryRef.slice('ollama/'.length).trim();
      if (lastOllamaFallback.startsWith('ollama/')) return lastOllamaFallback.slice('ollama/'.length).trim();
      return '';
    })();

    if (keepOllamaModelId) {
      const provider = ensureProviderBase('ollama', {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'a',
        api: 'openai-completions',
        models: [],
      });
      const baseUrl = typeof provider.baseUrl === 'string' && provider.baseUrl.trim() ? provider.baseUrl.trim() : 'http://127.0.0.1:11434/v1';
      const normalizedBaseUrl = baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl.replace(/\/+$/, '')}/v1`;
      if (provider.baseUrl !== normalizedBaseUrl) {
        provider.baseUrl = normalizedBaseUrl;
        changed = true;
      }
      if (typeof provider.apiKey !== 'string' || !provider.apiKey.trim()) {
        provider.apiKey = 'a';
        changed = true;
      } else if (provider.apiKey.trim() !== provider.apiKey) {
        provider.apiKey = provider.apiKey.trim();
        changed = true;
      }
      if (typeof provider.api !== 'string' || !provider.api.trim()) {
        provider.api = 'openai-completions';
        changed = true;
      } else if (provider.api.trim() !== provider.api) {
        provider.api = provider.api.trim();
        changed = true;
      }
      const prevModels = Array.isArray(provider.models) ? provider.models : [];
      const kept = prevModels.filter((m: any) => (m?.id || m?.name || '').toString().trim() === keepOllamaModelId);
      if (!kept.length) {
        kept.unshift({
          id: keepOllamaModelId,
          name: keepOllamaModelId,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768,
          maxTokens: 8192,
        });
        changed = true;
      }
      provider.models = kept;
    }
  } catch {}

  const telegram = config?.channels?.telegram;
  if (telegram && typeof telegram === 'object') {
    const token = (telegram as any).botToken;
    if (typeof token === 'string' && token.includes('open.feishu.cn/open-apis/bot/v2/hook/')) {
      if ((telegram as any).enabled !== false) {
        (telegram as any).enabled = false;
        changed = true;
      }
      if ((telegram as any).botToken !== '') {
        (telegram as any).botToken = '';
        changed = true;
      }
    }
  }

  const authToken = config?.gateway?.auth?.token;
  if (typeof authToken !== 'string' || !authToken.trim()) {
    if (config?.gateway?.auth?.mode === 'token') {
      config.gateway.auth.token = crypto.randomBytes(24).toString('hex');
      changed = true;
    }
  } else if (authToken.trim() === DEFAULT_TEMPLATE_GATEWAY_TOKEN) {
    config.gateway.auth.token = crypto.randomBytes(24).toString('hex');
    changed = true;
  } else if (authToken.trim() !== authToken) {
    config.gateway.auth.token = authToken.trim();
    changed = true;
  }

  return { config, changed };
}

function writeJsonAtomic(filePath: string, data: any) {
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const content = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(tmpPath, content, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function normalizeOpenClawConfigFile(configPath: string) {
  if (!fs.existsSync(configPath)) return;
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const res = sanitizeOpenClawConfigObject(parsed);
    if (res.changed) {
      createNonOverwritingBackup(configPath);
      writeJsonAtomic(configPath, res.config);
    }
  } catch {
    try {
      createNonOverwritingBackup(configPath);
      const templatePath = getDefaultOpenClawConfigTemplatePath();
      if (fs.existsSync(templatePath)) {
        fs.copyFileSync(templatePath, configPath);
        normalizeOpenClawConfigFile(configPath);
      }
    } catch {}
  }
}

function ensureOpenClawConfigExists(targetConfigPath: string) {
  const legacyConfigPath = getLegacyOpenClawConfigPath();
  if (fs.existsSync(targetConfigPath)) {
    normalizeOpenClawConfigFile(targetConfigPath);
    return;
  }

  fs.mkdirSync(path.dirname(targetConfigPath), { recursive: true });

  if (fs.existsSync(legacyConfigPath)) {
    fs.copyFileSync(legacyConfigPath, targetConfigPath);
    normalizeOpenClawConfigFile(targetConfigPath);
    return;
  }

  const templatePath = getDefaultOpenClawConfigTemplatePath();
  if (fs.existsSync(templatePath)) {
    fs.copyFileSync(templatePath, targetConfigPath);
    normalizeOpenClawConfigFile(targetConfigPath);
  }
}

function createNonOverwritingBackup(filePath: string) {
  if (!fs.existsSync(filePath)) return;

  const base = `${filePath}.bak`;
  let candidate = base;
  let index = 0;
  while (fs.existsSync(candidate)) {
    index += 1;
    candidate = `${base}.${index}`;
  }
  fs.copyFileSync(filePath, candidate, fs.constants.COPYFILE_EXCL);
}

function readJsonFromFileSafe(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getActiveMainSessionFilePath(): string | null {
  try {
    const indexPath = getOpenClawMainSessionsIndexPath();
    const sessions = readJsonFromFileSafe(indexPath);
    if (!sessions || typeof sessions !== 'object') return null;
    const preferred = sessions['agent:main:main'] || sessions[Object.keys(sessions)[0] as any];
    const sessionFile = preferred?.sessionFile;
    return typeof sessionFile === 'string' && sessionFile.trim() ? sessionFile.trim() : null;
  } catch {
    return null;
  }
}

function parseLastJsonlRecord(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const maxRead = 220_000;
    const start = Math.max(0, stat.size - maxRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        try {
          return JSON.parse(lines[i]);
        } catch {}
      }
      return null;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function parseRecentChatMarkersFromJsonl(filePath: string): {
  lastUserAt?: string;
  lastAssistantAt?: string;
  lastAssistantErrorMessage?: string;
  lastAssistantStopReason?: string;
  lastAssistantProvider?: string;
  lastAssistantModel?: string;
} | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const maxRead = 420_000;
    const start = Math.max(0, stat.size - maxRead);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf-8');
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      let lastUserAt: string | undefined;
      let lastAssistantAt: string | undefined;
      let lastAssistantErrorMessage: string | undefined;
      let lastAssistantStopReason: string | undefined;
      let lastAssistantProvider: string | undefined;
      let lastAssistantModel: string | undefined;

      for (let i = lines.length - 1; i >= 0; i -= 1) {
        let rec: any = null;
        try {
          rec = JSON.parse(lines[i]);
        } catch {
          continue;
        }
        if (!rec || typeof rec !== 'object') continue;
        if (rec.type !== 'message') continue;
        const msg = rec.message || null;
        const role = msg?.role;
        const ts = (msg?.timestamp || rec.timestamp || '').toString();
        if (!ts) continue;
        if (!lastAssistantAt && role === 'assistant') {
          lastAssistantAt = ts;
          lastAssistantProvider = (msg?.provider || '').toString() || undefined;
          lastAssistantModel = (msg?.model || '').toString() || undefined;
          lastAssistantErrorMessage = (msg?.errorMessage || '').toString() || undefined;
          lastAssistantStopReason = (msg?.stopReason || '').toString() || undefined;
        } else if (!lastUserAt && role === 'user') {
          lastUserAt = ts;
        }
        if (lastUserAt && lastAssistantAt) break;
      }

      return {
        lastUserAt,
        lastAssistantAt,
        lastAssistantErrorMessage,
        lastAssistantStopReason,
        lastAssistantProvider,
        lastAssistantModel,
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

async function checkOnlineByQwenPortal(timeoutMs = 2500) {
  return await new Promise<boolean>((resolve) => {
    const request = electronNet.request({
      method: 'HEAD',
      protocol: 'https:',
      hostname: 'portal.qwen.ai',
      path: '/',
    });
    let settled = false;
    const done = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const timer = setTimeout(() => {
      try {
        if (typeof (request as any).abort === 'function') (request as any).abort();
        if (typeof (request as any).destroy === 'function') (request as any).destroy();
      } catch {}
      done(false);
    }, timeoutMs);
    request.on('response', () => {
      clearTimeout(timer);
      done(true);
      try {
        if (typeof (request as any).abort === 'function') (request as any).abort();
        if (typeof (request as any).destroy === 'function') (request as any).destroy();
      } catch {}
    });
    request.on('error', () => {
      clearTimeout(timer);
      done(false);
    });
    request.end();
  });
}

// 3. Get Config
ipcMain.handle('get-config', async () => {
  try {
    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      return { status: 'ok', content };
    } else {
      return { status: 'error', message: `Config not found at ${configPath}` };
    }
  } catch (e: any) {
    return { status: 'error', message: e.message };
  }
});

// 4. Save Config
ipcMain.handle('save-config', async (_, content) => {
  try {
    const configPath = getEffectiveOpenClawConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    createNonOverwritingBackup(configPath);
    const tmpPath = `${configPath}.tmp.${process.pid}.${Date.now()}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, configPath);
    try {
      normalizeOpenClawConfigFile(configPath);
      ensureOllamaOpenAiCompatInConfigFile(configPath);
      const modelsPath = path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'models.json');
      ensureOllamaOpenAiCompatInModelsFile(modelsPath);
      ensureAgentModelsFileSyncedWithConfig(modelsPath, configPath);
    } catch {}
    return { status: 'ok' };
  } catch (e: any) {
    return { status: 'error', message: e.message };
  }
});

// 5. Restart Gateway
ipcMain.handle('restart-gateway', async () => {
  try {
    const rr = await restartOpenClawBestEffort();
    if (rr.status === 'ok') return { status: 'ok', message: '智能体服务已重启', output: rr.output };
    return { status: 'error', message: rr.message || 'OpenClaw restart failed', output: rr.output };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'restart failed' };
  }
});

// 6. Get Gateway Token
ipcMain.handle('get-gateway-token', async () => {
    try {
        const token = getEffectiveGatewayToken();
        if (token) return { status: 'ok', token };
        return { status: 'error', message: 'Token not found' };
    } catch (e: any) {
        return { status: 'error', message: e.message };
    }
});

ipcMain.handle('openclaw-logs-tail', async (_event, { stream, lines }) => {
  const s = (typeof stream === 'string' ? stream : 'err').toLowerCase();
  const maxLines = typeof lines === 'number' && Number.isFinite(lines) ? Math.max(20, Math.min(2000, Math.floor(lines))) : 200;
  const filePath = path.join(
    os.homedir(),
    'Library',
    'Logs',
    s === 'out' ? 'openclaw-gateway.out.log' : 'openclaw-gateway.err.log',
  );
  return readTailText(filePath, { maxLines });
});

ipcMain.handle('ollama-logs-tail', async (_event, { stream, lines }) => {
  const s = (typeof stream === 'string' ? stream : 'err').toLowerCase();
  const maxLines = typeof lines === 'number' && Number.isFinite(lines) ? Math.max(20, Math.min(2000, Math.floor(lines))) : 200;
  const filePath = path.join(
    os.homedir(),
    'Library',
    'Logs',
    s === 'out' ? 'ollama-serve.out.log' : 'ollama-serve.err.log',
  );
  return readTailText(filePath, { maxLines });
});

// 7. System Info
ipcMain.handle('get-system-info', () => {
  return {
    platform: os.platform(),
    arch: os.arch(),
    totalmem: os.totalmem(),
    cpus: os.cpus(),
  };
});

// 8. Install Offline
ipcMain.handle('install-offline', async () => {
  const send = (msg: string) => {
    if (win && !win.isDestroyed()) win.webContents.send('install-progress', msg);
  };

  const minReq = 'macOS 13.0+ (darwin)；Apple Silicon 或 Intel 均可';

  try {
    send('开始：一键部署（离线）');
    send(`最低需求：${minReq}`);

    const platform = os.platform();
    const arch = os.arch();
    if (platform !== 'darwin' || (arch !== 'arm64' && arch !== 'x64')) {
      const message = `系统不支持：platform=${platform} arch=${arch}。最低需求：${minReq}`;
      send(message);
      return { status: 'error', message };
    }

    const { stdout: verOut } = await execFileAsync('sw_vers', ['-productVersion'], { timeout: 5_000 } as any);
    const versionStr = verOut ? verOut.toString().trim() : '';
    const major = Number(versionStr.split('.')[0] || 0);
    if (!Number.isFinite(major) || major < 13) {
      const message = `系统版本过低：${versionStr || '(unknown)'}。最低需求：${minReq}`;
      send(message);
      return { status: 'error', message };
    }

    const desktop = path.join(os.homedir(), 'Desktop');
    const desktopAgentPkg = path.join(desktop, 'agent.gz');
    const bundledAgentPkg = getBundledAgentPackagePath();
    const agentPkg = fs.existsSync(desktopAgentPkg) ? desktopAgentPkg : bundledAgentPkg;
    const llmPkg = path.join(desktop, 'llm.gz');

    if (!fs.existsSync(agentPkg)) {
      const message = `未找到安装包：${desktopAgentPkg}（桌面）或 ${bundledAgentPkg}（内置）。`;
      send(message);
      if (!fs.existsSync(llmPkg)) send(`提示：llm.gz 可选；没有的话也可在 APP 内下载模型。`);
      return { status: 'error', message };
    }

    const shellQuote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";

    const home = os.homedir();
    const stageBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wage-offline-'));
    send(`解压 agent.gz → ${stageBase}`);
    await execFileAsync('tar', ['-xzf', agentPkg, '-C', stageBase], {
      timeout: 10 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
    } as any);

    const entries = fs.readdirSync(stageBase);
    const sole = entries.length === 1 ? path.join(stageBase, entries[0]) : null;
    const extractedRoot = sole && fs.statSync(sole).isDirectory() ? sole : stageBase;

    const payloadOpenclaw = path.join(extractedRoot, '.openclaw');
    const payloadNvm = path.join(extractedRoot, '.nvm');
    const payloadRuntime = path.join(extractedRoot, '.openclaw-runtime');
    const payloadOllama = path.join(extractedRoot, 'ollama');
    const payloadGatewayPlist = path.join(extractedRoot, 'com.clawdbot.gateway.plist');
    const payloadOllamaPlist = path.join(extractedRoot, 'com.ollama.serve.plist');

    const targetOpenclaw = path.join(home, '.openclaw');
    const targetNvm = path.join(home, '.nvm');
    const targetRuntime = path.join(home, '.openclaw-runtime');
    const targetClawPlist = getGatewayLaunchAgentPlistPath();
    const targetOllamaPlist = getOllamaLaunchAgentPlistPath();

    const cleanupStage = () => {
      try {
        fs.rmSync(stageBase, { recursive: true, force: true });
      } catch {}
    };

    const legacyAgentDir = path.join(extractedRoot, 'agent');
    if (!fs.existsSync(payloadOpenclaw) && fs.existsSync(legacyAgentDir)) {
      const agentDir = path.join(targetOpenclaw, 'agent');
      if (fs.existsSync(agentDir)) {
        const backupDir = `${agentDir}.bak.${Date.now()}`;
        send(`检测到旧安装：备份 → ${backupDir}`);
        fs.renameSync(agentDir, backupDir);
      }
      send(`安装离线代理目录 → ${agentDir}`);
      fs.mkdirSync(path.dirname(agentDir), { recursive: true });
      fs.cpSync(legacyAgentDir, agentDir, { recursive: true, force: true });
      cleanupStage();

      const agentBin = getOfflineAgentBinDir();
      send(`安装完成：${agentDir}`);
      send(`安装路径：${agentBin}`);

      const bundledConfig = path.join(agentDir, 'config', 'openclaw.json');
      const localConfig = getOpenClawConfigPath();
      if (fs.existsSync(bundledConfig)) {
        fs.mkdirSync(path.dirname(localConfig), { recursive: true });
        createNonOverwritingBackup(localConfig);
        fs.copyFileSync(bundledConfig, localConfig);
        send(`已覆盖配置：${localConfig}`);
      }
      try {
        ensureOpenClawConfigExists(localConfig);
        normalizeOpenClawConfigFile(localConfig);
        ensureOllamaOpenAiCompatInConfigFile(localConfig);
      } catch {}

      const ensured = await ensureOpenClawCnInstalled({ send });
      if (ensured.status !== 'ok') {
        send(`openclaw-cn 安装未完成：${ensured.message || 'unknown error'}`);
      } else {
        try {
          const cli = path.join(getOfflineAgentBinDir(), process.platform === 'win32' ? 'openclaw-cn.exe' : 'openclaw-cn');
          void installOpenClawCnToSystemPathBestEffort(cli, { send });
        } catch {}
      }
    } else {
      const hasRuntime = fs.existsSync(payloadRuntime);
      const required = hasRuntime ? [payloadOpenclaw, payloadRuntime] : [payloadOpenclaw, payloadNvm];
      const missing = required.filter((p) => !fs.existsSync(p));
      if (missing.length) {
        cleanupStage();
        const message = `离线包内容不完整，请重新打包 agent.gz：\n${missing.map((p) => `- ${p}`).join('\n')}`;
        send(message);
        return { status: 'error', message };
      }

      const replaceDir = (srcDir: string, dstDir: string) => {
        fs.rmSync(dstDir, { recursive: true, force: true });
        try {
          fs.renameSync(srcDir, dstDir);
          return;
        } catch {}
        fs.cpSync(srcDir, dstDir, { recursive: true, force: true });
        fs.rmSync(srcDir, { recursive: true, force: true });
      };

      send(`覆盖 ~/.openclaw → ${targetOpenclaw}`);
      replaceDir(payloadOpenclaw, targetOpenclaw);

      if (hasRuntime) {
        send(`覆盖 ~/.openclaw-runtime → ${targetRuntime}`);
        replaceDir(payloadRuntime, targetRuntime);
        const runtimeOllama = path.join(targetRuntime, process.platform === 'win32' ? 'ollama.exe' : 'ollama');
        if (fs.existsSync(runtimeOllama)) {
          try {
            fs.chmodSync(runtimeOllama, 0o755);
          } catch {}
          send(`已授权可执行：${runtimeOllama}`);
        } else {
          send(`提示：未发现 ${runtimeOllama}，将依赖系统 Ollama 或其它路径`);
        }
      } else {
        send(`覆盖 ~/.nvm → ${targetNvm}`);
        replaceDir(payloadNvm, targetNvm);
      }

      send(`覆盖 LaunchAgents → ${getLaunchAgentsDir()}`);
      fs.mkdirSync(getLaunchAgentsDir(), { recursive: true });
      const newGatewayToken = crypto.randomBytes(24).toString('hex');
      if (fs.existsSync(payloadGatewayPlist)) {
        fs.copyFileSync(payloadGatewayPlist, targetClawPlist);
      } else {
        fs.writeFileSync(targetClawPlist, buildGatewayLaunchAgentPlist(newGatewayToken), 'utf-8');
      }

      const systemOllama = resolveOllamaCliPathSystem();
      const effectiveOllamaPath = systemOllama || '/usr/local/bin/ollama';
      if (fs.existsSync(payloadOllamaPlist)) {
        fs.copyFileSync(payloadOllamaPlist, targetOllamaPlist);
      } else {
        fs.writeFileSync(targetOllamaPlist, buildOllamaLaunchAgentPlist(effectiveOllamaPath), 'utf-8');
      }

      replaceHomeTokensInFile(targetClawPlist, home);
      replaceHomeTokensInFile(targetOllamaPlist, home);

      const gatewayTokenFromPlist = resolveGatewayTokenFromPlist(targetClawPlist);
      const effectiveGatewayToken = (gatewayTokenFromPlist || newGatewayToken).trim();
      setGatewayTokenInPlist(targetClawPlist, effectiveGatewayToken);

      const uid = typeof (process as any).getuid === 'function' ? (process as any).getuid() : null;
      const gid = typeof (process as any).getgid === 'function' ? (process as any).getgid() : null;
      if (typeof uid === 'number' && typeof gid === 'number') {
        try {
          fs.chownSync(targetOpenclaw, uid, gid);
        } catch {}
        if (hasRuntime) {
          try {
            fs.chownSync(targetRuntime, uid, gid);
          } catch {}
        } else {
          try {
            fs.chownSync(targetNvm, uid, gid);
          } catch {}
        }
        try {
          fs.chownSync(targetClawPlist, uid, gid);
        } catch {}
        try {
          fs.chownSync(targetOllamaPlist, uid, gid);
        } catch {}
      }

      replaceHomeTokensInFile(path.join(targetOpenclaw, 'agents', 'main', 'sessions', 'sessions.json'), home);
      replaceHomeTokensInFile(path.join(targetOpenclaw, 'exec-approvals.json'), home);
      replaceHomeTokensInFile(path.join(targetOpenclaw, 'openclaw.json'), home);
      replaceUserHomePrefixesInJsonTree(targetOpenclaw, home);
      const zshrcRes = ensureZshrcPathExportLine();
      if (zshrcRes.status === 'ok') {
        if (zshrcRes.changed) send('已写入 ~/.zshrc 的 PATH（.openclaw-runtime）');
        else send('检测到 ~/.zshrc 已包含 PATH（.openclaw-runtime），跳过写入');
      } else {
        send(`写入 ~/.zshrc 失败：${(zshrcRes as any).message || 'unknown error'}`);
      }

      if (!systemOllama && !hasRuntime) {
        if (!fs.existsSync(payloadOllama)) {
          send('未检测到系统 Ollama，且离线包未包含 ollama 二进制，跳过安装。');
        } else {
          send('安装 Ollama 二进制 → /usr/local/bin/ollama（需要系统授权）...');
          await runShellAsAdmin(`cp -f ${shellQuote(payloadOllama)} /usr/local/bin/ollama && chmod +x /usr/local/bin/ollama`, 60_000);
        }
      } else {
        if (systemOllama) send(`检测到系统 Ollama：${systemOllama}，将直接使用系统版本。`);
      }

      const defaultConfigPath = getOpenClawConfigPath();
      ensureOpenClawConfigExists(defaultConfigPath);
      normalizeOpenClawConfigFile(defaultConfigPath);
      const gatewayConfigPath = resolveGatewayConfigPathFromPlist(targetClawPlist) || defaultConfigPath;
      ensureOpenClawConfigExists(gatewayConfigPath);
      normalizeOpenClawConfigFile(gatewayConfigPath);
      setGatewayTokenInConfig(defaultConfigPath, effectiveGatewayToken);
      if (gatewayConfigPath !== defaultConfigPath) setGatewayTokenInConfig(gatewayConfigPath, effectiveGatewayToken);
      ensureOllamaOpenAiCompatInConfigFile(defaultConfigPath);
      if (gatewayConfigPath !== defaultConfigPath) ensureOllamaOpenAiCompatInConfigFile(gatewayConfigPath);
      ensureOllamaOpenAiCompatInModelsFile(path.join(targetOpenclaw, 'agents', 'main', 'agent', 'models.json'));

      const ensured = await ensureOpenClawCnInstalled({ send });
      if (ensured.status !== 'ok') {
        send(`openclaw-cn 安装未完成：${ensured.message || 'unknown error'}`);
      } else {
        try {
          const cli = path.join(getOfflineAgentBinDir(), process.platform === 'win32' ? 'openclaw-cn.exe' : 'openclaw-cn');
          void installOpenClawCnToSystemPathBestEffort(cli, { send });
        } catch {}
      }

      cleanupStage();
    }

    if (fs.existsSync(llmPkg)) {
      const ollamaHome = path.join(os.homedir(), '.ollama');
      fs.mkdirSync(ollamaHome, { recursive: true });
      try {
        const extractTo = os.homedir();
        send(`解压 llm.gz → ${extractTo}`);
        await execFileAsync('tar', ['-xzf', llmPkg, '-C', extractTo], {
          timeout: 60 * 60_000,
          maxBuffer: 10 * 1024 * 1024,
        } as any);
        send('离线模型镜像导入完成');
      } catch (e: any) {
        const st = (() => {
          try {
            return fs.statfsSync(os.homedir());
          } catch {
            return null;
          }
        })();
        const freeBytes = st ? Number(st.bavail) * Number(st.bsize) : 0;
        const freeGiB = freeBytes > 0 ? (freeBytes / (1024 ** 3)).toFixed(1) : '';
        send(
          `离线模型导入失败（llm.gz 可选），将跳过并继续启动：${e?.message || 'unknown error'}${
            freeGiB ? `；当前磁盘可用约 ${freeGiB} GiB（空间不足也会导致解压失败）` : ''
          }`,
        );
        const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
        if (output) send(output);
      }
    } else {
      send('未发现 llm.gz（可选），跳过离线模型导入');
    }

    const waitPort = async (port: number, timeoutMs: number) => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const ok = await new Promise<boolean>((res) => {
          const socket = new net.Socket();
          socket.setTimeout(800);
          socket.on('connect', () => {
            socket.destroy();
            res(true);
          });
          socket.on('timeout', () => {
            socket.destroy();
            res(false);
          });
          socket.on('error', () => res(false));
          socket.connect(port, '127.0.0.1');
        });
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 800));
      }
      return false;
    };

    send('启动 AI 引擎（LaunchAgent）...');
    try {
      await execFileAsync('launchctl', ['unload', getGatewayLaunchAgentPlistPath()], { timeout: 10_000 } as any);
    } catch {}
    try {
      await execFileAsync('launchctl', ['unload', getOllamaLaunchAgentPlistPath()], { timeout: 10_000 } as any);
    } catch {}
    try {
      const { stdout, stderr } = await execFileAsync('launchctl', ['load', '-w', getOllamaLaunchAgentPlistPath()], { timeout: 20_000 } as any);
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (output) send(output);
    } catch (e: any) {
      send(`AI 引擎启动失败：${e?.message || 'launchctl load failed'}`);
      const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
      if (output) send(output);
    }
    send('等待 AI 引擎端口 11434...');
    const aiOk = await waitPort(11434, 90_000);
    send(aiOk ? 'AI 引擎已就绪' : 'AI 引擎未就绪（超时），可稍后在“刷新状态”重试');

    send('启动 智能体服务（LaunchAgent）...');
    try {
      const { stdout, stderr } = await execFileAsync('launchctl', ['load', '-w', getGatewayLaunchAgentPlistPath()], { timeout: 20_000 } as any);
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (output) send(output);
    } catch (e: any) {
      send(`智能体服务启动失败：${e?.message || 'launchctl load failed'}`);
      const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
      if (output) send(output);
    }

    send('等待 智能体网关端口 18789...');
    const portOk = await waitPort(18789, 90_000);
    if (portOk) send('智能体网关已就绪');
    else send('智能体网关未就绪（超时），可稍后在“刷新状态”重试');

    if (portOk) {
      try {
        const cli = path.join(getOfflineAgentBinDir(), process.platform === 'win32' ? 'openclaw-cn.exe' : 'openclaw-cn');
        if (fs.existsSync(cli)) {
          if (hasValidQwenPortalAuthProfile()) {
            send('检测到已存在有效的 Qwen OAuth 授权，跳过登录。');
            return { status: 'ok', message: 'Offline install & start complete' };
          }
          send('开始 Qwen Portal 登录（models auth login）...');
          const authRequestId = `install-offline-qwen-${Date.now()}`;
          for (const [id, proc] of activeOpenClawAuthRequests.entries()) {
            try {
              proc.kill();
            } catch {}
            activeOpenClawAuthRequests.delete(id);
          }
          const baseArgs = ['models', 'auth', 'login', '--provider', 'qwen-portal'];
          const spawnWithTty = () => {
            if (process.platform === 'darwin') {
              const scriptPath = fs.existsSync('/usr/bin/script') ? '/usr/bin/script' : 'script';
              return spawn(scriptPath, ['-q', '/dev/null', cli, ...baseArgs], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
            }
            return spawn(cli, baseArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
          };
          const p = spawnWithTty();
          activeOpenClawAuthRequests.set(authRequestId, p);
          const startedAtMs = Date.now();
          const initialProfilesMtime = getFileMtimeMsSafe(getAuthProfilesPath());
          let authDetected = 0;

          let buffer = '';
          let flushTimer: NodeJS.Timeout | null = null;
          let openedUrl = '';
          let lastLine = '';
          const flush = () => {
            flushTimer = null;
            if (!buffer) return;
            if (win && !win.isDestroyed()) {
              win.webContents.send('openclaw-auth-chunk', { requestId: authRequestId, stream: 'stdout', data: buffer });
            }
            buffer = '';
          };
          const scheduleFlush = () => {
            if (flushTimer) return;
            flushTimer = setTimeout(flush, 60);
          };
          const maybeOpenAuthUrl = (text: string) => {
            if (openedUrl) return;
            const url = extractAuthUrlFromText(text);
            if (!url) return;
            openedUrl = url;
            try {
              shell.openExternal(url);
            } catch {}
            const code = (() => {
              try {
                const u = new URL(url);
                return u.searchParams.get('user_code') || '';
              } catch {
                return '';
              }
            })();
            if (win && !win.isDestroyed()) {
              win.webContents.send('openclaw-auth-chunk', { requestId: authRequestId, authUrl: url, userCode: code });
            }
          };
          const append = (d: Buffer) => {
            const s = stripAnsiAndControl(d.toString());
            if (!s) return;
            buffer += s;
            if (buffer.length > 250_000) buffer = buffer.slice(-250_000);
            maybeOpenAuthUrl(buffer);
            const cleaned = s.trimEnd();
            const lines = cleaned.split('\n').map((l) => l.trim()).filter(Boolean);
            for (const line of lines) {
              if (/^[◐◑◒◓]/.test(line) && (line.includes('等待Qwen OAuth批准') || line.includes('正在启动Qwen OAuth'))) {
                if (line === lastLine) continue;
                lastLine = line;
                continue;
              }
              if (line === lastLine) continue;
              lastLine = line;
              send(line);
            }
            if (buffer.length > 24_000) flush();
            else scheduleFlush();
          };
          p.stdout?.on('data', (d) => append(d as Buffer));
          p.stderr?.on('data', (d) => append(d as Buffer));
          p.on('error', (e: any) => {
            send(`Qwen 登录启动失败：${e?.message || 'spawn error'}`);
            if (win && !win.isDestroyed()) win.webContents.send('openclaw-auth-chunk', { requestId: authRequestId, error: e?.message || 'spawn error', done: true });
          });
          p.on('exit', (code) => {
            activeOpenClawAuthRequests.delete(authRequestId);
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = null;
            }
            flush();
            send(`Qwen 登录已结束（code=${code ?? 'n/a'}）。`);
            if (win && !win.isDestroyed()) win.webContents.send('openclaw-auth-chunk', { requestId: authRequestId, done: true, code });
          });
          const authPoll = setInterval(() => {
            try {
              if (p.killed) return;
              const requireAfter = Math.max(startedAtMs, initialProfilesMtime);
              const ok = hasValidQwenPortalAuthProfile({ requireMtimeAfterMs: requireAfter });
              if (!ok) return;
              authDetected += 1;
              if (authDetected < 2) return;
              try {
                p.kill();
              } catch {}
              send('检测到 Qwen OAuth 已写入鉴权文件，结束等待。');
            } catch {}
          }, 1200);
          p.on('exit', () => clearInterval(authPoll));
          p.on('error', () => clearInterval(authPoll));
        } else {
          send(`未找到 openclaw-cn：${cli}，跳过 Qwen 登录。`);
        }
      } catch (e: any) {
        send(`Qwen 登录异常：${e?.message || 'unknown error'}`);
      }
    }

    return { status: 'ok', message: 'Offline install & start complete' };
  } catch (e: any) {
    const message = e?.message || 'Offline install failed';
    send(`失败：${message}`);
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    if (output) send(output);
    return { status: 'error', message };
  }
});

ipcMain.handle('import-local-llm', async () => {
  const send = (msg: string) => {
    if (win && !win.isDestroyed()) win.webContents.send('install-progress', msg);
  };
  try {
    const desktop = path.join(os.homedir(), 'Desktop');
    const llmPkg = path.join(desktop, 'llm.gz');
    if (!fs.existsSync(llmPkg)) {
      const message = `未找到 ${llmPkg}（请把 llm.gz 放到桌面后重试）。`;
      send(message);
      return { status: 'error', message };
    }

    const extractTo = os.homedir();
    send(`开始加载本地大模型（解压 llm.gz → ${extractTo}）...`);
    await execFileAsync('tar', ['-xzf', llmPkg, '-C', extractTo], {
      timeout: 60 * 60_000,
      maxBuffer: 10 * 1024 * 1024,
    } as any);
    send('本地大模型加载完成。');
    return { status: 'ok' };
  } catch (e: any) {
    const st = (() => {
      try {
        return fs.statfsSync(os.homedir());
      } catch {
        return null;
      }
    })();
    const freeBytes = st ? Number(st.bavail) * Number(st.bsize) : 0;
    const freeGiB = freeBytes > 0 ? (freeBytes / (1024 ** 3)).toFixed(1) : '';
    const message = `本地大模型加载失败：${e?.message || 'unknown error'}${freeGiB ? `；当前磁盘可用约 ${freeGiB} GiB` : ''}`;
    send(message);
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    if (output) send(output);
    return { status: 'error', message };
  }
});

ipcMain.handle('openclaw-skills-list', async () => {
  try {
    const cli = resolveOpenClawCliPathAny();
    if (!cli) return { status: 'error', message: 'openclaw-cn not found (System or Offline)' };
    const { stdout, stderr } = await execFileAsync(cli, ['--no-color', 'skills', 'list', '--json'], {
      timeout: 25_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    } as any);
    const raw = (stdout || '').toString().trim();
    try {
      const data = JSON.parse(raw);
      return { status: 'ok', data };
    } catch {
      const combined = [stdout, stderr].filter(Boolean).join('\n');
      const idx = combined.indexOf('{');
      const jdx = combined.lastIndexOf('}');
      if (idx >= 0 && jdx > idx) {
        try {
          const data = JSON.parse(combined.slice(idx, jdx + 1));
          return { status: 'ok', data };
        } catch {}
      }
      return { status: 'error', message: 'Failed to parse skills list', output: combined };
    }
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'Failed to list skills', output };
  }
});

ipcMain.handle('openclaw-skill-set-enabled', async (_event, { name, enabled }) => {
  try {
    const cli = resolveOpenClawCliPathAny();
    if (!cli) return { status: 'error', message: 'openclaw-cn not found (System or Offline)' };
    const skillName = (typeof name === 'string' ? name : '').trim();
    if (!skillName) return { status: 'error', message: 'Missing skill name' };
    const { stdout, stderr } = await execFileAsync(cli, ['--no-color', 'skills', 'info', '--json', skillName], {
      timeout: 25_000,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    } as any);
    const combined = [stdout, stderr].filter(Boolean).join('\n');
    const jsonText = (() => {
      const raw = (stdout || '').toString().trim();
      if (raw.startsWith('{') && raw.endsWith('}')) return raw;
      const idx = combined.indexOf('{');
      const jdx = combined.lastIndexOf('}');
      if (idx >= 0 && jdx > idx) return combined.slice(idx, jdx + 1);
      return '';
    })();
    if (!jsonText) return { status: 'error', message: 'Failed to read skill info', output: combined };
    const info = JSON.parse(jsonText);
    const skillKey = (info?.skillKey || info?.name || skillName).toString().trim();
    if (!skillKey) return { status: 'error', message: 'Skill key not found', output: jsonText };

    const configPath = getEffectiveOpenClawConfigPath();
    ensureOpenClawConfigExists(configPath);
    if (!fs.existsSync(configPath)) return { status: 'error', message: `Config not found at ${configPath}` };
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    cfg.skills = typeof cfg.skills === 'object' && cfg.skills ? cfg.skills : {};
    cfg.skills.entries = typeof cfg.skills.entries === 'object' && cfg.skills.entries ? cfg.skills.entries : {};
    cfg.skills.entries[skillKey] = typeof cfg.skills.entries[skillKey] === 'object' && cfg.skills.entries[skillKey] ? cfg.skills.entries[skillKey] : {};
    cfg.skills.entries[skillKey].enabled = Boolean(enabled);

    createNonOverwritingBackup(configPath);
    writeJsonAtomic(configPath, cfg);
    const rr = await restartOpenClawBestEffort();
    if (rr.status === 'ok') return { status: 'ok', output: rr.output };
    return { status: 'error', message: rr.message || 'Restart failed', output: rr.output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'Failed to toggle skill', output };
  }
});

// 9. Chat Stream (Simple Proxy)
ipcMain.handle('chat-ollama-stream', async (_event, { requestId, model, messages }) => {
    const resolvedRequestId = requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const request = electronNet.request({
        method: 'POST',
        protocol: 'http:',
        hostname: '127.0.0.1',
        port: 11434,
        path: '/api/chat',
    });
    request.setHeader('Content-Type', 'application/json');
    activeOllamaRequests.set(resolvedRequestId, request);
    const clearTimers = () => {
      const timers = activeOllamaRequestTimeouts.get(resolvedRequestId);
      if (timers?.firstByte) clearTimeout(timers.firstByte);
      if (timers?.overall) clearTimeout(timers.overall);
      activeOllamaRequestTimeouts.delete(resolvedRequestId);
    };
    const cleanup = () => {
      clearTimers();
      activeOllamaRequests.delete(resolvedRequestId);
    };
    const finishError = (message: string) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-reply-chunk', { requestId: resolvedRequestId, error: message, done: true });
      }
      try {
        if (typeof (request as any).abort === 'function') (request as any).abort();
        if (typeof (request as any).destroy === 'function') (request as any).destroy();
      } catch {}
      cleanup();
    };

    const firstByteTimer = setTimeout(() => {
      finishError('Timeout waiting for model response (no data received). Consider switching to a smaller model.');
    }, 90_000);
    const overallTimer = setTimeout(() => {
      finishError('Timeout waiting for model response. Consider switching to a smaller model.');
    }, 12 * 60_000);
    activeOllamaRequestTimeouts.set(resolvedRequestId, { firstByte: firstByteTimer, overall: overallTimer });

    request.on('response', (response) => {
        let buffer = '';
        let gotFirstByte = false;
        response.on('data', (chunk) => {
            if (!gotFirstByte) {
              gotFirstByte = true;
              const timers = activeOllamaRequestTimeouts.get(resolvedRequestId);
              if (timers?.firstByte) clearTimeout(timers.firstByte);
              if (timers) activeOllamaRequestTimeouts.set(resolvedRequestId, { ...timers, firstByte: undefined });
            }
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const parsed = JSON.parse(trimmed);
                if (win && !win.isDestroyed()) {
                  win.webContents.send('ollama-reply-chunk', { requestId: resolvedRequestId, ...parsed });
                }
              } catch (e: any) {
                if (win && !win.isDestroyed()) {
                  win.webContents.send('ollama-reply-chunk', {
                    requestId: resolvedRequestId,
                    error: `Failed to parse Ollama stream chunk: ${e?.message || 'unknown error'}`,
                    raw: trimmed,
                  });
                }
              }
            }
        });
        response.on('end', () => {
            const trimmed = buffer.trim();
            if (trimmed) {
              try {
                const parsed = JSON.parse(trimmed);
                if (win && !win.isDestroyed()) {
                  win.webContents.send('ollama-reply-chunk', { requestId: resolvedRequestId, ...parsed });
                }
              } catch {
                if (win && !win.isDestroyed()) {
                  win.webContents.send('ollama-reply-chunk', { requestId: resolvedRequestId, error: 'Ollama stream ended with non-JSON tail' });
                }
              }
            }
            if (win && !win.isDestroyed()) {
                win.webContents.send('ollama-reply-chunk', { requestId: resolvedRequestId, done: true });
            }
            cleanup();
        });
    });
    request.on('error', (error) => {
        finishError(error.message || 'Network error');
    });

    request.write(JSON.stringify({ model, messages, stream: true }));
    request.end();
    return { status: 'ok', requestId: resolvedRequestId };
});

ipcMain.handle('abort-ollama-stream', async (_, { requestId }) => {
  const req = activeOllamaRequests.get(requestId);
  if (!req) return { status: 'error', message: 'Request not found' };
  try {
    if (typeof req.abort === 'function') req.abort();
    if (typeof req.destroy === 'function') req.destroy();
  } finally {
    activeOllamaRequests.delete(requestId);
    const timers = activeOllamaRequestTimeouts.get(requestId);
    if (timers?.firstByte) clearTimeout(timers.firstByte);
    if (timers?.overall) clearTimeout(timers.overall);
    activeOllamaRequestTimeouts.delete(requestId);
  }
  return { status: 'ok' };
});

ipcMain.handle('ollama-ps', async () => {
  return await runOllamaCli(['ps'], { timeoutMs: 10_000, maxBuffer: 2 * 1024 * 1024 });
});

ipcMain.handle('ollama-stop-model', async (_event, { model: targetModel, force }) => {
  return await forceStopOllamaModel((targetModel || '').toString(), { force: Boolean(force) });
});

ipcMain.handle('ollama-local-tags', async () => {
  try {
    const cli = resolveOllamaCliPathAny();
    if (!cli) {
      return { status: 'error', message: 'Ollama 未安装' };
    }
    const { stdout } = await execFileAsync(cli, ['list'], { maxBuffer: 5 * 1024 * 1024 });
    return { status: 'ok', models: parseOllamaList(stdout) };
  } catch (e: any) {
    return { status: 'error', message: e.message };
  }
});

async function fetchOllamaLibraryTags(): Promise<any[]> {
  if (cachedLibraryTags && Date.now() - cachedLibraryTags.fetchedAt < 6 * 60 * 60 * 1000) {
    return cachedLibraryTags.models;
  }
  const request = electronNet.request({
    method: 'GET',
    protocol: 'https:',
    hostname: 'ollama.com',
    path: '/api/tags',
  });
  const models = await new Promise<any[]>((resolve, reject) => {
    request.on('response', (response) => {
      let body = '';
      response.on('data', (chunk) => {
        body += chunk.toString();
        if (body.length > 25_000_000) {
          if (typeof (request as any).abort === 'function') (request as any).abort();
          reject(new Error('Ollama library response too large'));
        }
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(Array.isArray(parsed.models) ? parsed.models : []);
        } catch (e: any) {
          reject(e);
        }
      });
    });
    request.on('error', (e) => reject(e));
    request.end();
  });
  cachedLibraryTags = { fetchedAt: Date.now(), models };
  return models;
}

ipcMain.handle('ollama-library-search', async (_event, { query }) => {
  try {
    const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
    const models = await fetchOllamaLibraryTags();
    if (!q) {
      return { status: 'ok', models: models.slice(0, 200) };
    }
    const filtered = models.filter((m) => {
      const name = (m?.name || m?.model || '').toString().toLowerCase();
      return name.includes(q);
    });
    return { status: 'ok', models: filtered.slice(0, 200) };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Search failed' };
  }
});

ipcMain.handle('ollama-pull', async (_event, { requestId, model }) => {
  const resolvedRequestId = requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    const request = electronNet.request({
      method: 'POST',
      protocol: 'http:',
      hostname: '127.0.0.1',
      port: 11434,
      path: '/api/pull',
    });
    request.setHeader('Content-Type', 'application/json');
    activeOllamaPullRequests.set(resolvedRequestId, request);

    request.on('response', (response) => {
      let buffer = '';
      response.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (win && !win.isDestroyed()) {
              win.webContents.send('ollama-pull-chunk', { requestId: resolvedRequestId, ...parsed });
            }
          } catch (e: any) {
            if (win && !win.isDestroyed()) {
              win.webContents.send('ollama-pull-chunk', { requestId: resolvedRequestId, error: e?.message || 'parse error' });
            }
          }
        }
      });
      response.on('end', () => {
        if (win && !win.isDestroyed()) {
          win.webContents.send('ollama-pull-chunk', { requestId: resolvedRequestId, done: true });
        }
        activeOllamaPullRequests.delete(resolvedRequestId);
      });
    });
    request.on('error', (error) => {
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-pull-chunk', { requestId: resolvedRequestId, error: error.message, done: true });
      }
      activeOllamaPullRequests.delete(resolvedRequestId);
    });

    request.write(JSON.stringify({ model, stream: true }));
    request.end();
    return { status: 'ok', requestId: resolvedRequestId };
  } catch (e: any) {
    activeOllamaPullRequests.delete(resolvedRequestId);
    return { status: 'error', message: e.message };
  }
});

ipcMain.handle('ollama-pull-abort', async (_event, { requestId }) => {
  const req = activeOllamaPullRequests.get(requestId);
  if (!req) return { status: 'error', message: 'Request not found' };
  try {
    if (typeof req.abort === 'function') req.abort();
    if (typeof req.destroy === 'function') req.destroy();
  } finally {
    activeOllamaPullRequests.delete(requestId);
  }
  return { status: 'ok' };
});

ipcMain.handle('ollama-run-start', async (_event, { requestId, model }) => {
  const resolvedRequestId = requestId || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    for (const [id, proc] of activeOllamaRunRequests.entries()) {
      try {
        proc.kill();
      } catch {}
      activeOllamaRunRequests.delete(id);
    }

    const cli = resolveOllamaCliPathAny();
    if (!cli) return { status: 'error', message: 'Ollama 未安装' };
    const proc = spawn(cli, ['run', model], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });
    activeOllamaRunRequests.set(resolvedRequestId, proc);

    let buffer = '';
    let flushTimer: NodeJS.Timeout | null = null;
    const flush = () => {
      flushTimer = null;
      if (!buffer) return;
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-run-chunk', { requestId: resolvedRequestId, stream: 'stdout', data: buffer });
      }
      buffer = '';
    };
    const scheduleFlush = () => {
      if (flushTimer) return;
      flushTimer = setTimeout(flush, 50);
    };
    const append = (d: Buffer) => {
      const s = d.toString();
      if (!s) return;
      buffer += s;
      if (buffer.length > 250_000) buffer = buffer.slice(-250_000);
      if (buffer.length > 24_000) flush();
      else scheduleFlush();
    };

    proc.stdout?.on('data', (d) => append(d as Buffer));
    proc.stderr?.on('data', (d) => append(d as Buffer));
    proc.on('exit', (code, signal) => {
      activeOllamaRunRequests.delete(resolvedRequestId);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-run-chunk', { requestId: resolvedRequestId, done: true, code, signal });
      }
    });
    proc.on('error', (err: any) => {
      activeOllamaRunRequests.delete(resolvedRequestId);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      buffer += `\n[error] ${err?.message || 'spawn error'}\n`;
      flush();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ollama-run-chunk', { requestId: resolvedRequestId, error: err?.message || 'spawn error', done: true });
      }
    });

    if (win && !win.isDestroyed()) {
      win.webContents.send('ollama-run-chunk', { requestId: resolvedRequestId, stream: 'stdout', data: `$ ollama run ${model}\n` });
    }
    return { status: 'ok', requestId: resolvedRequestId };
  } catch (e: any) {
    activeOllamaRunRequests.delete(resolvedRequestId);
    return { status: 'error', message: e?.message || 'Failed to start ollama run' };
  }
});

ipcMain.handle('ollama-run-send', async (_event, { requestId, input }) => {
  const proc = activeOllamaRunRequests.get(requestId);
  if (!proc || !proc.stdin) return { status: 'error', message: 'Process not found' };
  try {
    const text = typeof input === 'string' ? input : '';
    proc.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
    return { status: 'ok' };
  } catch (e: any) {
    return { status: 'error', message: e?.message || 'Write failed' };
  }
});

ipcMain.handle('ollama-run-stop', async (_event, { requestId }) => {
  const proc = activeOllamaRunRequests.get(requestId);
  if (!proc) return { status: 'error', message: 'Process not found' };
  try {
    proc.kill();
  } finally {
    activeOllamaRunRequests.delete(requestId);
  }
  return { status: 'ok' };
});

ipcMain.handle('ollama-open-system-terminal', async (_event, { model }) => {
  try {
    const m = (model || '').toString().trim();
    if (!m) return { status: 'error', message: 'Model is required' };
    if (process.platform !== 'darwin') {
      return { status: 'error', message: 'Only supported on macOS for now' };
    }
    const cmd = `ollama run ${m}`;
    const esc = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `tell application "Terminal"\nactivate\ndo script "${esc}"\nend tell`;
    const { stdout, stderr } = await execFileAsync('osascript', ['-e', script], { timeout: 10_000 } as any);
    const output = [stdout, stderr].filter(Boolean).join('\n').trim();
    return { status: 'ok', output };
  } catch (e: any) {
    const output = [e?.stdout, e?.stderr].filter(Boolean).join('\n').trim();
    return { status: 'error', message: e?.message || 'Failed to open terminal', output };
  }
});

// 10. Install Open WebUI
ipcMain.handle('install-webui', async () => {
  return new Promise((resolve) => {
    // Determine pip command
    let pipCmd = 'pip3';
    // Check if pip3 exists
    exec('which pip3', (err) => {
      if (err) {
        // try 'pip'
        exec('which pip', (err2) => {
          if (!err2) pipCmd = 'pip';
        });
      }
      
      console.log(`Installing Open WebUI using ${pipCmd}...`);
      if (win) win.webContents.send('install-progress', `Starting installation using ${pipCmd}...`);
      
      const install = spawn(pipCmd, ['install', 'open-webui'], {
        stdio: 'pipe'
      });

      install.stdout.on('data', (data) => {
        const log = data.toString();
        console.log(log);
        if (win) win.webContents.send('install-progress', log);
      });

      install.stderr.on('data', (data) => {
        const log = data.toString();
        console.error(log);
        if (win) win.webContents.send('install-progress', log);
      });

      install.on('close', (code) => {
        if (code === 0) {
          if (win) win.webContents.send('install-progress', 'Installation complete!');
          resolve({ status: 'ok', message: 'Installation complete' });
        } else {
          if (win) win.webContents.send('install-progress', `Installation failed with code ${code}`);
          resolve({ status: 'error', message: `Installation failed with code ${code}` });
        }
      });
    });
  });
});

// 11. Start Open WebUI
ipcMain.handle('start-webui', async () => {
  return new Promise((resolve) => {
    // Check if port 3000 is already in use
    const checkPort = () => new Promise<boolean>((res) => {
      const socket = new net.Socket();
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.destroy(); res(true); });
      socket.on('timeout', () => { socket.destroy(); res(false); });
      socket.on('error', () => { res(false); });
      socket.connect(3000, '127.0.0.1');
    });

    checkPort().then(async (isOpen) => {
      if (isOpen) {
        resolve({ status: 'ok', message: 'Open WebUI is already running' });
        return;
      }

      // Try to find open-webui command
      const findCommand = () => new Promise<string | null>((res) => {
        exec('which open-webui', (err, stdout) => {
          if (!err && stdout.trim()) res(stdout.trim());
          else res(null);
        });
      });

      let cmd = await findCommand();
      if (!cmd) {
        const commonPaths = [
          path.join(os.homedir(), '.local/bin/open-webui'),
          '/usr/local/bin/open-webui',
          '/opt/homebrew/bin/open-webui',
          '/Library/Frameworks/Python.framework/Versions/3.10/bin/open-webui'
        ];
        for (const p of commonPaths) {
          if (fs.existsSync(p)) {
            cmd = p;
            break;
          }
        }
      }

      if (!cmd) {
        resolve({ status: 'error', message: 'open-webui command not found. Please install it.' });
        return;
      }

      console.log(`Starting Open WebUI using: ${cmd}`);
      const dataDir = path.join(app.getPath('userData'), 'open-webui');
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}

      webuiProcess = spawn(cmd, ['serve', '--host', '127.0.0.1', '--port', '3000'], {
        detached: false, // Keep attached so we can kill it on exit
        stdio: 'ignore', // Ignore output to prevent buffer issues
        env: {
          ...process.env,
          OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
          DATA_DIR: process.env.DATA_DIR || dataDir,
          WEBUI_URL: process.env.WEBUI_URL || 'http://127.0.0.1:3000',
        }
      });

      // Wait for it to start
      let checks = 0;
      const waitForStart = setInterval(async () => {
        checks++;
        const running = await checkPort();
        if (running) {
          clearInterval(waitForStart);
          resolve({ status: 'ok', message: 'Open WebUI started' });
        } else if (checks > 30) { 
          clearInterval(waitForStart);
          resolve({ status: 'error', message: 'Timeout waiting for Open WebUI to start' });
        }
      }, 1000);

      webuiProcess.on('error', (err: any) => {
        clearInterval(waitForStart);
        resolve({ status: 'error', message: `Failed to spawn: ${err.message}` });
      });
    });
  });
});

// 12. Get Ollama UI URL (Dynamic Port)
ipcMain.handle('get-ollama-ui-url', async () => {
  try {
    // Look for processes named "Ollama" (capitalized) which might be the UI wrapper
    // We use lsof to find listening ports for "Ollama" command
    
    let lsofCmd = 'lsof';
    if (fs.existsSync('/usr/sbin/lsof')) {
        lsofCmd = '/usr/sbin/lsof';
    }

    // Command: lsof -iTCP -sTCP:LISTEN -P -n
    const { stdout } = await execAsync(`${lsofCmd} -iTCP -sTCP:LISTEN -P -n`);
    
    // Explicit check for known PID if lsof scan fails or is too strict
    try {
        const { stdout: pidOut } = await execAsync('pgrep -l "Ollama"');
        console.log('pgrep Ollama:', pidOut);
    } catch (ignore) {}

    const lines = stdout.split('\n');
    for (const line of lines) {
      // Format: COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME
      // Example: Ollama 7585 chuan 4u IPv4 ... TCP 127.0.0.1:50297 (LISTEN)
      const parts = line.split(/\s+/);
      if (parts.length < 9) continue;
      
      const command = parts[0];
      const address = parts[8]; // TCP 127.0.0.1:50297 or *:50297
      
      // Check for Ollama app (macOS usually 'Ollama') or OpenWebUI
      // Also match process name ending in 'Ollama' to be safe
      if (command === 'Ollama' || command === 'OpenWebUI' || command.endsWith('Ollama')) {
        // Extract port from address (handles 127.0.0.1:port, localhost:port, *:port)
        const portMatch = address.match(/:(\d+)$/);
        if (portMatch) {
          const port = parseInt(portMatch[1], 10);
          // Ignore standard API port 11434
          if (port !== 11434) {
            console.log(`Found Ollama UI on port ${port}`);
            return { status: 'ok', url: `http://127.0.0.1:${port}` };
          }
        }
      }
    }
    
    // Fallback: If we found the process but not via generic scan, try specific check on common dynamic ports?
    // Or try to parse lsof -p <PID> if we find the PID.
    
    try {
        const { stdout: pids } = await execAsync('pgrep -x "Ollama"');
        const pidList = pids.trim().split('\n');
        for (const pid of pidList) {
             if (!pid) continue;
             // Check ports for this PID specifically
             // Note: On macOS, lsof needs full path or just command name sometimes, but -p PID is reliable
             const { stdout: pidLsof } = await execAsync(`${lsofCmd} -a -p ${pid} -iTCP -sTCP:LISTEN -P -n`);
             
             const pidLines = pidLsof.split('\n');
             for (const line of pidLines) {
                 const parts = line.split(/\s+/);
                 if (parts.length < 9) continue;
                 
                 // Skip header line
                 if (parts[0] === 'COMMAND') continue;

                 const address = parts[8];
                 const portMatch = address.match(/:(\d+)$/);
                 if (portMatch) {
                     const port = parseInt(portMatch[1], 10);
                     if (port !== 11434) {
                         console.log(`Found Ollama UI (PID ${pid}) on port ${port}`);
                         return { status: 'ok', url: `http://127.0.0.1:${port}` };
                     }
                 }
             }
        }
    } catch (e) {
        console.log('Fallback PID check failed:', e);
    }
    
    return { status: 'error', message: 'No running Ollama UI found' };
  } catch (e: any) {
    console.error('Error getting Ollama UI URL:', e);
    return { status: 'error', message: e.message };
  }
});
