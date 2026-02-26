import { useState, useEffect, useRef } from 'react';
import './App.css';
import './Setup.css';
import './Loading.css';
import OllamaWebUI from './components/OllamaWebUI';

const TopNav = ({
  activeTab,
  onTabChange,
  theme,
  onSetTheme,
  brandIconText,
  headerNotice,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
  theme: 'dark' | 'light';
  onSetTheme: (theme: 'dark' | 'light') => void;
  brandIconText: string;
  headerNotice?: { message: string; kind: 'info' | 'success' | 'error'; busy?: boolean } | null;
}) => (
  <div className="app-header">
    <div className="app-brand">
      <div className="app-logo">{brandIconText}</div>
      <div className="app-title">元梦 AI</div>
    </div>
    <div className="app-tabs" aria-label="主导航">
      <button className={activeTab === 'ollama' ? 'active' : ''} onClick={() => onTabChange('ollama')}>
        AI 对话
      </button>
      <button className={activeTab === 'openclaw' ? 'active' : ''} onClick={() => onTabChange('openclaw')}>
        AI 智能体
      </button>
      <button
        className={activeTab === 'settings' ? 'active icon' : 'icon'}
        onClick={() => onTabChange('settings')}
        aria-label="系统"
        title="系统"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 15.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2Z"
            stroke="currentColor"
            strokeWidth="1.6"
          />
          <path
            d="M19.4 13.5a7.9 7.9 0 0 0 0-3l2-1.5-2-3.4-2.4 1a8 8 0 0 0-2.6-1.5L14 2h-4l-.4 2.1a8 8 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.5a7.9 7.9 0 0 0 0 3l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 2.6 1.5L10 22h4l.4-2.1a8 8 0 0 0 2.6-1.5l2.4 1 2-3.4-2-1.5Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {headerNotice?.message && (
        <div className={`header-notice ${headerNotice.kind} ${headerNotice.busy ? 'busy' : ''}`} aria-live="polite">
          {headerNotice.message}
        </div>
      )}
    </div>
    <div className="app-actions">
      <div className="theme-toggle" role="group" aria-label="主题切换">
        <button
          className={theme === 'light' ? 'active' : ''}
          onClick={() => onSetTheme('light')}
          aria-label="白天模式"
          title="白天"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="M12 2v2.5M12 19.5V22M4 12H2M22 12h-2.5M5.1 5.1 3.3 3.3M20.7 20.7l-1.8-1.8M18.9 5.1l1.8-1.8M3.3 20.7l1.8-1.8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <button
          className={theme === 'dark' ? 'active' : ''}
          onClick={() => onSetTheme('dark')}
          aria-label="暗夜模式"
          title="暗夜"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path
              d="M21 13.2A7.6 7.6 0 0 1 10.8 3a7.9 7.9 0 1 0 10.2 10.2Z"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </div>
);

