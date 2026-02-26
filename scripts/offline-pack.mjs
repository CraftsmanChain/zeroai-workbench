import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const pullMissing = args.has('--pull-missing');

const desktop = path.join(os.homedir(), 'Desktop');
const outAgent = path.join(desktop, 'agent.gz');
const outLlm = path.join(desktop, 'llm.gz');

const requiredModels = ['qwen3-coder:30b', 'x/flux2-klein:latest', 'qwen2.5:7b', 'deepseek-r1:8b'];

const atomicTarGz = (outFile, tarArgs) => {
  const tmpFile = `${outFile}.tmp.${Date.now()}`;
  if (exists(tmpFile)) fs.rmSync(tmpFile);
  execFileSync('tar', ['-czf', tmpFile, ...tarArgs], { stdio: 'inherit' });
  if (exists(outFile)) fs.rmSync(outFile);
  fs.renameSync(tmpFile, outFile);
};

const run = (cmd, cmdArgs, opts = {}) =>
  execFileSync(cmd, cmdArgs, { stdio: 'pipe', timeout: 30_000, ...opts }).toString();

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const resolveDownloadsOllama = () => {
  const bin = path.join(os.homedir(), 'Downloads', 'ollama-darwin', 'ollama');
  if (!exists(bin)) throw new Error(`未找到 Ollama 二进制：${bin}`);
  return bin;
};

const ensureOllamaModels = () => {
  let listOut = '';
  try {
    listOut = run('ollama', ['list'], { timeout: 20_000 });
  } catch {
    throw new Error('无法执行 ollama list；请先安装/启动 ollama');
  }
  const present = new Set(
    listOut
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('NAME'))
      .map((l) => l.split(/\s+/)[0])
      .filter(Boolean),
  );
  const missing = requiredModels.filter((m) => !present.has(m));
  if (missing.length === 0) return;
  if (!pullMissing) {
    throw new Error(`缺少模型：${missing.join(', ')}。可先手动 pull，或使用 --pull-missing`);
  }
  for (const m of missing) {
    process.stdout.write(`pull ${m}\n`);
    execFileSync('ollama', ['pull', m], { stdio: 'inherit' });
  }
};

const packAgent = () => {
  const home = os.homedir();
  const openclawDir = path.join(home, '.openclaw');
  const nvmDir = path.join(home, '.nvm');
  const clawPlist = path.join(home, 'Library', 'LaunchAgents', 'com.clawdbot.gateway.plist');
  const ollamaPlist = path.join(home, 'Library', 'LaunchAgents', 'com.ollama.serve.plist');
  const ollamaBin = resolveDownloadsOllama();

  const missing = [openclawDir, nvmDir, clawPlist, ollamaPlist, ollamaBin].filter((p) => !exists(p));
  if (missing.length) {
    throw new Error(`缺少离线包源文件/目录：\n${missing.map((p) => `- ${p}`).join('\n')}`);
  }

  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wage-offline-pack-'));
  fs.cpSync(openclawDir, path.join(tmpBase, '.openclaw'), { recursive: true, force: true });
  fs.cpSync(nvmDir, path.join(tmpBase, '.nvm'), { recursive: true, force: true });
  fs.copyFileSync(ollamaBin, path.join(tmpBase, 'ollama'));
  fs.chmodSync(path.join(tmpBase, 'ollama'), 0o755);
  fs.copyFileSync(clawPlist, path.join(tmpBase, 'com.clawdbot.gateway.plist'));
  fs.copyFileSync(ollamaPlist, path.join(tmpBase, 'com.ollama.serve.plist'));

  atomicTarGz(outAgent, ['-C', tmpBase, '.openclaw', '.nvm', 'ollama', 'com.clawdbot.gateway.plist', 'com.ollama.serve.plist']);

  return { outAgent };
};

const packLlm = () => {
  ensureOllamaModels();
  const ollamaHome = path.join(os.homedir(), '.ollama');
  const modelsDir = path.join(ollamaHome, 'models');
  if (!exists(modelsDir)) throw new Error(`未找到目录：${modelsDir}。请先运行 ollama 并下载模型。`);
  atomicTarGz(outLlm, ['-C', os.homedir(), '.ollama/models']);
  return { outLlm };
};

const main = async () => {
  const agent = packAgent();
  process.stdout.write(`生成 agent.gz: ${agent.outAgent}\n`);
  try {
    const llm = packLlm();
    process.stdout.write(`生成 llm.gz: ${llm.outLlm}\n`);
  } catch (e) {
    process.stdout.write(`跳过 llm.gz: ${e?.message || String(e)}\n`);
  }
};

main().catch((e) => {
  process.stderr.write(`${e?.message || String(e)}\n`);
  process.exit(1);
});