// Removed inline OllamaChat component in favor of import
function App() {
  const [activeTab, setActiveTab] = useState('ollama');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('wage_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  
  // Status State
  const [ollamaStatus, setOllamaStatus] = useState<string>('检查中...');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [openClawStatus, setOpenClawStatus] = useState<string>('未就绪');
  const [logs, setLogs] = useState<string[]>([]);
  const [openclawCliStatusText, setOpenclawCliStatusText] = useState<string>('');
  const [openclawCliStatusBusy, setOpenclawCliStatusBusy] = useState<boolean>(false);
  const [openclawCliStatusAt, setOpenclawCliStatusAt] = useState<number>(0);
  const [overviewSessionStall, setOverviewSessionStall] = useState<any>(null);
  const [overviewLastLlmError, setOverviewLastLlmError] = useState<any>(null);
  const [securityAuditText, setSecurityAuditText] = useState<string>('');
  const [securityAuditBusy, setSecurityAuditBusy] = useState<boolean>(false);
  const [securityAuditAt, setSecurityAuditAt] = useState<number>(0);
  const [securityFixBusy, setSecurityFixBusy] = useState<boolean>(false);
  const [securityAutoFixAt, setSecurityAutoFixAt] = useState<number>(0);
  const [securityAutoFixNote, setSecurityAutoFixNote] = useState<string>('');
  const [deployArmedUntil, setDeployArmedUntil] = useState<number>(0);
  const [offlineInstalling, setOfflineInstalling] = useState<boolean>(false);
  const [llmImporting, setLlmImporting] = useState<boolean>(false);
  const [ollamaToggling, setOllamaToggling] = useState<boolean>(false);
  const [gatewayToggling, setGatewayToggling] = useState<boolean>(false);
  const [openclawAuthRequestId, setOpenclawAuthRequestId] = useState<string>('');
  const [openclawAuthRunning, setOpenclawAuthRunning] = useState<boolean>(false);
  const [networkOnline, setNetworkOnline] = useState<boolean>(true);
  const [authModal, setAuthModal] = useState<{ title: string; detail?: string } | null>(null);
  const [localHintModal, setLocalHintModal] = useState<{ title: string; detail?: string; primaryRef?: string } | null>(null);
  const [modelActionBusy, setModelActionBusy] = useState<boolean>(false);
  const [openclawLocalModelPick, setOpenclawLocalModelPick] = useState<string>('');
  const [ollamaPsText, setOllamaPsText] = useState<string>('');
  const [offlineFallbackEnabled, setOfflineFallbackEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('wage_offline_fallback');
    if (saved === '0') return false;
    return true;
  });
  const [offlineFallbackBusy, setOfflineFallbackBusy] = useState<boolean>(false);
  const [lastAuthIssueKey, setLastAuthIssueKey] = useState<string>('');
  const [lastLocalHintKey, setLastLocalHintKey] = useState<string>('');
  const [lastAuthUrl, setLastAuthUrl] = useState<string>('');
  const [lastAuthCode, setLastAuthCode] = useState<string>('');
  const autoLoginAttemptedRef = useRef<boolean>(false);
  const autoSecurityFixAttemptedRef = useRef<boolean>(false);
  const lastModelsStatusProbeAtRef = useRef<number>(0);
  const networkProbeInitializedRef = useRef<boolean>(false);
  const networkOnlineStreakRef = useRef<number>(0);
  const networkOfflineStreakRef = useRef<number>(0);

  // Config State
  const [configContent, setConfigContent] = useState('');
  const [configStatus, setConfigStatus] = useState('');
  const [openclawPrimaryRef, setOpenclawPrimaryRef] = useState('');
  const [openclawPendingRef, setOpenclawPendingRef] = useState('');
  const [openclawFallbackDraft, setOpenclawFallbackDraft] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [feishuEnabled, setFeishuEnabled] = useState(false);
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [llmProviderId, setLlmProviderId] = useState('openai');
  const [llmApi, setLlmApi] = useState('openai-completions');
  const [llmBaseUrl, setLlmBaseUrl] = useState('https://api.openai.com/v1');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmModelId, setLlmModelId] = useState('gpt-4o-mini');
  const [brandIconText, setBrandIconText] = useState<string>(() => {
    const saved = localStorage.getItem('brand_icon_text');
    return (saved && saved.trim().slice(0, 2)) || '元';
  });
  const [settingsSection, setSettingsSection] = useState<
    'overview' | 'bootstrap' | 'channels' | 'llm' | 'models' | 'skills' | 'appearance' | 'advanced'
  >(
    'overview',
  );
  const [headerNotice, setHeaderNotice] = useState<{ message: string; kind: 'info' | 'success' | 'error'; busy?: boolean } | null>(
    null,
  );
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsQuery, setSkillsQuery] = useState('');
  const [skillsData, setSkillsData] = useState<any>(null);

  // Web UI URLs
  const [openClawUrl, setOpenClawUrl] = useState('http://127.0.0.1:18789/');
  const openclawWebviewRef = useRef<any>(null);

  const IconPlay = ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M9 7.5v9l8-4.5-8-4.5Z" fill="currentColor" />
    </svg>
  );
  const IconStop = ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M8 8h8v8H8V8Z" fill="currentColor" />
    </svg>
  );
  const IconDownload = ({ size = 18 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3v10m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 17v2h14v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const addLogBlock = (title: string, text: string) => {
    const ts = new Date().toLocaleTimeString();
    const lines = (text || '').split('\n').map((l) => l.trimEnd());
    const payload = [`[${ts}] ${title}`, ...lines.filter(Boolean).map((l) => `[${ts}]   ${l}`)];
    setLogs((prev) => [...payload, ...prev]);
  };

  const sanitizeInlineCode = (value: string) => value.replace(/`/g, '').trim();

  const ZAI_DEFAULT_BASE_URL = 'https://api.z.ai/v1';

  const normalizeBaseUrl = (raw: string) => {
    const trimmed = sanitizeInlineCode(raw || '');
    if (!trimmed) return '';
    return trimmed.replace(/\/+$/, '');
  };

  const normalizeOllamaBaseUrl = (raw: string) => {
    const base = normalizeBaseUrl(raw || 'http://127.0.0.1:11434/v1');
    return base.endsWith('/v1') ? base : `${base}/v1`;
  };

  const splitModelRef = (rawRef: string) => {
    const ref = sanitizeInlineCode(rawRef || '');
    const idx = ref.indexOf('/');
    if (idx < 0) return { ref, providerId: '', modelId: '' };
    const providerId = ref.slice(0, idx).trim();
    const modelId = ref.slice(idx + 1).trim();
    return { ref: `${providerId}/${modelId}`, providerId, modelId };
  };

  const normalizeModelRefForApp = (rawRef: string) => {
    const { ref, providerId, modelId } = splitModelRef(rawRef || '');
    if (!ref.includes('/')) return ref;
    const normalizedProvider = providerId.trim().toLowerCase();
    const normalizedModel = modelId.trim();
    const looksLikeGlm47 =
      normalizedModel.toLowerCase() === 'glm-4.7' ||
      normalizedModel.toLowerCase() === 'zai-org/glm-4.7' ||
      normalizedModel.toLowerCase() === 'zai-org\\glm-4.7' ||
      normalizedModel.toLowerCase() === 'glm-4.7'.toLowerCase();
    if (normalizedProvider === 'nvidia' && looksLikeGlm47) {
      return 'zai/glm-4.7';
    }
    if (normalizedProvider === 'zai' && normalizedModel.toLowerCase() === 'zai-org/glm-4.7') {
      return 'zai/glm-4.7';
    }
    return `${providerId}/${modelId}`;
  };

  const normalizeLlmInputForApp = (input: {
    providerId: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
  }) => {
    let providerId = sanitizeInlineCode(input.providerId);
    let baseUrl = sanitizeInlineCode(input.baseUrl);
    let apiKey = sanitizeInlineCode(input.apiKey);
    let modelId = sanitizeInlineCode(input.modelId);

    const lowerProvider = providerId.toLowerCase();
    const lowerModel = modelId.toLowerCase();
    const looksLikeGlm47 =
      lowerModel === 'glm-4.7' ||
      lowerModel === 'zai-org/glm-4.7' ||
      lowerModel === 'zai-org\\glm-4.7' ||
      lowerModel === 'glm-4.7';

    if (looksLikeGlm47 && (lowerProvider === 'nvidia' || lowerProvider === 'zai')) {
      providerId = 'zai';
      modelId = 'glm-4.7';
      baseUrl = normalizeBaseUrl(baseUrl || ZAI_DEFAULT_BASE_URL);
    }

    if (providerId.toLowerCase() === 'zai') {
      baseUrl = normalizeBaseUrl(baseUrl || ZAI_DEFAULT_BASE_URL);
    } else {
      baseUrl = normalizeBaseUrl(baseUrl);
    }

    return { providerId, baseUrl, apiKey, modelId };
  };

  const getFallbackDraftFromConfigText = (raw: string) => {
    try {
      const cfg = JSON.parse(raw || '{}');
      const arr = cfg?.agents?.defaults?.model?.fallbacks;
      const list = Array.isArray(arr)
        ? arr.map((v: any) => (v ?? '').toString().trim()).filter(Boolean)
        : [];
      return list.join('\n');
    } catch {
      return '';
    }
  };

  const normalizeFallbackRefsForSave = (draft: string, opts: { localModels: string[]; preferredLocal?: string }) => {
    const rawTokens = (draft || '')
      .split(/\n|,/g)
      .map((t) => (t || '').trim())
      .filter(Boolean);

    const localModels = (opts.localModels || []).map((m) => (m || '').trim()).filter(Boolean);
    const resolveLocalFallback = (prefer?: string) => {
      const preferred = (prefer || '').trim();
      if (preferred && localModels.includes(preferred)) return `ollama/${preferred}`;
      const picked = pickFasterLocalModel(localModels, '');
      if (picked && localModels.includes(picked)) return `ollama/${picked}`;
      return '';
    };

    const normalized = rawTokens
      .map((t) => {
        if (t.includes('/')) return t;
        if (localModels.includes(t)) return `ollama/${t}`;
        if (t === 'coder-model' || t === 'vision-model') return `qwen-portal/${t}`;
        return t;
      })
      .map((t) => {
        if (!t.startsWith('ollama/')) return t;
        const id = t.slice('ollama/'.length).trim();
        if (!id) return '';
        if (localModels.includes(id)) return `ollama/${id}`;
        return resolveLocalFallback(opts.preferredLocal);
      })
      .filter(Boolean);

    const keepValid = normalized.filter((t) => t.includes('/'));
    const localCandidates = keepValid.filter((t) => t.startsWith('ollama/'));
    const keepLocal =
      (opts.preferredLocal && opts.localModels.includes(opts.preferredLocal) ? `ollama/${opts.preferredLocal}` : '') ||
      (localCandidates.length ? localCandidates[localCandidates.length - 1] : '');

    const withoutLocal = keepValid.filter((t) => !t.startsWith('ollama/'));
    const ordered = keepLocal ? [...withoutLocal, keepLocal] : withoutLocal;

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const ref of ordered) {
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      deduped.push(ref);
    }
    return deduped;
  };

  const formatClock = (ms: number) => {
    if (!ms || !Number.isFinite(ms) || ms <= 0) return '—';
    return new Date(ms).toLocaleTimeString();
  };

  const splitTitledBlocks = (text: string, titles: string[]) => {
    const raw = (text || '').toString();
    const lines = raw.split('\n');
    const titleSet = new Set(titles.map((t) => t.trim()).filter(Boolean));
    const blocks: Record<string, string> = {};
    let current = '';
    let buf: string[] = [];
    const flush = () => {
      if (!current) return;
      blocks[current] = buf.join('\n').trim();
      buf = [];
    };
    for (const line of lines) {
      const key = (line || '').trim();
      if (titleSet.has(key)) {
        flush();
        current = key;
        continue;
      }
      if (current) buf.push(line);
    }
    flush();
    return blocks;
  };

  const parseSecurityAuditSummary = (text: string) => {
    const raw = (text || '').toString();
    const m = raw.match(/Summary:\s*(\d+)\s*critical\s*[·•]\s*(\d+)\s*warn\s*[·•]\s*(\d+)\s*info/i);
    if (m) return { critical: Number(m[1] || 0), warn: Number(m[2] || 0), info: Number(m[3] || 0) };
    const lines = raw.split('\n').map((l) => (l || '').trim());
    const counts = { critical: 0, warn: 0, info: 0 };
    for (const l of lines) {
      if (l === 'CRITICAL' || l.startsWith('CRITICAL ')) counts.critical += 1;
      else if (l === 'WARN' || l.startsWith('WARN ')) counts.warn += 1;
      else if (l === 'INFO' || l.startsWith('INFO ')) counts.info += 1;
    }
    return counts;
  };

  const parseSecurityAuditFindings = (text: string) => {
    const raw = (text || '').toString();
    const lines = raw.split('\n');
    const items: { level: 'critical' | 'warn' | 'info'; title: string; details: string; fix: string }[] = [];
    let cur: any = null;
    const flush = () => {
      if (!cur) return;
      const detailText = (cur.lines || []).join('\n').trim();
      const fixLine = (cur.fix || '').trim();
      items.push({ level: cur.level, title: cur.title, details: detailText, fix: fixLine });
      cur = null;
    };
    for (const line of lines) {
      const trimmed = (line || '').trim();
      const m = trimmed.match(/^(CRITICAL|WARN|INFO)\s+(.*)$/i);
      if (m) {
        flush();
        const lvl = (m[1] || '').toUpperCase();
        cur = {
          level: lvl === 'CRITICAL' ? 'critical' : lvl === 'WARN' ? 'warn' : 'info',
          title: (m[2] || '').trim(),
          lines: [],
          fix: '',
        };
        continue;
      }
      if (!cur) continue;
      if (/^Fix:\s*/i.test(trimmed)) {
        cur.fix = trimmed.replace(/^Fix:\s*/i, '').trim();
        continue;
      }
      if (trimmed.startsWith('Full report:') || trimmed.startsWith('Deep probe:') || /^Summary:/i.test(trimmed)) continue;
      cur.lines.push(line);
    }
    flush();
    return items;
  };

  const applySecurityAuditFixesToConfig = (raw: string) => {
    try {
      const next: any = JSON.parse(raw || '{}');
      next.agents = typeof next.agents === 'object' && next.agents ? next.agents : {};
      next.agents.defaults = typeof next.agents.defaults === 'object' && next.agents.defaults ? next.agents.defaults : {};
      next.agents.defaults.sandbox =
        typeof next.agents.defaults.sandbox === 'object' && next.agents.defaults.sandbox ? next.agents.defaults.sandbox : {};
      next.agents.defaults.sandbox.mode = 'all';

      next.tools = typeof next.tools === 'object' && next.tools ? next.tools : {};
      const prevDeny = Array.isArray(next.tools.deny) ? next.tools.deny : [];
      const deny = [...prevDeny.map((v: any) => (v ?? '').toString().trim()).filter(Boolean), 'group:web', 'browser'];
      const seen = new Set<string>();
      next.tools.deny = deny.filter((v) => {
        if (!v) return false;
        if (seen.has(v)) return false;
        seen.add(v);
        return true;
      });

      next.gateway = typeof next.gateway === 'object' && next.gateway ? next.gateway : {};
      if (!String(next.gateway.bind || '').trim()) next.gateway.bind = 'loopback';
      const prevTrusted = Array.isArray(next.gateway.trustedProxies) ? next.gateway.trustedProxies : [];
      if (!prevTrusted.length) next.gateway.trustedProxies = ['127.0.0.1', '::1'];

      return JSON.stringify(next, null, 2);
    } catch {
      return raw;
    }
  };

  const showHeaderNotice = (message: string, kind: 'info' | 'success' | 'error', opts?: { busy?: boolean; ttlMs?: number }) => {
    setHeaderNotice({ message, kind, busy: Boolean(opts?.busy) });
    if (opts?.ttlMs && opts.ttlMs > 0) {
      window.setTimeout(() => {
        setHeaderNotice((cur) => (cur?.message === message ? null : cur));
      }, opts.ttlMs);
    }
  };

  const showAuthModal = (title: string, detail?: string) => {
    setAuthModal((cur) => (cur ? cur : { title, detail }));
  };

  const showLocalHintModal = (title: string, detail?: string, primaryRef?: string) => {
    if (authModal) return;
    setLocalHintModal((cur) => (cur ? cur : { title, detail, primaryRef }));
  };

  const closeAuthModal = () => {
    setAuthModal(null);
  };

  const closeLocalHintModal = () => {
    setLocalHintModal(null);
  };

  const pickFasterLocalModel = (models: string[], currentModelId: string) => {
    const cleaned = (models || [])
      .map((m) => (m || '').trim())
      .filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud') && !m.startsWith('x/'));
    const candidates = cleaned.filter((m) => m !== currentModelId);
    const prefer = (re: RegExp) => candidates.find((m) => re.test(m)) || '';
    const byParam = () => {
      const scored = candidates
        .map((m) => {
          const mm = m.match(/:(\d+)\s*b\b/i);
          const b = mm ? Number(mm[1]) : Number.POSITIVE_INFINITY;
          return { m, b };
        })
        .filter((x) => Number.isFinite(x.b))
        .sort((a, b) => a.b - b.b);
      return scored[0]?.m || '';
    };
    return (
      prefer(/qwen2\.5:7b/i) ||
      prefer(/:7b\b/i) ||
      prefer(/:8b\b/i) ||
      prefer(/:14b\b/i) ||
      byParam() ||
      candidates[0] ||
      cleaned[0] ||
      ''
    );
  };

  const parseOllamaPsModels = (text: string) => {
    const lines = (text || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const out: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('NAME') && line.includes('ID') && line.includes('UNTIL')) continue;
      const first = line.split(/\s+/)[0] || '';
      if (!first || first === 'NAME') continue;
      out.push(first);
    }
    return out;
  };

  const refreshOllamaPs = async (opts?: { quiet?: boolean }) => {
    if (!window.api?.ollamaPs) return;
    try {
      const res = await window.api.ollamaPs();
      const text = (res?.output || res?.message || '').toString();
      setOllamaPsText(text);
    } catch (e: any) {
      if (!opts?.quiet) showHeaderNotice('读取 ollama ps 失败', 'error', { ttlMs: 2500 });
      setOllamaPsText('');
    }
  };

  const stopOtherRunningOllamaModels = async (keepModelId: string) => {
    if (!window.api?.ollamaPs || !window.api?.ollamaStopModel) return;
    const keep = (keepModelId || '').trim();
    if (!keep) return;
    try {
      const res = await window.api.ollamaPs();
      const text = (res?.output || res?.message || '').toString();
      setOllamaPsText(text);
      const running = parseOllamaPsModels(text);
      const toStop = running.filter((m) => m && m !== keep);
      if (!toStop.length) return;
      for (const m of toStop) {
        try {
          await window.api.ollamaStopModel(m, { force: true });
        } catch {}
      }
      await refreshOllamaPs({ quiet: true });
    } catch {}
  };

  const switchToCloudRef = async (preferredRef?: string) => {
    if (!window.api?.openclawSetPrimaryModel) return;
    const ref = (preferredRef || localStorage.getItem('wage_cloud_primary_ref') || 'qwen-portal/coder-model').trim();
    if (!ref.includes('/')) return;
    showHeaderNotice('正在切回云模型', 'info', { busy: true });
    addLog(`切回云模型：${ref}`);
    try {
      const res = await window.api.openclawSetPrimaryModel(ref);
      if (res?.status === 'ok') {
        showHeaderNotice('已切回云模型', 'success', { ttlMs: 2200 });
        if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
        await loadConfig();
      } else {
        showHeaderNotice('切换失败', 'error', { ttlMs: 3500 });
        addLog(`切换失败: ${res?.message || 'unknown error'}`);
        if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
      }
    } catch (e: any) {
      showHeaderNotice('切换异常', 'error', { ttlMs: 3500 });
      addLog(`切换异常: ${e?.message || 'unknown error'}`);
    }
  };

  const copyText = async (text: string) => {
    const value = (text || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = value;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    showHeaderNotice('已复制到剪贴板', 'success', { ttlMs: 1200 });
  };

  const switchOpenclawPrimaryRef = async () => {
    if (!window.api?.openclawSetPrimaryModel) return;
    const ref = normalizeModelRefForApp((openclawPendingRef || '').trim());
    if (!ref.includes('/')) {
      showHeaderNotice('模型格式不正确', 'error', { ttlMs: 2500 });
      return;
    }
    if (modelActionBusy) return;
    setModelActionBusy(true);
    showHeaderNotice('正在切换模型', 'info', { busy: true });
    addLog(`切换 OpenClaw 主模型：${ref}`);
    try {
      const { providerId, modelId } = splitModelRef(ref);
      const localModels = ollamaModels.filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'));
      const isLocalOllama = providerId === 'ollama' && modelId && localModels.includes(modelId);
      if (providerId === 'ollama' && modelId && !localModels.includes(modelId)) {
        showHeaderNotice('本地模型未安装', 'error', { ttlMs: 3500 });
        addLog(`本地模型未安装：${modelId}。请先在「AI 对话」中下载/加载模型，或改选已安装的本地模型。`);
        showLocalHintModal(
          '本地模型未安装',
          `当前主模型配置为：${ref}\n\n但本机 Ollama 未发现该模型：${modelId}\n\n解决方法：\n1) 打开「AI 对话」下载/加载该模型；或\n2) 在「模型策略」里改成已安装的本地模型。`,
          ref,
        );
        return;
      }
      try {
        const currentPrimary = normalizeModelRefForApp(getPrimaryRefFromConfigText(configContent) || openclawPrimaryRef || '');
        const nextIsOllama = providerId === 'ollama';
        if (nextIsOllama) {
          if (currentPrimary && currentPrimary.includes('/') && !currentPrimary.startsWith('ollama/')) {
            localStorage.setItem('wage_cloud_primary_ref', currentPrimary);
            localStorage.setItem('wage_cloud_primary_reason', 'manual');
          }
          localStorage.removeItem('wage_offline_switched_at');
        } else {
          localStorage.removeItem('wage_cloud_primary_ref');
          localStorage.removeItem('wage_cloud_primary_reason');
          localStorage.removeItem('wage_offline_switched_at');
        }
      } catch {}
      const res =
        isLocalOllama && window.api.openclawSetLocalOllamaModel
          ? await window.api.openclawSetLocalOllamaModel(modelId)
          : await window.api.openclawSetPrimaryModel(ref);
      if (res?.status === 'ok') {
        showHeaderNotice('模型已切换', 'success', { ttlMs: 2200 });
        if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
        if (isLocalOllama && modelId) {
          stopOtherRunningOllamaModels(modelId).catch(() => {});
        }
        await loadConfig();
      } else {
        showHeaderNotice('模型切换失败', 'error', { ttlMs: 3500 });
        addLog(`模型切换失败: ${res?.message || 'unknown error'}`);
        if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
      }
    } finally {
      setModelActionBusy(false);
    }
  };

  const getPrimaryRefFromConfigText = (raw: string) => {
    try {
      const cfg = JSON.parse(raw);
      const ref = (cfg?.agents?.defaults?.model?.primary ?? '').toString().trim();
      return ref;
    } catch {
      return '';
    }
  };

  const getProviderIdFromConfigText = (raw: string) => {
    const ref = getPrimaryRefFromConfigText(raw);
    if (!ref.includes('/')) return '';
    return splitModelRef(ref).providerId || '';
  };

  const getModelRefOptionsFromConfigText = (raw: string, opts?: { localOllamaModels?: string[] }) => {
    try {
      const cfg = JSON.parse(raw);
      const refs = new Set<string>();
      const primary = (cfg?.agents?.defaults?.model?.primary ?? '').toString().trim();
      const normalizedPrimary = normalizeModelRefForApp(primary);
      if (normalizedPrimary.includes('/')) refs.add(normalizedPrimary);
      const known = cfg?.agents?.defaults?.models ?? {};
      if (known && typeof known === 'object') {
        for (const k of Object.keys(known)) {
          const normalized = normalizeModelRefForApp(k || '');
          if (normalized && normalized.includes('/')) refs.add(normalized);
        }
      }
      const providers = cfg?.models?.providers ?? {};
      if (providers && typeof providers === 'object') {
        for (const pid of Object.keys(providers)) {
          const pc = providers[pid];
          const ms = Array.isArray(pc?.models) ? pc.models : [];
          for (const m of ms) {
            const id = (m?.id || m?.name || '').toString().trim();
            if (pid && id) refs.add(normalizeModelRefForApp(`${pid}/${id}`));
          }
        }
      }
      const localOllama = Array.isArray(opts?.localOllamaModels) ? opts?.localOllamaModels : [];
      for (const m of localOllama) {
        const name = (m || '').toString().trim();
        if (!name) continue;
        if (name.includes(':cloud') || name.includes('-cloud')) continue;
        refs.add(`ollama/${name}`);
      }
      return Array.from(refs).sort((a, b) => a.localeCompare(b));
    } catch {
      return [];
    }
  };

  type LlmEntry = { providerId: string; modelId: string; baseUrl: string; hasApiKey: boolean };

  const getLlmEntriesFromConfigText = (raw: string): LlmEntry[] => {
    try {
      const cfg = JSON.parse(raw || '{}');
      const providers = cfg?.models?.providers ?? {};
      if (!providers || typeof providers !== 'object') return [];
      const entries: LlmEntry[] = [];
      for (const providerId of Object.keys(providers)) {
        if (!providerId) continue;
        if (providerId === 'ollama') continue;
        const pc = providers[providerId] || {};
        const baseUrl = (pc?.baseUrl || '').toString().trim();
        const apiKey = (pc?.apiKey || '').toString().trim();
        const models = Array.isArray(pc?.models) ? pc.models : [];
        for (const m of models) {
          const modelId = (m?.id || m?.name || '').toString().trim();
          if (!modelId) continue;
          entries.push({ providerId, modelId, baseUrl, hasApiKey: Boolean(apiKey) });
        }
      }
      return entries.sort((a, b) => `${a.providerId}/${a.modelId}`.localeCompare(`${b.providerId}/${b.modelId}`));
    } catch {
      return [];
    }
  };

  const updateConfigWithLlmEntry = (raw: string, input: { providerId: string; baseUrl: string; apiKey: string; modelId: string }) => {
    const next: any = (() => {
      try {
        return JSON.parse(raw || '{}');
      } catch {
        return {};
      }
    })();
    const normalized = normalizeLlmInputForApp({
      providerId: input.providerId,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      modelId: input.modelId,
    });
    const providerId = normalized.providerId || '';
    const baseUrl = normalized.baseUrl;
    const apiKey = normalized.apiKey;
    const modelId = normalized.modelId || '';
    if (!providerId || !modelId) return raw;

    next.models = typeof next.models === 'object' && next.models ? next.models : {};
    next.models.providers = typeof next.models.providers === 'object' && next.models.providers ? next.models.providers : {};
    const prevProvider = typeof next.models.providers[providerId] === 'object' && next.models.providers[providerId] ? next.models.providers[providerId] : {};
    const prevModels = Array.isArray(prevProvider.models) ? prevProvider.models : [];
    const nextModels = [...prevModels];
    const existingIds = new Set(nextModels.map((m: any) => (m?.id || m?.name || '').toString()).filter(Boolean));
    if (!existingIds.has(modelId)) {
      nextModels.unshift({
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128000,
        maxTokens: 8192,
      });
    }
    next.models.providers[providerId] = {
      ...prevProvider,
      baseUrl,
      apiKey,
      api: 'openai-completions',
      models: nextModels,
    };

    const ref = `${providerId}/${modelId}`;
    next.agents = typeof next.agents === 'object' && next.agents ? next.agents : {};
    next.agents.defaults = typeof next.agents.defaults === 'object' && next.agents.defaults ? next.agents.defaults : {};
    next.agents.defaults.models = typeof next.agents.defaults.models === 'object' && next.agents.defaults.models ? next.agents.defaults.models : {};
    if (!next.agents.defaults.models[ref] || typeof next.agents.defaults.models[ref] !== 'object') {
      next.agents.defaults.models[ref] = {};
    }
    if (!next.agents.defaults.models[ref].alias) {
      next.agents.defaults.models[ref].alias = providerId.slice(0, 16);
    }

    if (providerId === 'zai' && apiKey) {
      next.env = typeof next.env === 'object' && next.env ? next.env : {};
      if (!String(next.env.ZAI_API_KEY || '').trim()) {
        next.env.ZAI_API_KEY = apiKey;
      } else if (String(next.env.ZAI_API_KEY || '').trim() !== apiKey) {
        next.env.ZAI_API_KEY = apiKey;
      }
    }

    return JSON.stringify(next, null, 2);
  };

  const removeConfigLlmEntry = (raw: string, input: { providerId: string; modelId: string }) => {
    const next: any = (() => {
      try {
        return JSON.parse(raw || '{}');
      } catch {
        return {};
      }
    })();
    const providerId = sanitizeInlineCode(input.providerId) || '';
    const modelId = sanitizeInlineCode(input.modelId) || '';
    if (!providerId || !modelId) return raw;

    const provider = next?.models?.providers?.[providerId];
    if (provider && typeof provider === 'object') {
      const models = Array.isArray(provider.models) ? provider.models : [];
      const kept = models.filter((m: any) => (m?.id || m?.name || '').toString().trim() !== modelId);
      provider.models = kept;
      if (!kept.length) {
        try {
          delete next.models.providers[providerId];
        } catch {}
      }
    }

    const ref = `${providerId}/${modelId}`;
    if (next?.agents?.defaults?.models && typeof next.agents.defaults.models === 'object') {
      try {
        delete next.agents.defaults.models[ref];
      } catch {}
    }
    const primary = (next?.agents?.defaults?.model?.primary || '').toString().trim();
    if (primary === ref) {
      next.agents = typeof next.agents === 'object' && next.agents ? next.agents : {};
      next.agents.defaults = typeof next.agents.defaults === 'object' && next.agents.defaults ? next.agents.defaults : {};
      next.agents.defaults.model = typeof next.agents.defaults.model === 'object' && next.agents.defaults.model ? next.agents.defaults.model : {};
      next.agents.defaults.model.primary = 'qwen-portal/coder-model';
    }

    return JSON.stringify(next, null, 2);
  };

  const updateConfigWithModelFallbacks = (
    raw: string,
    input: { fallbacks: string[]; preferredLocalModel?: string },
  ) => {
    const next: any = (() => {
      try {
        return JSON.parse(raw || '{}');
      } catch {
        return {};
      }
    })();

    next.agents = typeof next.agents === 'object' && next.agents ? next.agents : {};
    next.agents.defaults = typeof next.agents.defaults === 'object' && next.agents.defaults ? next.agents.defaults : {};
    next.agents.defaults.model = typeof next.agents.defaults.model === 'object' && next.agents.defaults.model ? next.agents.defaults.model : {};

    const primary = normalizeModelRefForApp((next.agents.defaults.model.primary || '').toString().trim());
    if (primary && primary.includes('/') && primary !== next.agents.defaults.model.primary) {
      next.agents.defaults.model.primary = primary;
    }

    const fallbacks = Array.isArray(input.fallbacks) ? input.fallbacks : [];
    next.agents.defaults.model.fallbacks = fallbacks;

    next.agents.defaults.models = typeof next.agents.defaults.models === 'object' && next.agents.defaults.models ? next.agents.defaults.models : {};
    const ensureModelKey = (ref: string) => {
      const r = (ref || '').trim();
      if (!r.includes('/')) return;
      if (!next.agents.defaults.models[r] || typeof next.agents.defaults.models[r] !== 'object') {
        next.agents.defaults.models[r] = {};
      }
      if (!next.agents.defaults.models[r].alias) {
        next.agents.defaults.models[r].alias = r.split('/', 2)[0].slice(0, 16);
      }
    };

    if (primary) ensureModelKey(primary);
    for (const r of fallbacks) ensureModelKey(r);

    const keepOllamaRefs = new Set<string>();
    if (primary.startsWith('ollama/')) keepOllamaRefs.add(primary);
    const lastFallbackOllama = [...fallbacks].reverse().find((r) => r.startsWith('ollama/')) || '';
    const preferredLocal = (input.preferredLocalModel || '').trim();
    const preferredLocalRef = preferredLocal ? `ollama/${preferredLocal}` : '';
    const keepLocalRef = lastFallbackOllama || preferredLocalRef;
    if (keepLocalRef && !primary.startsWith('ollama/')) keepOllamaRefs.add(keepLocalRef);

    for (const k of Object.keys(next.agents.defaults.models)) {
      if (!k.startsWith('ollama/')) continue;
      if (keepOllamaRefs.has(k)) continue;
      try {
        delete next.agents.defaults.models[k];
      } catch {}
    }

    if (keepOllamaRefs.size > 0) {
      next.models = typeof next.models === 'object' && next.models ? next.models : {};
      next.models.providers = typeof next.models.providers === 'object' && next.models.providers ? next.models.providers : {};
      const prevProvider = typeof next.models.providers.ollama === 'object' && next.models.providers.ollama ? next.models.providers.ollama : {};
      const prevModels = Array.isArray(prevProvider.models) ? prevProvider.models : [];

      const keepModelIds = new Set(Array.from(keepOllamaRefs).map((r) => splitModelRef(r).modelId).filter(Boolean));
      const nextModels = prevModels.filter((m: any) => keepModelIds.has((m?.id || m?.name || '').toString().trim()));
      for (const id of Array.from(keepModelIds)) {
        if (nextModels.some((m: any) => (m?.id || m?.name || '').toString().trim() === id)) continue;
        nextModels.unshift({
          id,
          name: id,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 8192,
        });
      }

      next.models.providers.ollama = {
        ...prevProvider,
        baseUrl: normalizeOllamaBaseUrl(String(prevProvider.baseUrl || 'http://127.0.0.1:11434/v1')) || 'http://127.0.0.1:11434/v1',
        apiKey: String(prevProvider.apiKey || '').trim() || 'a',
        api: String(prevProvider.api || '').trim() || 'openai-completions',
        models: nextModels,
      };
    }

    return JSON.stringify(next, null, 2);
  };

  const applyPrimaryRefSelection = (ref: string) => {
    const nextRef = normalizeModelRefForApp((ref || '').trim());
    if (!nextRef.includes('/')) return;
    setOpenclawPendingRef(nextRef);
    const { providerId: pid, modelId: mid } = splitModelRef(nextRef);
    if (pid) setLlmProviderId(pid);
    if (mid) setLlmModelId(mid);
    try {
      const cfg = JSON.parse(configContent || '{}');
      const providerCfg = cfg?.models?.providers?.[pid] ?? null;
      const baseUrl = sanitizeInlineCode((providerCfg?.baseUrl ?? '').toString());
      const api = sanitizeInlineCode((providerCfg?.api ?? 'openai-completions').toString());
      const apiKey = sanitizeInlineCode((providerCfg?.apiKey ?? '').toString());
      if (pid === 'zai') {
        const envKey = sanitizeInlineCode((cfg?.env?.ZAI_API_KEY ?? '').toString());
        setLlmBaseUrl(baseUrl || ZAI_DEFAULT_BASE_URL);
        if (envKey) setLlmApiKey(envKey);
        else if (apiKey) setLlmApiKey(apiKey);
      } else if (baseUrl) {
        setLlmBaseUrl(baseUrl);
      }
      setLlmApi(api || 'openai-completions');
      if (pid === 'qwen-portal') setLlmApiKey('qwen-oauth');
      else if (apiKey) setLlmApiKey(apiKey);
    } catch {}
  };

  useEffect(() => {
    const ref = getPrimaryRefFromConfigText(configContent);
    setOpenclawPrimaryRef(ref);
    setOpenclawPendingRef((cur) => (cur ? cur : ref));
  }, [configContent]);

  useEffect(() => {
    const primary = normalizeModelRefForApp((openclawPrimaryRef || '').trim());
    if (!primary.startsWith('ollama/')) return;
    if (ollamaStatus !== '已连接') return;
    const localModels = (ollamaModels || []).filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'));
    const modelId = splitModelRef(primary).modelId;
    if (!modelId) return;
    if (localModels.includes(modelId)) return;
    const key = `missing:${primary}`;
    if (key && key !== lastLocalHintKey) {
      setLastLocalHintKey(key);
      showLocalHintModal(
        '本地模型未安装',
        `当前主模型配置为：${primary}\n\n但本机 Ollama 未发现该模型：${modelId}\n\n解决方法：\n1) 打开「AI 对话」下载/加载该模型；或\n2) 在「模型策略」里改成已安装的本地模型。`,
        primary,
      );
    }
  }, [openclawPrimaryRef, ollamaModels, ollamaStatus]);

  const ensureOfflineFallbackToLocal = async () => {
    if (!window.api?.openclawSwitchToLocalOllama || !window.api?.getConfig) return;
    if (offlineFallbackBusy) return;
    setOfflineFallbackBusy(true);
    try {
      const current = await window.api.getConfig();
      const raw = (current?.content || '').toString();
      const primaryRef = getPrimaryRefFromConfigText(raw);
      if (primaryRef && primaryRef.startsWith('ollama/')) return;
      if (primaryRef && !primaryRef.startsWith('ollama/')) {
        localStorage.setItem('wage_cloud_primary_ref', primaryRef);
        localStorage.setItem('wage_cloud_primary_reason', 'offline');
      }
      const res = await window.api.openclawSwitchToLocalOllama();
      if (res?.status === 'ok') {
        localStorage.setItem('wage_offline_switched_at', String(Date.now()));
        addLog(`离线模式：已切换智能体模型到本地 Ollama（${res?.model || 'unknown'}）。`);
        showHeaderNotice('离线：已切换到本地模型', 'info', { ttlMs: 3500 });
        await initOpenClaw();
      } else {
        addLog(`离线模式：切换本地模型失败：${res?.message || 'unknown error'}`);
        showHeaderNotice('离线：本地模型不可用', 'error', { ttlMs: 3500 });
        showAuthModal('本地无网络', '检测到网络不可用，但本地 Ollama 未就绪或无模型可用。请切换到「AI 对话」并先下载/启动本地模型。');
      }
    } finally {
      setOfflineFallbackBusy(false);
    }
  };

  const restoreCloudPrimaryIfNeeded = async () => {
    if (!window.api?.openclawSetPrimaryModel || !window.api?.getConfig) return;
    const RESTORE_MIN_DWELL_MS = 5 * 60_000;
    const previous = (localStorage.getItem('wage_cloud_primary_ref') || '').trim();
    if (!previous) return;
    const reason = (localStorage.getItem('wage_cloud_primary_reason') || '').trim();
    if (reason !== 'offline') return;
    const switchedAtRaw = (localStorage.getItem('wage_offline_switched_at') || '').trim();
    const switchedAt = switchedAtRaw ? Number(switchedAtRaw) : 0;
    if (Number.isFinite(switchedAt) && switchedAt > 0) {
      const age = Date.now() - switchedAt;
      if (age >= 0 && age < RESTORE_MIN_DWELL_MS) return;
    }
    try {
      const current = await window.api.getConfig();
      const raw = (current?.content || '').toString();
      const primaryRef = getPrimaryRefFromConfigText(raw);
      if (!primaryRef.startsWith('ollama/')) {
        localStorage.removeItem('wage_cloud_primary_ref');
        localStorage.removeItem('wage_cloud_primary_reason');
        return;
      }
      const res = await window.api.openclawSetPrimaryModel(previous);
      if (res?.status === 'ok') {
        localStorage.setItem('wage_cloud_restored_at', String(Date.now()));
        addLog(`网络恢复：已恢复智能体模型到 ${previous}`);
        showHeaderNotice('网络恢复：已恢复云模型', 'success', { ttlMs: 2500 });
        localStorage.removeItem('wage_cloud_primary_ref');
        localStorage.removeItem('wage_cloud_primary_reason');
        await initOpenClaw();
      }
    } catch {}
  };

  const waitForGatewayReady = async (timeoutMs: number) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await window.api?.openclawGatewayStatus?.();
      if (res?.status === 'ok') return true;
      await new Promise((r) => window.setTimeout(r, 1000));
    }
    return false;
  };

  useEffect(() => {
    localStorage.setItem('wage_offline_fallback', offlineFallbackEnabled ? '1' : '0');
  }, [offlineFallbackEnabled]);

  const readConfigToSettings = (raw: string) => {
    try {
      const config = JSON.parse(raw);
      const tgEnabled = Boolean(config?.channels?.telegram?.enabled);
      const tgBotToken = sanitizeInlineCode(config?.channels?.telegram?.botToken ?? '');
      const accounts = config?.channels?.feishu?.accounts ?? {};
      const defaultAcc = accounts?.default ?? null;
      const firstKey = accounts && typeof accounts === 'object' ? (Object.keys(accounts)[0] as string | undefined) : undefined;
      const firstAcc = firstKey ? accounts[firstKey] : null;
      const appId = (defaultAcc?.appId ?? firstAcc?.appId ?? '').toString();
      const appSecret = (defaultAcc?.appSecret ?? firstAcc?.appSecret ?? '').toString();
      const feEnabled = typeof config?.channels?.feishu?.enabled === 'boolean'
        ? Boolean(config?.channels?.feishu?.enabled)
        : Boolean(defaultAcc?.enabled ?? firstAcc?.enabled);
      setTelegramEnabled(tgEnabled);
      setTelegramBotToken(tgBotToken);
      setFeishuEnabled(feEnabled);
      setFeishuAppId(appId);
      setFeishuAppSecret(appSecret);

      const primaryRef = (config?.agents?.defaults?.model?.primary ?? '').toString();
      const { providerId: primaryProvider, modelId: primaryModel } = splitModelRef(primaryRef);
      const providers = config?.models?.providers ?? {};
      const providerKeys = providers && typeof providers === 'object' ? Object.keys(providers) : [];
      const pickedProvider = primaryProvider || providerKeys[0] || llmProviderId;
      const providerCfg = providers?.[pickedProvider] ?? null;
      const baseUrl = sanitizeInlineCode((providerCfg?.baseUrl ?? llmBaseUrl).toString());
      const apiKey = sanitizeInlineCode((providerCfg?.apiKey ?? '').toString());
      const api = sanitizeInlineCode((providerCfg?.api ?? llmApi).toString());
      const models = Array.isArray(providerCfg?.models) ? providerCfg.models : [];
      const modelId =
        sanitizeInlineCode(primaryModel || models?.[0]?.id || models?.[0]?.name || llmModelId);

      setLlmProviderId(pickedProvider);
      if (pickedProvider === 'zai') {
        const envKey = sanitizeInlineCode((config?.env?.ZAI_API_KEY ?? '').toString());
        setLlmBaseUrl(baseUrl || ZAI_DEFAULT_BASE_URL);
        setLlmApiKey(envKey || apiKey);
      } else {
        setLlmBaseUrl(baseUrl);
        setLlmApiKey(apiKey);
      }
      setLlmApi(api || 'openai-completions');
      setLlmModelId(modelId);

      const fallbackDraft = getFallbackDraftFromConfigText(raw);
      setOpenclawFallbackDraft(fallbackDraft);
      try {
        const fallbacks = fallbackDraft
          .split(/\n|,/g)
          .map((v) => (v || '').trim())
          .filter(Boolean);
        const ollamaFallbacks = fallbacks.filter((v) => v.startsWith('ollama/'));
        const lastOllama = ollamaFallbacks.length ? ollamaFallbacks[ollamaFallbacks.length - 1] : '';
        const picked = splitModelRef(lastOllama).modelId || '';
        const localModels = ollamaModels.filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'));
        const resolved = picked && localModels.includes(picked) ? picked : pickFasterLocalModel(localModels, picked);
        if (resolved) setOpenclawLocalModelPick(resolved);
      } catch {}
    } catch {
      setTelegramEnabled(false);
      setTelegramBotToken('');
      setFeishuEnabled(false);
      setFeishuAppId('');
      setFeishuAppSecret('');
      setLlmProviderId('openai');
      setLlmApi('openai-completions');
      setLlmBaseUrl('https://api.openai.com/v1');
      setLlmApiKey('');
      setLlmModelId('gpt-4o-mini');
      setOpenclawFallbackDraft('');
    }
  };

  const applySettingsToConfig = (raw: string) => {
    const next: any = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    })();

    next.channels = typeof next.channels === 'object' && next.channels ? next.channels : {};
    next.channels.telegram = typeof next.channels.telegram === 'object' && next.channels.telegram ? next.channels.telegram : {};
    next.channels.telegram.enabled = Boolean(telegramEnabled);
    next.channels.telegram.botToken = sanitizeInlineCode(telegramBotToken);
    next.channels.feishu = typeof next.channels.feishu === 'object' && next.channels.feishu ? next.channels.feishu : {};
    next.channels.feishu.enabled = Boolean(feishuEnabled);
    next.channels.feishu.accounts =
      typeof next.channels.feishu.accounts === 'object' && next.channels.feishu.accounts ? next.channels.feishu.accounts : {};
    const ensureAccount = (key: string) => {
      next.channels.feishu.accounts[key] =
        typeof next.channels.feishu.accounts[key] === 'object' && next.channels.feishu.accounts[key]
          ? next.channels.feishu.accounts[key]
          : {};
      next.channels.feishu.accounts[key].enabled = Boolean(feishuEnabled);
      if (feishuAppId.trim()) next.channels.feishu.accounts[key].appId = feishuAppId.trim();
      if (feishuAppSecret.trim()) next.channels.feishu.accounts[key].appSecret = feishuAppSecret.trim();
      if (!next.channels.feishu.accounts[key].domain) next.channels.feishu.accounts[key].domain = 'feishu';
    };
    ensureAccount('default');
    if (next.channels.feishu.accounts.ziv) ensureAccount('ziv');
    const preferredRef = sanitizeInlineCode(openclawPendingRef);
    if (preferredRef && preferredRef.includes('/')) {
      next.agents = typeof next.agents === 'object' && next.agents ? next.agents : {};
      next.agents.defaults = typeof next.agents.defaults === 'object' && next.agents.defaults ? next.agents.defaults : {};
      next.agents.defaults.model = typeof next.agents.defaults.model === 'object' && next.agents.defaults.model ? next.agents.defaults.model : {};
      next.agents.defaults.model.primary = preferredRef;
    }

    next.plugins = typeof next.plugins === 'object' && next.plugins ? next.plugins : {};
    next.plugins.entries = typeof next.plugins.entries === 'object' && next.plugins.entries ? next.plugins.entries : {};
    next.plugins.entries.telegram = {
      ...(typeof next.plugins.entries.telegram === 'object' && next.plugins.entries.telegram ? next.plugins.entries.telegram : {}),
      enabled: Boolean(telegramEnabled),
    };
    next.plugins.entries.feishu = {
      ...(typeof next.plugins.entries.feishu === 'object' && next.plugins.entries.feishu ? next.plugins.entries.feishu : {}),
      enabled: Boolean(feishuEnabled),
    };

    return JSON.stringify(next, null, 2);
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('wage_theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!deployArmedUntil) return;
    const now = Date.now();
    const delay = Math.max(0, deployArmedUntil - now);
    const handle = window.setTimeout(() => setDeployArmedUntil(0), delay);
    return () => window.clearTimeout(handle);
  }, [deployArmedUntil]);

  useEffect(() => {
    if (!window.api?.onInstallProgress) return;
    return window.api.onInstallProgress((log) => {
      const text = (log ?? '').toString();
      if (!text.trim()) return;
      if (text.includes('\n')) addLogBlock('安装输出', text);
      else addLog(text.trimEnd());
    });
  }, []);

  useEffect(() => {
    if (!window.api?.onOpenclawAuthOutput) return;
    return window.api.onOpenclawAuthOutput((chunk: any) => {
      const stripAnsi = (input: string) =>
        (input || '')
          .toString()
          .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
          .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
          .replace(/\r/g, '');
      const requestId = (chunk?.requestId || '').toString();
      if (openclawAuthRequestId && requestId && requestId !== openclawAuthRequestId) return;
      const data = stripAnsi((chunk?.data || '').toString());
      const authUrl = (chunk?.authUrl || '').toString();
      const userCode = (chunk?.userCode || '').toString();
      if (authUrl) {
        setLastAuthUrl(authUrl);
        addLog(`Qwen OAuth 授权链接：${authUrl}`);
        showAuthModal('需要完成 Qwen Portal 授权', '已生成授权链接；如果没有自动弹出浏览器，可点击弹窗内“打开授权页面”。');
      }
      if (userCode) {
        setLastAuthCode(userCode);
        addLog(`Qwen OAuth 授权码：${userCode}`);
      }
      if (data.trim()) {
        const lines = data
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => {
            const t = l.trim();
            if (!t) return false;
            if (t === '^D') return false;
            if (/^[◐◑◒◓]/.test(t) && (t.includes('等待Qwen OAuth批准') || t.includes('正在启动Qwen OAuth'))) return false;
            return true;
          });
        const cleaned = lines.join('\n').trimEnd();
        if (!cleaned.trim()) return;
        if (cleaned.includes('\n')) addLogBlock('Qwen OAuth', cleaned);
        else addLog(cleaned);
      }
      if (chunk?.error) {
        addLog(`Qwen OAuth 错误: ${(chunk.error || '').toString()}`);
        setOpenclawAuthRunning(false);
        setOpenclawAuthRequestId('');
        showHeaderNotice('Qwen OAuth 失败', 'error', { ttlMs: 3500 });
        return;
      }
      if (chunk?.done) {
        setOpenclawAuthRunning(false);
        setOpenclawAuthRequestId('');
        showHeaderNotice('Qwen OAuth 已结束', 'success', { ttlMs: 2500 });
      }
    });
  }, [openclawAuthRequestId]);

  useEffect(() => {
    let cancelled = false;
    const NETWORK_CHECK_INTERVAL_MS = 60_000;
    const NETWORK_STATE_CHANGE_THRESHOLD = 3;
    const tick = async () => {
      if (cancelled) return;
      let online = Boolean(navigator.onLine);
      if (window.api?.openclawNetworkOnline) {
        try {
          const res = await window.api.openclawNetworkOnline();
          if (cancelled) return;
          if (res?.status === 'ok') online = Boolean(res.online);
        } catch {}
      }

      if (!networkProbeInitializedRef.current) {
        networkProbeInitializedRef.current = true;
        networkOnlineStreakRef.current = online ? 1 : 0;
        networkOfflineStreakRef.current = online ? 0 : 1;
        setNetworkOnline(online);
        return;
      }

      if (online) {
        networkOnlineStreakRef.current = Math.min(1000, networkOnlineStreakRef.current + 1);
        networkOfflineStreakRef.current = 0;
      } else {
        networkOfflineStreakRef.current = Math.min(1000, networkOfflineStreakRef.current + 1);
        networkOnlineStreakRef.current = 0;
      }

      setNetworkOnline((cur) => {
        if (online && networkOnlineStreakRef.current >= NETWORK_STATE_CHANGE_THRESHOLD) return true;
        if (!online && networkOfflineStreakRef.current >= NETWORK_STATE_CHANGE_THRESHOLD) return false;
        return cur;
      });
    };
    tick();
    const t = window.setInterval(() => {
      tick().catch(() => {});
    }, NETWORK_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!offlineFallbackEnabled) return;
    if (activeTab !== 'openclaw') return;
    if (openClawStatus !== '已就绪') return;
    if (!networkOnline) {
      ensureOfflineFallbackToLocal();
      return;
    }
    restoreCloudPrimaryIfNeeded();
  }, [activeTab, openClawStatus, networkOnline, offlineFallbackEnabled]);


  useEffect(() => {
    if (activeTab !== 'openclaw') return;
    if (openClawStatus !== '已就绪') return;
    const el: any = openclawWebviewRef.current;
    if (!el || typeof el.addEventListener !== 'function') return;

    const fmtUrl = (u: any) => {
      const s = (u || '').toString();
      return s.length > 200 ? `${s.slice(0, 200)}…` : s;
    };

    const onDidStartLoading = () => addLog('智能体界面：开始加载');
    const onDidStopLoading = () => addLog('智能体界面：加载完成');
    const onDidFailLoad = (e: any) =>
      addLog(`智能体界面：加载失败 code=${e?.errorCode ?? ''} desc=${e?.errorDescription ?? ''} url=${fmtUrl(e?.validatedURL)}`);
    const onDidNavigate = (e: any) => addLog(`智能体界面：跳转 ${fmtUrl(e?.url)}`);
    const onDidNavigateInPage = (e: any) => addLog(`智能体界面：页面内跳转 ${fmtUrl(e?.url)}`);
    const onCrashed = () => addLog('智能体界面：渲染进程崩溃');

    el.addEventListener('did-start-loading', onDidStartLoading);
    el.addEventListener('did-stop-loading', onDidStopLoading);
    el.addEventListener('did-fail-load', onDidFailLoad);
    el.addEventListener('did-navigate', onDidNavigate);
    el.addEventListener('did-navigate-in-page', onDidNavigateInPage);
    el.addEventListener('crashed', onCrashed);

    return () => {
      try { el.removeEventListener('did-start-loading', onDidStartLoading); } catch {}
      try { el.removeEventListener('did-stop-loading', onDidStopLoading); } catch {}
      try { el.removeEventListener('did-fail-load', onDidFailLoad); } catch {}
      try { el.removeEventListener('did-navigate', onDidNavigate); } catch {}
      try { el.removeEventListener('did-navigate-in-page', onDidNavigateInPage); } catch {}
      try { el.removeEventListener('crashed', onCrashed); } catch {}
    };
  }, [activeTab, openClawStatus]);

  useEffect(() => {
    let cancelled = false;
    if (activeTab !== 'openclaw') return;
    if (openClawStatus !== '已就绪') return;
    if (!window.api) return;

    const poll = async () => {
      if (cancelled) return;
      if (!window.api?.getConfig) return;
      if (openclawAuthRunning) return;
      if (offlineFallbackBusy) return;

      const cfgRes = await window.api.getConfig();
      const raw = (cfgRes?.content || '').toString();
      const providerId = getProviderIdFromConfigText(raw);
      const primaryRef = getPrimaryRefFromConfigText(raw);

      if (offlineFallbackEnabled && !networkOnline) return;

      const now = Date.now();
      if (providerId === 'qwen-portal') {
        if (window.api?.openclawModelsStatus && now - lastModelsStatusProbeAtRef.current > 20_000) {
          lastModelsStatusProbeAtRef.current = now;
          const modelsRes = await window.api.openclawModelsStatus();
          const text = (modelsRes?.output || modelsRes?.message || '').toString();
          if (text.includes('OAuth/token status') && text.includes('- none')) {
            showAuthModal('需要登录 Qwen Portal', '检测到 Qwen Portal 未登录或令牌已过期。已为你准备一键登录流程。');
            if (networkOnline && !autoLoginAttemptedRef.current) {
              autoLoginAttemptedRef.current = true;
              startQwenPortalOAuthLogin();
            }
          }
        }

        if (window.api?.openclawLastLlmError) {
          const errRes = await window.api.openclawLastLlmError();
          if (errRes?.status === 'ok' && errRes.found) {
            const errorMessage = (errRes.errorMessage || '').toString();
            const ts = (errRes.timestamp || '').toString();
            const key = `${ts}:${errorMessage}`;
            const ms = Date.parse(ts);
            const fresh = Number.isFinite(ms) ? Math.abs(Date.now() - ms) < 2 * 60_000 : true;
            if (fresh && key && key !== lastAuthIssueKey && errorMessage.includes('401')) {
              setLastAuthIssueKey(key);
              showAuthModal('登录已过期', '智能体调用 Qwen Portal 返回 401（token 失效/过期）。已为你准备一键重新登录。');
              if (networkOnline && !autoLoginAttemptedRef.current) {
                autoLoginAttemptedRef.current = true;
                startQwenPortalOAuthLogin();
              }
            }
          }
        }
      } else if (providerId === 'ollama') {
        if (window.api?.openclawLastLlmError) {
          const errRes = await window.api.openclawLastLlmError();
          if (errRes?.status === 'ok' && errRes.found) {
            const errorMessage = (errRes.errorMessage || '').toString();
            const ts = (errRes.timestamp || '').toString();
            const key = `${ts}:${errorMessage}`;
            const ms = Date.parse(ts);
            const fresh = Number.isFinite(ms) ? Math.abs(Date.now() - ms) < 2 * 60_000 : true;
            if (fresh && key && key !== lastLocalHintKey && /context window too small|blocked model/i.test(errorMessage)) {
              setLastLocalHintKey(key);
              showLocalHintModal(
                '本地模型被拦截',
                `检测到本地模型配置的上下文窗口过小，OpenClaw 已阻止调用。\n\n错误：${errorMessage}`,
                primaryRef,
              );
            }
          }
        }

        if (window.api?.openclawSessionStallStatus && primaryRef.startsWith('ollama/')) {
          const stall = await window.api.openclawSessionStallStatus();
          if (stall?.status === 'ok' && stall.found && stall.pending && typeof stall.ageMs === 'number') {
            const ageMs = stall.ageMs;
            if (ageMs > 18_000) {
              const key = `${primaryRef}:${stall.lastUserAt || ''}`;
              if (key && key !== lastLocalHintKey) {
                setLastLocalHintKey(key);
                const seconds = Math.round(ageMs / 1000);
                showLocalHintModal(
                  '本地模型正在生成（可能较慢）',
                  `最近一条消息已等待 ${seconds}s 仍未见到回复。\n\n本地大模型首 token 可能会比较慢；如果一直没有动静，建议切到更快的小模型，或回到云模型。`,
                  primaryRef,
                );
              }
            }
          }
        }
      }
    };

    poll();
    const t = window.setInterval(() => {
      poll().catch(() => {});
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [activeTab, openClawStatus, networkOnline, offlineFallbackEnabled, openclawAuthRunning, offlineFallbackBusy, lastAuthIssueKey]);

  const checkEnvironment = async (opts?: { quiet?: boolean }) => {
    if (!window.api) return;
    const quiet = Boolean(opts?.quiet);
    const log = (msg: string) => {
      if (!quiet) addLog(msg);
    };

    // Check Ollama
    try {
      log('正在检查 AI 引擎...');
      const ollamaRes = await window.api.checkOllama();
      if (ollamaRes.status === 'ok') {
        setOllamaStatus('已连接');
        const models = ollamaRes.models
          ?.split('\n')
          .filter((line) => line && !line.startsWith('NAME'))
          .map((line) => line.split(/\s+/)[0]) || [];
        setOllamaModels(models);
        const localModels = models.filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'));
        setOpenclawLocalModelPick((cur) => (cur ? cur : localModels[0] || models[0] || ''));
        log(`AI 引擎已连接。发现 ${models.length} 个模型。`);
      } else {
        setOllamaStatus('未就绪');
        setOllamaModels([]);
        setOpenclawLocalModelPick('');
        log(`AI 引擎错误: ${ollamaRes.message}`);
      }
    } catch (err: any) {
      setOllamaStatus('错误');
      log(`AI 引擎检查失败: ${err.message}`);
    }

    // Check OpenClaw
    try {
      log('正在检查 智能体服务...');
      const clawRes = await window.api.checkOpenClaw();
      const statusText = clawRes.status === 'ok' && clawRes.ready ? '已就绪' : '未就绪';
      setOpenClawStatus(statusText);
      log(`智能体服务: ${statusText}`);
      if (statusText === '已就绪' && openClawStatus !== '已就绪') {
        await initOpenClaw();
      }
      if (statusText === '已就绪') {
        await refreshOpenclawModelsStatus({ quiet: true });
      }
    } catch (err: any) {
      setOpenClawStatus('未就绪');
      log(`智能体服务检查失败: ${err.message}`);
    }
  };

  const loadConfig = async (opts?: { quiet?: boolean }) => {
    if (!window.api) return;
    const quiet = Boolean(opts?.quiet);
    if (!quiet) addLog('正在加载配置...');
    const res = await window.api.getConfig();
    if (res.status === 'ok' && res.content) {
      setConfigContent(res.content);
      readConfigToSettings(res.content);
      setConfigStatus('已加载');
      if (!quiet) addLog('配置加载成功。');
    } else {
      setConfigStatus('加载配置错误');
      if (!quiet) addLog(`配置加载失败: ${res.message}`);
    }
    await checkEnvironment({ quiet: quiet });
  };

  useEffect(() => {
    if (activeTab !== 'settings') return;
    if (settingsSection !== 'overview') return;
    refreshOverviewStatusPanels({ quiet: true }).catch(() => {});
    refreshSecurityAudit({ quiet: true }).catch(() => {});
  }, [activeTab, settingsSection]);

  const saveRawConfigAndRestart = async (nextContent: string) => {
    if (!window.api) return;
    setConfigContent(nextContent);
    addLog('正在保存配置...');
    showHeaderNotice('智能体正在加载配置', 'info', { busy: true });
    const res = await window.api.saveConfig(nextContent);
    if (res.status !== 'ok') {
      setConfigStatus('保存错误');
      showHeaderNotice('配置保存失败', 'error', { ttlMs: 4000 });
      addLog(`配置保存失败: ${res.message}`);
      return;
    }
    setConfigStatus('已保存');
    addLog('配置保存成功。');
    if (window.api.openclawRestart) {
      addLog('正在重启 智能体服务...');
      const rr = await window.api.openclawRestart();
      if (rr.status === 'ok') {
        showHeaderNotice('智能体服务 运行中', 'info', { busy: true });
        addLog('智能体服务重启完成。');
        if (rr.output) addLogBlock('智能体服务重启输出', rr.output);
        const ok = await waitForGatewayReady(30_000);
        if (ok) {
          setOpenClawStatus('已就绪');
          await initOpenClaw();
          showHeaderNotice('智能体已就绪', 'success', { ttlMs: 2500 });
        } else {
          showHeaderNotice('智能体启动超时', 'error', { ttlMs: 4000 });
        }
      } else {
        showHeaderNotice('智能体服务重启失败', 'error', { ttlMs: 4000 });
        addLog(`智能体服务重启失败: ${rr.message}`);
        if (rr.output) addLogBlock('智能体服务重启输出', rr.output);
      }
    }
    await checkEnvironment();
  };

  const refreshOverviewStatusPanels = async (opts?: { quiet?: boolean }) => {
    if (!window.api) return;
    const quiet = Boolean(opts?.quiet);
    try {
      if (window.api.openclawStatus) {
        setOpenclawCliStatusBusy(true);
        const st = await window.api.openclawStatus();
        if (st?.status === 'ok') {
          setOpenclawCliStatusText(String(st.output || '').trim());
          setOpenclawCliStatusAt(Date.now());
        } else {
          const text = [st?.message, st?.output].filter(Boolean).join('\n').trim();
          setOpenclawCliStatusText(text);
          setOpenclawCliStatusAt(Date.now());
        }
      }
    } catch (e: any) {
      if (!quiet) addLog(`读取 openclaw 状态失败: ${e?.message || 'unknown error'}`);
    } finally {
      setOpenclawCliStatusBusy(false);
    }

    try {
      if (window.api.openclawSessionStallStatus) {
        const stall = await window.api.openclawSessionStallStatus();
        setOverviewSessionStall(stall || null);
      }
    } catch {
      setOverviewSessionStall(null);
    }

    try {
      if (window.api.openclawLastLlmError) {
        const lastErr = await window.api.openclawLastLlmError();
        setOverviewLastLlmError(lastErr || null);
      }
    } catch {
      setOverviewLastLlmError(null);
    }
  };

  const refreshSecurityAudit = async (opts?: { deep?: boolean; quiet?: boolean }) => {
    if (!window.api?.openclawSecurityAudit) return '';
    const quiet = Boolean(opts?.quiet);
    if (securityAuditBusy) return securityAuditText || '';
    setSecurityAuditBusy(true);
    let nextText = '';
    try {
      const res = await window.api.openclawSecurityAudit({ deep: Boolean(opts?.deep) });
      if (res?.status === 'ok') {
        nextText = String(res.output || '').trim();
        setSecurityAuditText(nextText);
        setSecurityAuditAt(Date.now());
      } else {
        nextText = [res?.message, res?.output].filter(Boolean).join('\n').trim();
        setSecurityAuditText(nextText);
        setSecurityAuditAt(Date.now());
      }
    } catch (e: any) {
      if (!quiet) addLog(`security audit 失败: ${e?.message || 'unknown error'}`);
    } finally {
      setSecurityAuditBusy(false);
    }
    return nextText || '';
  };

  const runSecurityFixAll = async (opts?: { silent?: boolean }) => {
    if (!window.api) return;
    if (securityFixBusy) return;
    const silent = Boolean(opts?.silent);
    setSecurityFixBusy(true);
    if (!silent) showHeaderNotice('正在尝试修复安全问题', 'info', { busy: true });
    try {
      const cur = await window.api.getConfig();
      const raw = (cur?.status === 'ok' && cur.content ? cur.content : '').toString();
      if (!raw.trim()) return;
      const nextContent = applySecurityAuditFixesToConfig(raw);
      if (nextContent && nextContent !== raw) {
        await saveRawConfigAndRestart(nextContent);
      }
      if (window.api.openclawFixPermissions) {
        const perm = await window.api.openclawFixPermissions();
        if (perm?.status !== 'ok') {
          if (!silent) addLog(`权限修复失败: ${perm?.message || 'unknown error'}`);
        } else if (Array.isArray(perm?.items)) {
          const bad = perm.items.filter((it: any) => it?.status !== 'ok');
          if (!silent && bad.length) addLog(`权限修复部分失败: ${bad.map((x: any) => x?.target || '').filter(Boolean).join(', ')}`);
        }
      }
      await refreshSecurityAudit({ quiet: true });
      await refreshOverviewStatusPanels({ quiet: true });
      if (!silent) showHeaderNotice('修复已完成', 'success', { ttlMs: 2500 });
    } finally {
      setSecurityFixBusy(false);
    }
  };

  const saveConfig = async () => {
    if (!window.api) return;
    addLog('正在保存配置...');
    showHeaderNotice('智能体正在加载配置', 'info', { busy: true });
    const nextContent = applySettingsToConfig(configContent);
    setConfigContent(nextContent);
    const res = await window.api.saveConfig(nextContent);
    if (res.status === 'ok') {
      setConfigStatus('已保存');
      addLog('配置保存成功。');
      if (window.api.openclawRestart) {
        addLog('正在重启 智能体服务...');
        const rr = await window.api.openclawRestart();
        if (rr.status === 'ok') {
          showHeaderNotice('智能体服务 运行中', 'info', { busy: true });
          addLog('智能体服务重启完成。');
          if (rr.output) addLogBlock('智能体服务重启输出', rr.output);
          const ok = await waitForGatewayReady(30_000);
          if (ok) {
            setOpenClawStatus('已就绪');
            await initOpenClaw();
            showHeaderNotice('智能体已就绪', 'success', { ttlMs: 2500 });
          } else {
            showHeaderNotice('智能体启动超时', 'error', { ttlMs: 4000 });
          }
        } else {
          showHeaderNotice('智能体服务重启失败', 'error', { ttlMs: 4000 });
          addLog(`智能体服务重启失败: ${rr.message}`);
          if (rr.output) addLogBlock('智能体服务重启输出', rr.output);
        }
      }
      await checkEnvironment();
    } else {
      setConfigStatus('保存错误');
      showHeaderNotice('配置保存失败', 'error', { ttlMs: 4000 });
      addLog(`配置保存失败: ${res.message}`);
    }
  };

  const startOllamaService = async () => {
    if (!window.api?.startOllamaService) return;
    if (ollamaToggling) return;
    setOllamaToggling(true);
    addLog('AI 引擎：启动（launchctl load）...');
    try {
      const res = await window.api.startOllamaService();
      if (res.status === 'ok') {
        addLog('AI 引擎：启动命令已发送。');
        if (res.output) addLogBlock('AI 引擎启动输出', res.output);
      } else {
        addLog(`AI 引擎：启动失败: ${res.message || 'unknown error'}`);
        if ((res as any).output) addLogBlock('AI 引擎启动输出', (res as any).output);
      }
    } finally {
      setOllamaToggling(false);
      await checkEnvironment();
    }
  };

  const stopOllamaService = async () => {
    if (!window.api?.stopOllamaService) return;
    if (ollamaToggling) return;
    setOllamaToggling(true);
    addLog('AI 引擎：停止（launchctl unload）...');
    try {
      const res = await window.api.stopOllamaService();
      if (res.status === 'ok') {
        addLog('AI 引擎：停止命令已发送。');
        if (res.output) addLogBlock('AI 引擎停止输出', res.output);
      } else {
        addLog(`AI 引擎：停止失败: ${res.message || 'unknown error'}`);
        if ((res as any).output) addLogBlock('AI 引擎停止输出', (res as any).output);
      }
    } finally {
      setOllamaToggling(false);
      await checkEnvironment();
    }
  };

  const startGatewayService = async () => {
    if (!window.api?.startGatewayService) return;
    if (gatewayToggling) return;
    setGatewayToggling(true);
    addLog('智能体服务：启动（launchctl load）...');
    try {
      const res = await window.api.startGatewayService();
      if (res.status === 'ok') {
        addLog('智能体服务：启动命令已发送。');
        if (res.output) addLogBlock('智能体服务启动输出', res.output);
      } else {
        addLog(`智能体服务：启动失败: ${res.message || 'unknown error'}`);
        if ((res as any).output) addLogBlock('智能体服务启动输出', (res as any).output);
      }
    } finally {
      setGatewayToggling(false);
      await checkEnvironment();
      const ok = await waitForGatewayReady(2000);
      if (ok) await initOpenClaw();
    }
  };

  const stopGatewayService = async () => {
    if (!window.api?.stopGatewayService) return;
    if (gatewayToggling) return;
    setGatewayToggling(true);
    addLog('智能体服务：停止（launchctl unload）...');
    try {
      const res = await window.api.stopGatewayService();
      if (res.status === 'ok') {
        addLog('智能体服务：停止命令已发送。');
        if (res.output) addLogBlock('智能体服务停止输出', res.output);
      } else {
        addLog(`智能体服务：停止失败: ${res.message || 'unknown error'}`);
        if ((res as any).output) addLogBlock('智能体服务停止输出', (res as any).output);
      }
    } finally {
      setGatewayToggling(false);
      await checkEnvironment();
    }
  };

  const initOpenClaw = async () => {
    if (!window.api) return;
    const ok = await waitForGatewayReady(800);
    if (!ok) {
      addLog('AI 智能体：服务未就绪（网关不可用）');
      return;
    }
    const res = await window.api.getGatewayToken();
    if (res.status === 'ok' && res.token) {
      const t = encodeURIComponent(res.token);
      const nextUrl = `http://127.0.0.1:18789/?token=${t}`;
      setOpenClawUrl((cur) => {
        if (cur === nextUrl) return cur;
        return nextUrl;
      });
      addLog('获取 Token 成功，已注入 AI 智能体界面。');
    } else {
      addLog('获取 Token 失败，将使用默认 URL。');
    }
  };

  const refreshOpenclawModelsStatus = async (opts?: { quiet?: boolean }) => {
    if (!window.api?.openclawModelsStatus) return;
    const quiet = Boolean(opts?.quiet);
    try {
      const res = await window.api.openclawModelsStatus();
      const text = (res?.output || res?.message || '').toString();
      if (!quiet && text.trim()) addLogBlock('模型鉴权状态', text);
      if (res?.status !== 'ok') {
        if (!quiet) showHeaderNotice('模型鉴权状态读取失败', 'error', { ttlMs: 2500 });
        return;
      }
      if (text.includes('OAuth/token status') && text.includes('- none') && llmProviderId.trim() === 'qwen-portal') {
        if (!quiet) showHeaderNotice('Qwen Portal 未登录或令牌已过期', 'error', { ttlMs: 3500 });
      }
    } catch (e: any) {
      if (!quiet) showHeaderNotice(`模型鉴权状态异常: ${e?.message || 'unknown error'}`, 'error', { ttlMs: 3500 });
    }
  };

  const startQwenPortalOAuthLogin = async () => {
    if (!window.api?.startOpenclawAuthLogin) return;
    if (openclawAuthRunning) return;
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setOpenclawAuthRequestId(requestId);
    setOpenclawAuthRunning(true);
    showHeaderNotice('正在启动千问模型验证', 'info', { busy: true });
    addLog('启动 千问模型验证...');
    try {
      const res = await window.api.startOpenclawAuthLogin(requestId, 'qwen-portal');
      if (res?.status !== 'ok') {
        setOpenclawAuthRunning(false);
        setOpenclawAuthRequestId('');
        showHeaderNotice(`千问模型验证启动失败: ${res?.message || 'unknown error'}`, 'error', { ttlMs: 3500 });
        return;
      }
    } catch (e: any) {
      setOpenclawAuthRunning(false);
      setOpenclawAuthRequestId('');
      showHeaderNotice(`千问模型验证启动异常: ${e?.message || 'unknown error'}`, 'error', { ttlMs: 3500 });
    }
  };

  useEffect(() => {
    (async () => {
      await checkEnvironment({ quiet: true });
      await initOpenClaw();
      try {
        const res = await window.api?.getConfig?.();
        const raw = (res?.status === 'ok' && res.content ? res.content : '').toString();
        const broken = (() => {
          try {
            const cfg = JSON.parse(raw || '{}');
            const primary = (cfg?.agents?.defaults?.model?.primary ?? '').toString().trim();
            return !primary;
          } catch {
            return true;
          }
        })();
        if (broken && window.api?.openclawRepairConfig) {
          setSecurityAutoFixNote('检测到配置缺失关键字段，正在自动修复并重启...');
          await window.api.openclawRepairConfig();
        }
      } catch {}
      await loadConfig({ quiet: true });
      const text = await refreshSecurityAudit({ quiet: true });
      const sum = parseSecurityAuditSummary(text);
      if (!autoSecurityFixAttemptedRef.current && (sum.critical > 0 || sum.warn > 0)) {
        autoSecurityFixAttemptedRef.current = true;
        setSecurityAutoFixNote(`已检测到安全风险：${sum.critical} 个严重 · ${sum.warn} 个警告 · ${sum.info} 个提示，正在自动尝试修复...`);
        await runSecurityFixAll({ silent: true });
        const after = await refreshSecurityAudit({ quiet: true });
        const afterSum = parseSecurityAuditSummary(after);
        setSecurityAutoFixAt(Date.now());
        setSecurityAutoFixNote(`已自动尝试修复：${afterSum.critical} 个严重 · ${afterSum.warn} 个警告 · ${afterSum.info} 个提示`);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      checkEnvironment({ quiet: true });
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeTab === 'settings') {
      loadConfig();
    }
  }, [activeTab]);

  const saveBrandIconText = (value: string) => {
    const next = (value || '').trim().slice(0, 2) || '元';
    setBrandIconText(next);
    localStorage.setItem('brand_icon_text', next);
    addLog(`图标配置已更新：${next}`);
  };

  const installOffline = async () => {
    if (!window.api?.installOffline) return;
    if (offlineInstalling) return;
    setOfflineInstalling(true);
    addLog('开始一键部署（离线）...');
    showHeaderNotice('一键部署中', 'info', { busy: true });
    try {
      const res = await window.api.installOffline();
      if (res.status === 'ok') {
        addLog('一键部署完成。');
        showHeaderNotice('一键部署已完成', 'success', { ttlMs: 2500 });
        await checkEnvironment();
        const ok = await waitForGatewayReady(2000);
        if (ok) await initOpenClaw();
      } else {
        addLog(`一键部署失败: ${res.message || 'unknown error'}`);
        showHeaderNotice('一键部署失败', 'error', { ttlMs: 4000 });
      }
    } catch (e: any) {
      addLog(`一键部署异常: ${e?.message || 'unknown error'}`);
      showHeaderNotice('一键部署异常', 'error', { ttlMs: 4000 });
    } finally {
      setOfflineInstalling(false);
    }
  };

  const loadSkills = async () => {
    if (!window.api?.openclawSkillsList) return;
    if (skillsLoading) return;
    setSkillsLoading(true);
    try {
      const res = await window.api.openclawSkillsList();
      if (res?.status === 'ok') setSkillsData((res as any).data || null);
      else addLog(`技能列表加载失败: ${res?.message || 'unknown error'}`);
    } catch (e: any) {
      addLog(`技能列表加载异常: ${e?.message || 'unknown error'}`);
    } finally {
      setSkillsLoading(false);
    }
  };

  const setSkillEnabled = async (name: string, enabled: boolean) => {
    if (!window.api?.openclawSkillSetEnabled) return;
    try {
      showHeaderNotice(enabled ? '正在安装技能' : '正在卸载技能', 'info', { busy: true });
      const res = await window.api.openclawSkillSetEnabled(name, enabled);
      if (res?.status === 'ok') {
        showHeaderNotice(enabled ? '技能已安装' : '技能已卸载', 'success', { ttlMs: 2000 });
        await loadSkills();
      } else {
        showHeaderNotice(enabled ? '安装失败' : '卸载失败', 'error', { ttlMs: 3500 });
        addLog(`${enabled ? '安装' : '卸载'}失败: ${res?.message || 'unknown error'}`);
        if ((res as any)?.output) addLogBlock('智能体服务输出', String((res as any).output));
      }
    } catch (e: any) {
      showHeaderNotice(enabled ? '安装异常' : '卸载异常', 'error', { ttlMs: 3500 });
      addLog(`${enabled ? '安装' : '卸载'}异常: ${e?.message || 'unknown error'}`);
    }
  };

  useEffect(() => {
    if (settingsSection !== 'models') return;
    let cancelled = false;
    (async () => {
      if (!window.api?.getConfig) return;
      try {
        const res = await window.api.getConfig();
        if (cancelled) return;
        if (res?.status === 'ok' && res.content) {
          setConfigContent(res.content);
          readConfigToSettings(res.content);
          setConfigStatus('已加载');
        }
        refreshOllamaPs({ quiet: true }).catch(() => {});
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsSection]);

  useEffect(() => {
    if (settingsSection !== 'skills') return;
    loadSkills();
  }, [settingsSection]);

  const importLocalLlm = async () => {
    if (!window.api?.importLocalLlm) return;
    if (llmImporting) return;
    setLlmImporting(true);
    addLog('开始加载本地大模型（llm.gz）...');
    showHeaderNotice('加载本地大模型中', 'info', { busy: true });
    try {
      const res = await (window.api as any).importLocalLlm();
      if (res?.status === 'ok') {
        addLog('本地大模型加载完成。');
        showHeaderNotice('本地大模型已加载', 'success', { ttlMs: 2500 });
        await checkEnvironment();
      } else {
        addLog(`本地大模型加载失败: ${res?.message || 'unknown error'}`);
        showHeaderNotice('本地大模型加载失败', 'error', { ttlMs: 4000 });
      }
    } catch (e: any) {
      addLog(`本地大模型加载异常: ${e?.message || 'unknown error'}`);
      showHeaderNotice('本地大模型加载异常', 'error', { ttlMs: 4000 });
    } finally {
      setLlmImporting(false);
    }
  };

  return (
    <div className="container">
      <TopNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        theme={theme}
        onSetTheme={setTheme}
        brandIconText={brandIconText}
        headerNotice={headerNotice}
      />

      {authModal ? (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={() => closeAuthModal()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100%)',
              borderRadius: 16,
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
              boxShadow: 'var(--shadow)',
              padding: 16,
              color: 'var(--text)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{authModal.title}</div>
            {authModal.detail ? <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>{authModal.detail}</div> : null}
            {lastAuthUrl ? (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85, lineHeight: 1.5 }}>
                <div style={{ wordBreak: 'break-all' }}>{lastAuthUrl}</div>
                {lastAuthCode ? <div style={{ marginTop: 6 }}>授权码：{lastAuthCode}</div> : null}
              </div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              <button
                className="primary"
                onClick={() => {
                  if (!networkOnline) {
                    ensureOfflineFallbackToLocal();
                    return;
                  }
                  startQwenPortalOAuthLogin();
                }}
                disabled={openclawAuthRunning || offlineFallbackBusy}
              >
                {networkOnline ? (openclawAuthRunning ? '等待授权中...' : '一键登录') : offlineFallbackBusy ? '切换中...' : '切到本地模型'}
              </button>
              {lastAuthUrl ? (
                <button className="soft" onClick={() => window.open(lastAuthUrl, '_blank')} disabled={!networkOnline}>
                  打开授权页面
                </button>
              ) : null}
              {lastAuthUrl ? (
                <button className="soft" onClick={() => copyText(lastAuthUrl)}>
                  复制授权链接
                </button>
              ) : null}
              <button className="soft" onClick={() => ensureOfflineFallbackToLocal()} disabled={offlineFallbackBusy}>
                使用本地模型
              </button>
              <button className="soft" onClick={() => closeAuthModal()}>
                关闭
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, opacity: 0.85 }}>
                <input
                  type="checkbox"
                  checked={offlineFallbackEnabled}
                  onChange={(e) => setOfflineFallbackEnabled(e.target.checked)}
                />
                离线自动切换本地模型
              </label>
            </div>
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              网络: {networkOnline ? '可用' : '不可用'} · 智能体服务: {openClawStatus}
            </div>
          </div>
        </div>
      ) : null}

      {localHintModal ? (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={() => closeLocalHintModal()}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100%)',
              borderRadius: 16,
              border: '1px solid var(--border)',
              background: 'var(--bg-elev)',
              boxShadow: 'var(--shadow)',
              padding: 16,
              color: 'var(--text)',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{localHintModal.title}</div>
            {localHintModal.detail ? (
              <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{localHintModal.detail}</div>
            ) : null}
            <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
              {localHintModal.title === '本地模型未安装' ? (
                <>
                  <button
                    className="primary"
                    onClick={() => {
                      closeLocalHintModal();
                      setActiveTab('ollama');
                    }}
                  >
                    打开 AI 对话下载
                  </button>
                  <button
                    className="soft"
                    onClick={async () => {
                      const currentRef = (localHintModal.primaryRef || '').trim();
                      const currentId = currentRef.startsWith('ollama/') ? splitModelRef(currentRef).modelId : '';
                      const picked = pickFasterLocalModel(ollamaModels, currentId);
                      if (!picked || !window.api?.openclawSetLocalOllamaModel) return;
                      closeLocalHintModal();
                      showHeaderNotice('正在切换到已安装本地模型', 'info', { busy: true });
                      addLog(`切换到已安装本地模型：ollama/${picked}`);
                      try {
                        const res = await window.api.openclawSetLocalOllamaModel(picked);
                        if (res?.status === 'ok') {
                          showHeaderNotice('模型已切换', 'success', { ttlMs: 2200 });
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                          stopOtherRunningOllamaModels(picked).catch(() => {});
                          await loadConfig();
                        } else {
                          showHeaderNotice('切换失败', 'error', { ttlMs: 3500 });
                          addLog(`切换失败: ${res?.message || 'unknown error'}`);
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                        }
                      } catch (e: any) {
                        showHeaderNotice('切换异常', 'error', { ttlMs: 3500 });
                        addLog(`切换异常: ${e?.message || 'unknown error'}`);
                      }
                    }}
                  >
                    切到已安装本地模型
                  </button>
                  <button
                    className="soft"
                    onClick={async () => {
                      closeLocalHintModal();
                      await switchToCloudRef();
                    }}
                  >
                    切回云模型
                  </button>
                  <button
                    className="soft"
                    onClick={() => {
                      closeLocalHintModal();
                      setActiveTab('settings');
                      setSettingsSection('models');
                    }}
                  >
                    打开模型策略
                  </button>
                  <button className="soft" onClick={() => closeLocalHintModal()}>
                    关闭
                  </button>
                </>
              ) : null}
              {localHintModal.title !== '本地模型未安装' ? (
                <>
                  <button
                    className="primary"
                    onClick={async () => {
                      const ref = (localHintModal.primaryRef || '').trim();
                      const modelId = ref.startsWith('ollama/') ? splitModelRef(ref).modelId : '';
                      if (!modelId || !window.api?.openclawSetLocalOllamaModel) return;
                      closeLocalHintModal();
                      showHeaderNotice('正在修复并重启', 'info', { busy: true });
                      addLog(`修复本地模型配置并重启：${modelId}`);
                      try {
                        const res = await window.api.openclawSetLocalOllamaModel(modelId);
                        if (res?.status === 'ok') {
                          showHeaderNotice('已重启', 'success', { ttlMs: 2200 });
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                          stopOtherRunningOllamaModels(modelId).catch(() => {});
                          await loadConfig();
                        } else {
                          showHeaderNotice('修复失败', 'error', { ttlMs: 3500 });
                          addLog(`修复失败: ${res?.message || 'unknown error'}`);
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                        }
                      } catch (e: any) {
                        showHeaderNotice('修复异常', 'error', { ttlMs: 3500 });
                        addLog(`修复异常: ${e?.message || 'unknown error'}`);
                      }
                    }}
                  >
                    修复并重启
                  </button>
                  <button
                    className="soft"
                    onClick={async () => {
                      const ref = (localHintModal.primaryRef || '').trim();
                      const currentId = ref.startsWith('ollama/') ? splitModelRef(ref).modelId : '';
                      const picked = pickFasterLocalModel(ollamaModels, currentId);
                      if (!picked || !window.api?.openclawSetLocalOllamaModel) return;
                      closeLocalHintModal();
                      showHeaderNotice('正在切换到更快本地模型', 'info', { busy: true });
                      addLog(`切换到更快本地模型：ollama/${picked}`);
                      try {
                        const res = await window.api.openclawSetLocalOllamaModel(picked);
                        if (res?.status === 'ok') {
                          showHeaderNotice('模型已切换', 'success', { ttlMs: 2200 });
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                          stopOtherRunningOllamaModels(picked).catch(() => {});
                          await loadConfig();
                        } else {
                          showHeaderNotice('切换失败', 'error', { ttlMs: 3500 });
                          addLog(`切换失败: ${res?.message || 'unknown error'}`);
                          if (res?.output) addLogBlock('OpenClaw 输出', String(res.output));
                        }
                      } catch (e: any) {
                        showHeaderNotice('切换异常', 'error', { ttlMs: 3500 });
                        addLog(`切换异常: ${e?.message || 'unknown error'}`);
                      }
                    }}
                  >
                    切到更快本地模型
                  </button>
                  <button
                    className="soft"
                    onClick={async () => {
                      closeLocalHintModal();
                      await switchToCloudRef();
                    }}
                  >
                    切回云模型
                  </button>
                  <button
                    className="soft"
                    onClick={() => {
                      closeLocalHintModal();
                      setActiveTab('settings');
                      setSettingsSection('models');
                    }}
                  >
                    打开模型策略
                  </button>
                  <button className="soft" onClick={() => closeLocalHintModal()}>
                    继续等待
                  </button>
                </>
              ) : null}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              网络: {networkOnline ? '可用' : '不可用'} · 智能体服务: {openClawStatus}
            </div>
          </div>
        </div>
      ) : null}
      
      {/* 1. Ollama Chat (Home) */}
      {activeTab === 'ollama' && (
        <div className="content-pane full-height">
          <OllamaWebUI />
        </div>
      )}

      {/* 2. OpenClaw Interface */}
      {activeTab === 'openclaw' && (
        <div className="content-pane full-height">
          {openClawStatus === '已就绪' ? (
            <webview
              key="openclaw"
              ref={openclawWebviewRef}
              src={openClawUrl}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allowpopups={true}
            />
          ) : (
            <div className="empty-state">
              <div>服务未就绪</div>
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>智能体网关 127.0.0.1:18789 未可用</div>
            </div>
          )}
        </div>
      )}

      {/* 3. Settings (Status + Config) */}
      {activeTab === 'settings' && (
        <div className="content-pane">
          <div className="settings-shell">
            <div className="settings-nav" aria-label="设置分类">
              <button className={settingsSection === 'overview' ? 'active' : ''} onClick={() => setSettingsSection('overview')}>
                概览
              </button>
              <button className={settingsSection === 'bootstrap' ? 'active' : ''} onClick={() => setSettingsSection('bootstrap')}>
                一键部署
              </button>
              <button className={settingsSection === 'channels' ? 'active' : ''} onClick={() => setSettingsSection('channels')}>
                通知渠道
              </button>
              <button className={settingsSection === 'llm' ? 'active' : ''} onClick={() => setSettingsSection('llm')}>
                LLM 提供商
              </button>
              <button className={settingsSection === 'models' ? 'active' : ''} onClick={() => setSettingsSection('models')}>
                模型策略
              </button>
              <button className={settingsSection === 'skills' ? 'active' : ''} onClick={() => setSettingsSection('skills')}>
                技能
              </button>
              <button className={settingsSection === 'appearance' ? 'active' : ''} onClick={() => setSettingsSection('appearance')}>
                外观
              </button>
              <button className={settingsSection === 'advanced' ? 'active' : ''} onClick={() => setSettingsSection('advanced')}>
                高级
              </button>
              <div className="settings-nav-footer">
                <button className="soft" onClick={() => checkEnvironment()}>刷新状态</button>
              </div>
            </div>

            <div className="settings-main">
              <div className="settings-topbar">
                <div className="settings-title">
                  {settingsSection === 'overview' && '概览'}
                  {settingsSection === 'bootstrap' && '一键部署'}
                  {settingsSection === 'channels' && '通知渠道'}
                  {settingsSection === 'llm' && 'LLM 提供商'}
                  {settingsSection === 'models' && '模型策略'}
                  {settingsSection === 'skills' && '技能'}
                  {settingsSection === 'appearance' && '外观'}
                  {settingsSection === 'advanced' && '高级'}
                </div>
                {settingsSection !== 'overview' ? (
                  <div className="settings-actions">
                    <span className="settings-status">状态: {configStatus || '—'}</span>
                    <button className="soft" onClick={() => void loadConfig()}>
                      重新加载
                    </button>
                    <button className="primary" onClick={saveConfig}>
                      保存配置
                    </button>
                  </div>
                ) : null}
              </div>

              {settingsSection === 'overview' && (
                <div className="settings-stack">
                  <div className="card">
                    <div className="settings-kpis">
                      <div className="kpi">
                        <div className="kpi-label">AI 引擎</div>
                        <div className={`kpi-value ${ollamaStatus === '已连接' ? 'success' : 'error'}`}>{ollamaStatus}</div>
                        <div className="kpi-sub">可用模型: {ollamaModels.length}</div>
                        <div className="kpi-actions">
                          <button
                            className={`${ollamaStatus === '已连接' ? 'danger' : 'soft'} icon-toggle`}
                            title={ollamaStatus === '已连接' ? '停止服务' : '启动服务'}
                            onClick={ollamaStatus === '已连接' ? stopOllamaService : startOllamaService}
                            disabled={ollamaToggling}
                          >
                            {ollamaStatus === '已连接' ? <IconStop /> : <IconPlay />}
                          </button>
                        </div>
                      </div>
                      <div className="kpi">
                        <div className="kpi-label">智能体服务</div>
                        <div
                          className={`kpi-value ${
                            openClawStatus === '已就绪' ? 'success' : 'error'
                          }`}
                        >
                          {openClawStatus}
                        </div>
                        <div className="kpi-sub">网关: 127.0.0.1:18789</div>
                        <div className="kpi-actions">
                          <button
                            className={`${openClawStatus === '已就绪' ? 'danger' : 'soft'} icon-toggle`}
                            title={openClawStatus === '已就绪' ? '停止服务' : '启动服务'}
                            onClick={openClawStatus === '已就绪' ? stopGatewayService : startGatewayService}
                            disabled={gatewayToggling}
                          >
                            {openClawStatus === '已就绪' ? <IconStop /> : <IconPlay />}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <div className="status-card-header">
                      <h3 style={{ margin: 0 }}>运行状态</h3>
                      <div className="status-actions">
                        <button className="soft" disabled={openclawCliStatusBusy} onClick={() => void refreshOverviewStatusPanels()}>
                          {openclawCliStatusBusy ? '刷新中...' : '刷新状态'}
                        </button>
                        <button className="soft" disabled={securityAuditBusy} onClick={() => void refreshSecurityAudit({ deep: false })}>
                          {securityAuditBusy ? '审计中...' : '重新审计'}
                        </button>
                      </div>
                    </div>

                    <div className="status-grid">
                      <div className="status-panel">
                        <div className="status-panel-title">智能体服务</div>
                        <div className="status-kv">
                          <div className="k">服务状态</div>
                          <div className={`v ${openClawStatus === '已就绪' ? 'success' : 'error'}`}>{openClawStatus}</div>
                        </div>
                        <div className="status-kv">
                          <div className="k">网关</div>
                          <div className="v">127.0.0.1:18789</div>
                        </div>
                        <div className="status-kv">
                          <div className="k">网络</div>
                          <div className="v">{networkOnline ? '可用' : '不可用'}</div>
                        </div>
                        <details className="status-details">
                          <summary>
                            智能体 状态详情
                            <span className="muted">
                              {openclawCliStatusAt ? `（${formatClock(openclawCliStatusAt)}）` : ''}
                            </span>
                          </summary>
                          {(() => {
                            const parseTitles = ['Overview', 'Sessions', 'Channels', 'Security audit'];
                            const titleLabel: Record<string, string> = {
                              Overview: '概览',
                              Sessions: '会话',
                              Channels: '渠道',
                              'Security audit': '安全审计',
                            };
                            const blocks = splitTitledBlocks(openclawCliStatusText, parseTitles);
                            const parts = parseTitles
                              .map((t) => {
                                const body = (blocks[t] || '').trim();
                                if (!body) return '';
                                return `${titleLabel[t] || t}\n${body}`;
                              })
                              .filter(Boolean)
                              .join('\n\n');
                            const payload = (parts || openclawCliStatusText || '').trim();
                            return <pre className="config-editor status-pre">{payload || '—'}</pre>;
                          })()}
                        </details>
                      </div>

                      <div className="status-panel">
                        <div className="status-panel-title">会话</div>
                        {(() => {
                          const stall = overviewSessionStall;
                          const lastErr = overviewLastLlmError;
                          const stallOk = stall?.status === 'ok' && stall?.found;
                          const errOk = lastErr?.status === 'ok' && lastErr?.found;
                          const pending = Boolean(stallOk && stall?.pending);
                          const ageMs = typeof stall?.ageMs === 'number' ? stall.ageMs : null;
                          const ageSec = typeof ageMs === 'number' ? Math.round(ageMs / 1000) : null;
                          const primary = (openclawPrimaryRef || '').trim();
                          return (
                            <>
                              <div className="status-kv">
                                <div className="k">主模型</div>
                                <div className="v">{primary || '—'}</div>
                              </div>
                              <div className="status-kv">
                                <div className="k">当前状态</div>
                                <div className="v">
                                  <span className={`badge ${pending ? 'warn' : 'info'}`}>{pending ? '等待回复' : '正常'}</span>
                                  {pending && typeof ageSec === 'number' ? <span className="muted"> {ageSec}s</span> : null}
                                </div>
                              </div>
                              <div className="status-kv">
                                <div className="k">最近错误</div>
                                <div className="v">{errOk ? (lastErr?.errorMessage || '—') : '—'}</div>
                              </div>
                              <div className="status-kv">
                                <div className="k">会话文件</div>
                                <div className="v">{stallOk ? (stall?.sessionFile || '—') : '—'}</div>
                              </div>
                            </>
                          );
                        })()}
                      </div>

                      <div className="status-panel">
                        <div className="status-panel-title">通知渠道</div>
                        <div className="status-kv">
                          <div className="k">Telegram</div>
                          <div className="v">
                            <span className={`badge ${telegramEnabled ? 'ok' : 'info'}`}>{telegramEnabled ? '已开启' : '未开启'}</span>
                          </div>
                        </div>
                        <div className="status-kv">
                          <div className="k">飞书</div>
                          <div className="v">
                            <span className={`badge ${feishuEnabled ? 'ok' : 'info'}`}>{feishuEnabled ? '已开启' : '未开启'}</span>
                          </div>
                        </div>
                      </div>

                      <div className="status-panel">
                        <div className="status-panel-title">安全审计</div>
                        {securityAutoFixNote ? <div className="status-note">{securityAutoFixNote}</div> : null}
                        {(() => {
                          const sum = parseSecurityAuditSummary(securityAuditText);
                          const items = parseSecurityAuditFindings(securityAuditText);
                          return (
                            <>
                              <div className="status-summary">
                                <span className="badge critical">严重 {sum.critical}</span>
                                <span className="badge warn">警告 {sum.warn}</span>
                                <span className="badge info">提示 {sum.info}</span>
                                <span className="muted">
                                  {securityAuditAt ? `更新时间 ${formatClock(securityAuditAt)}` : ''}
                                  {securityAutoFixAt ? ` · 自动修复 ${formatClock(securityAutoFixAt)}` : ''}
                                </span>
                              </div>
                              <div className="audit-list">
                                {(items.length ? items : [])
                                  .slice(0, 8)
                                  .map((it, idx) => (
                                    <div key={idx} className={`audit-item ${it.level}`}>
                                      <div className="audit-head">
                                        <span className={`badge ${it.level}`}>{it.level === 'critical' ? '严重' : it.level === 'warn' ? '警告' : '提示'}</span>
                                        <div className="audit-title">{it.title}</div>
                                      </div>
                                      {it.fix ? <div className="audit-fix">修复：{it.fix}</div> : null}
                                    </div>
                                  ))}
                                {!items.length ? <div className="muted">—</div> : null}
                              </div>
                              <details className="status-details">
                                <summary>查看完整报告</summary>
                                <pre className="config-editor status-pre">{(securityAuditText || '').trim() ? securityAuditText : '—'}</pre>
                              </details>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="card logs">
                    <div className="settings-inline-actions" style={{ justifyContent: 'space-between' }}>
                      <h3 style={{ margin: 0 }}>日志</h3>
                    </div>
                    <pre>{logs.map((l, i) => <div key={i}>{l}</div>)}</pre>
                  </div>
                </div>
              )}

              {settingsSection === 'bootstrap' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>离线部署并启动</h3>
                    <div className="settings-inline-actions">
                      <button
                        className={Date.now() < deployArmedUntil ? 'danger' : 'primary'}
                        onClick={async () => {
                          const now = Date.now();
                          if (offlineInstalling) return;
                          if (now < deployArmedUntil) {
                            setDeployArmedUntil(0);
                            await installOffline();
                            return;
                          }
                          setDeployArmedUntil(now + 8000);
                          addLog('一键部署：将执行离线部署，请在 8 秒内再次点击确认。');
                        }}
                        disabled={offlineInstalling}
                      >
                        {offlineInstalling ? '正在部署/启动...' : Date.now() < deployArmedUntil ? '再次确认部署' : '开始部署'}
                      </button>
                      <button
                        className="soft"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
                        onClick={importLocalLlm}
                        disabled={offlineInstalling || llmImporting}
                        title="桌面放置 llm.gz 后点击加载"
                      >
                        <IconDownload />
                        加载大模型
                      </button>
                      <button className="soft" onClick={() => checkEnvironment()}>刷新状态</button>
                    </div>
                    <div className="tool-hint">llm.gz 本地大模型压缩包放置于桌面，点击“加载大模型”会自动加载本地大模型</div>
                  </div>
                </div>
              )}

              {settingsSection === 'channels' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>Telegram</h3>
                    <div className="field-grid">
                      <label className="field">
                        <div className="label">启用</div>
                        <select
                          className="select"
                          value={telegramEnabled ? '1' : '0'}
                          onChange={(e) => setTelegramEnabled(e.target.value === '1')}
                        >
                          <option value="0">关闭</option>
                          <option value="1">开启</option>
                        </select>
                      </label>
                      <label className="field">
                        <div className="label">Bot Token</div>
                        <input
                          value={telegramBotToken}
                          onChange={(e) => setTelegramBotToken(e.target.value)}
                          placeholder="123456789:AA..."
                          spellCheck={false}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="card">
                    <h3>飞书（Feishu/Lark）</h3>
                    <div className="field-grid">
                      <label className="field">
                        <div className="label">启用</div>
                        <select
                          className="select"
                          value={feishuEnabled ? '1' : '0'}
                          onChange={(e) => setFeishuEnabled(e.target.value === '1')}
                        >
                          <option value="0">关闭</option>
                          <option value="1">开启</option>
                        </select>
                      </label>
                      <label className="field">
                        <div className="label">appId</div>
                        <input value={feishuAppId} onChange={(e) => setFeishuAppId(e.target.value)} spellCheck={false} />
                      </label>
                      <label className="field">
                        <div className="label">appSecret</div>
                        <input
                          type="password"
                          value={feishuAppSecret}
                          onChange={(e) => setFeishuAppSecret(e.target.value)}
                          spellCheck={false}
                          autoComplete="new-password"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {settingsSection === 'llm' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>LLM 提供商（OpenAI 兼容 API）</h3>
                    <div className="field-grid llm-grid">
                      <label className="field">
                        <div className="label">LLM 提供商（ID）</div>
                        <input list="llm-provider-ids" value={llmProviderId} onChange={(e) => setLlmProviderId(e.target.value)} spellCheck={false} />
                        <datalist id="llm-provider-ids">
                          {Array.from(new Set(getLlmEntriesFromConfigText(configContent).map((e) => e.providerId)))
                            .filter((v) => v && v !== 'qwen-portal')
                            .map((v) => (
                              <option key={v} value={v} />
                            ))}
                        </datalist>
                      </label>
                      <label className="field">
                        <div className="label">API 地址</div>
                        <input value={llmBaseUrl} onChange={(e) => setLlmBaseUrl(e.target.value)} spellCheck={false} />
                      </label>
                      <label className="field">
                        <div className="label">API 密钥</div>
                        <input type="password" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} autoComplete="new-password" spellCheck={false} />
                      </label>
                      <label className="field">
                        <div className="label">模型名称</div>
                        <input value={llmModelId} onChange={(e) => setLlmModelId(e.target.value)} spellCheck={false} />
                      </label>
                    </div>
                    <div className="settings-inline-actions">
                      <button
                        className="primary"
                        onClick={async () => {
                          const providerId = sanitizeInlineCode(llmProviderId);
                          const baseUrl = sanitizeInlineCode(llmBaseUrl);
                          const apiKey = sanitizeInlineCode(llmApiKey);
                          const modelId = sanitizeInlineCode(llmModelId);
                          if (!providerId || !baseUrl || !modelId) {
                            showHeaderNotice('请补齐 提供商/API地址/模型名称', 'error', { ttlMs: 3500 });
                            return;
                          }
                          const nextContent = updateConfigWithLlmEntry(configContent, { providerId, baseUrl, apiKey, modelId });
                          await saveRawConfigAndRestart(nextContent);
                        }}
                      >
                        保存并重启
                      </button>
                      <button
                        className="soft"
                        onClick={() => {
                          setLlmProviderId('openai');
                          setLlmBaseUrl('https://api.openai.com/v1');
                          setLlmApiKey('');
                          setLlmModelId('gpt-4o-mini');
                        }}
                      >
                        重置
                      </button>
                    </div>
                    <div className="tool-hint">已配置模型（可编辑/删除；删除后会自动保存并重启）</div>
                    <div className="model-list">
                      <ul>
                        {getLlmEntriesFromConfigText(configContent).map((e) => (
                          <li key={`${e.providerId}/${e.modelId}`}>
                            <span style={{ marginRight: 10 }}>{e.providerId}/{e.modelId}</span>
                            <span style={{ opacity: 0.75, marginRight: 10 }}>{e.baseUrl || '—'}</span>
                            <button
                              className="soft"
                              style={{ padding: '6px 10px', marginRight: 6 }}
                              onClick={() => {
                                setLlmProviderId(e.providerId);
                                setLlmModelId(e.modelId);
                                try {
                                  const cfg = JSON.parse(configContent || '{}');
                                  const pc = cfg?.models?.providers?.[e.providerId] ?? {};
                                  const baseUrl = (pc?.baseUrl || '').toString();
                                  const apiKey = (pc?.apiKey || '').toString();
                                  if (baseUrl) setLlmBaseUrl(baseUrl);
                                  if (apiKey) setLlmApiKey(apiKey);
                                } catch {}
                              }}
                            >
                              编辑
                            </button>
                            <button
                              className="danger"
                              style={{ padding: '6px 10px' }}
                              onClick={async () => {
                                const nextContent = removeConfigLlmEntry(configContent, { providerId: e.providerId, modelId: e.modelId });
                                await saveRawConfigAndRestart(nextContent);
                              }}
                            >
                              删除
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="tool-hint">千问模型：用于写入 OAuth 授权凭据（可用于切换账号）。</div>
                    <div className="settings-inline-actions">
                      <button className="primary" onClick={startQwenPortalOAuthLogin} disabled={openclawAuthRunning}>
                        {openclawAuthRunning ? '等待授权中...' : '千问模型验证'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {settingsSection === 'models' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>模型策略</h3>
                    <div className="tool-hint">主模型会写入 agents.defaults.model.primary；保存配置会自动重启 gateway。</div>
                    <div className="field-grid llm-grid">
                      <label className="field">
                        <div className="label">从已配置模型选择</div>
                        <select
                          className="select"
                          value={openclawPendingRef}
                          onChange={(e) => applyPrimaryRefSelection(e.target.value)}
                          disabled={modelActionBusy}
                        >
                          {getModelRefOptionsFromConfigText(configContent, { localOllamaModels: ollamaModels }).map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="field-grid llm-grid">
                      <label className="field">
                        <div className="label">当前主模型（ref）</div>
                        <input
                          value={openclawPendingRef}
                          onChange={(e) => setOpenclawPendingRef(e.target.value)}
                          placeholder="qwen-portal/coder-model 或 ollama/qwen2.5:7b"
                          spellCheck={false}
                        />
                      </label>
                      <div className="settings-inline-actions" style={{ alignItems: 'end' }}>
                        <button className="primary" onClick={switchOpenclawPrimaryRef} disabled={modelActionBusy}>
                          {modelActionBusy ? '切换中...' : '立即切换'}
                        </button>
                      </div>
                    </div>

                    <div className="field-grid llm-grid">
                      <label className="field">
                        <div className="label">本地 Ollama 模型（备用）</div>
                        <select
                          className="select"
                          value={openclawLocalModelPick}
                          onChange={(e) => setOpenclawLocalModelPick(e.target.value)}
                          disabled={modelActionBusy}
                        >
                          {ollamaModels
                            .filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'))
                            .map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                        </select>
                      </label>
                    </div>

                    <div className="field-grid llm-grid">
                      <label className="field" style={{ gridColumn: '1 / -1' }}>
                        <div className="label">回退模型（fallbacks）</div>
                        <textarea
                          className="config-editor"
                          style={{ minHeight: 120 }}
                          value={openclawFallbackDraft}
                          onChange={(e) => setOpenclawFallbackDraft(e.target.value)}
                          placeholder={`每行一个，例如：\nqwen-portal/coder-model\nollama/qwen2.5:7b`}
                          spellCheck={false}
                        />
                      </label>
                    </div>
                    <div className="settings-inline-actions">
                      <button
                        className="primary"
                        disabled={modelActionBusy}
                        onClick={async () => {
                          const localModels = ollamaModels.filter((m) => m && !m.includes(':cloud') && !m.includes('-cloud'));
                          const fallbacks = normalizeFallbackRefsForSave(openclawFallbackDraft, {
                            localModels,
                            preferredLocal: openclawLocalModelPick,
                          });
                          if (fallbacks.some((r) => !r.includes('/'))) {
                            showHeaderNotice('fallbacks 需使用 provider/model 格式', 'error', { ttlMs: 3500 });
                            return;
                          }
                          const nextContent = updateConfigWithModelFallbacks(configContent, {
                            fallbacks,
                            preferredLocalModel: openclawLocalModelPick,
                          });
                          setOpenclawFallbackDraft(fallbacks.join('\n'));
                          await saveRawConfigAndRestart(nextContent);
                        }}
                      >
                        保存备用策略
                      </button>
                      <button
                        className="soft"
                        disabled={modelActionBusy}
                        onClick={() => setOpenclawFallbackDraft(getFallbackDraftFromConfigText(configContent))}
                      >
                        从配置刷新
                      </button>
                    </div>

                    <div className="tool-hint">
                      {openclawPrimaryRef ? `当前：${openclawPrimaryRef}` : ''}
                    </div>

                    <div style={{ marginTop: 10 }}>
                      <div className="tool-hint">本地运行模型</div>
                      <div className="settings-inline-actions">
                        <button className="soft" onClick={() => refreshOllamaPs()} disabled={modelActionBusy}>
                          刷新
                        </button>
                        <button
                          className="soft"
                          onClick={() => {
                            const ref = (openclawPrimaryRef || '').trim();
                            const modelId = ref.startsWith('ollama/') ? splitModelRef(ref).modelId : '';
                            if (!modelId) return;
                            stopOtherRunningOllamaModels(modelId).catch(() => {});
                          }}
                          disabled={modelActionBusy || !(openclawPrimaryRef || '').trim().startsWith('ollama/')}
                        >
                          停止其它模型
                        </button>
                      </div>
                      <pre className="config-editor" style={{ minHeight: 90, whiteSpace: 'pre-wrap' }}>
                        {(ollamaPsText || '').trim() ? ollamaPsText : '—'}
                      </pre>
                    </div>
                  </div>
                </div>
              )}

              {settingsSection === 'skills' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>技能</h3>
                    <div className="field-grid llm-grid">
                      <label className="field">
                        <div className="label">搜索</div>
                        <input value={skillsQuery} onChange={(e) => setSkillsQuery(e.target.value)} placeholder="输入技能名称或描述关键词" spellCheck={false} />
                      </label>
                    </div>
                    <div className="settings-inline-actions">
                      <button className="soft" onClick={loadSkills} disabled={skillsLoading}>
                        {skillsLoading ? '加载中...' : '刷新技能'}
                      </button>
                    </div>
                    <div className="tool-hint">
                      {skillsData?.skills?.length ? `本地可用技能：${skillsData.skills.length}` : '本地可用技能：—'}
                      {skillsData?.managedSkillsDir ? ` · 托管目录：${skillsData.managedSkillsDir}` : ''}
                      {skillsData?.workspaceDir ? ` · 工作区：${skillsData.workspaceDir}` : ''}
                    </div>
                    <div className="model-list" style={{ marginTop: 10 }}>
                      <ul>
                        {(Array.isArray(skillsData?.skills) ? skillsData.skills : [])
                          .filter((s: any) => {
                            const q = skillsQuery.trim().toLowerCase();
                            if (!q) return true;
                            const name = (s?.name || '').toString().toLowerCase();
                            const desc = (s?.description || '').toString().toLowerCase();
                            return name.includes(q) || desc.includes(q);
                          })
                          .map((s: any) => {
                            const name = (s?.name || '').toString();
                            const desc = (s?.description || '').toString();
                            const eligible = Boolean(s?.eligible);
                            const disabled = Boolean(s?.disabled);
                            const actionLabel = disabled ? '安装' : '卸载';
                            const actionClass = disabled ? 'primary' : 'danger';
                            return (
                              <li key={name} style={{ display: 'block' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 650, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                      <span>{name}</span>
                                      <span style={{ fontSize: 12, opacity: 0.75 }}>
                                        {eligible ? '可用' : '不可用'} · {disabled ? '未安装' : '已安装'}
                                      </span>
                                    </div>
                                    {desc ? <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, lineHeight: 1.45 }}>{desc}</div> : null}
                                  </div>
                                  <div style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
                                    <button
                                      className={actionClass}
                                      style={{ padding: '6px 12px' }}
                                      onClick={() => setSkillEnabled(name, disabled)}
                                      disabled={skillsLoading}
                                    >
                                      {actionLabel}
                                    </button>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {settingsSection === 'appearance' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>图标配置</h3>
                    <div className="settings-inline-actions">
                      <input
                        className="mini-input"
                        value={brandIconText}
                        onChange={(e) => setBrandIconText(e.target.value)}
                        placeholder="元"
                        spellCheck={false}
                      />
                      <button className="soft" onClick={() => saveBrandIconText(brandIconText)}>保存图标</button>
                    </div>
                    <div className="tool-hint">支持 1-2 个字，默认显示「元」</div>
                  </div>
                </div>
              )}

              {settingsSection === 'advanced' && (
                <div className="settings-stack">
                  <div className="card">
                    <h3>openclaw.json</h3>
                    <textarea
                      aria-label="智能体配置"
                      className="config-editor"
                      value={configContent}
                      onChange={(e) => setConfigContent(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Add TypeScript definition for webview tag
declare global {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { src?: string, allowpopups?: boolean };
    }
  }
}

export default App;
