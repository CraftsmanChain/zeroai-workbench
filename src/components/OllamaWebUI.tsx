import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import '../Chat.css';
import '../OllamaWebUI.css';
import { downloadableChatModels, downloadableImageModels } from '../modelCatalog';

type ChatRole = 'user' | 'assistant' | 'system';

type ChatMessage = {
  role: ChatRole;
  content: string;
  thinking?: string;
  model?: string;
};

type ChatSession = {
  id: string;
  title: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};

const storageKey = 'ollama_chats_v1';

function safeParseSessions(raw: string | null): ChatSession[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed
      .map((s: any) => {
        if (!s || typeof s !== 'object') return null;
        const id = typeof s.id === 'string' ? s.id : null;
        const title = typeof s.title === 'string' ? s.title : '新对话';
        const model = typeof s.model === 'string' ? s.model : '';
        const createdAt = typeof s.createdAt === 'number' ? s.createdAt : Date.now();
        const updatedAt = typeof s.updatedAt === 'number' ? s.updatedAt : Date.now();
        const messages = Array.isArray(s.messages)
          ? s.messages
              .map((m: any) => {
                if (!m || typeof m !== 'object') return null;
                const role = m.role === 'user' || m.role === 'assistant' || m.role === 'system' ? m.role : null;
                const content = typeof m.content === 'string' ? m.content : null;
                if (!role || content === null) return null;
                const thinking = typeof m.thinking === 'string' ? m.thinking : undefined;
                const model = typeof m.model === 'string' ? m.model : undefined;
                return { role, content, thinking, model } as ChatMessage;
              })
              .filter(Boolean)
          : [];
        if (!id) return null;
        return { id, title, model, messages, createdAt, updatedAt } as ChatSession;
      })
      .filter((s): s is ChatSession => Boolean(s))) as ChatSession[];
  } catch {
    return [];
  }
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeTitleFromFirstUserMessage(messages: ChatMessage[]) {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!firstUser) return '新对话';
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 28) || '新对话';
}

const localImageBaseAllowlist = ['x/z-image-turbo', 'x/flux2-klein'] as const;

function baseModelName(name: string) {
  const idx = name.indexOf(':');
  return idx === -1 ? name : name.slice(0, idx);
}

function isCloudModelName(name: string) {
  if (!name) return false;
  return name.endsWith(':cloud') || name.includes('-cloud');
}

function isImageModelName(name: string) {
  const base = baseModelName(name);
  if (localImageBaseAllowlist.includes(base as any)) return true;
  return base.startsWith('x/');
}

function isDownloadableModelName(name: string) {
  if (!name) return false;
  if (downloadableChatModels.includes(name as any)) return true;
  if (downloadableImageModels.includes(name as any)) return true;
  return false;
}

function modelBParam(name: string) {
  const m = (name || '').match(/:(\d+)\s*b\b/i);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function isLikelyVeryLargeChatModel(name: string) {
  const b = modelBParam(name);
  if (b !== null) return b >= 30;
  return /qwen3-coder:30b/i.test(name);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const digits = i === 0 ? 0 : i === 1 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

export default function OllamaWebUI() {
  const [chats, setChats] = useState<ChatSession[]>(() => safeParseSessions(localStorage.getItem(storageKey)));
  const [activeChatId, setActiveChatId] = useState<string>(() => {
    const initial = safeParseSessions(localStorage.getItem(storageKey));
    return initial[0]?.id || '';
  });
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [localModelsLoaded, setLocalModelsLoaded] = useState(false);
  const [modelQuery, setModelQuery] = useState('');
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [pullState, setPullState] = useState<{
    requestId: string;
    model: string;
    status?: string;
    total?: number;
    completed?: number;
    error?: string;
    speedBps?: number;
    updatedAt?: number;
  } | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [imageTerminalNotice, setImageTerminalNotice] = useState<string>('');
  const [engineReady, setEngineReady] = useState(false);
  const [engineHint, setEngineHint] = useState<string>('服务未就绪');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const activeRequestRef = useRef<{ requestId: string; chatId: string } | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const lastLocalModelRef = useRef<string>('');
  const modelBeforePullRef = useRef<string>('');
  const lastImageTerminalModelRef = useRef<string>('');
  const imageTerminalOpeningRef = useRef<{ model: string; startedAt: number } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeRequestMetaRef = useRef<{ requestId: string; model: string; chatId: string; gotAnyData: boolean } | null>(null);
  const firstTokenWarnTimerRef = useRef<number | null>(null);
  const hardNoResponseTimerRef = useRef<number | null>(null);

  const clearGenerationTimers = () => {
    if (firstTokenWarnTimerRef.current) window.clearTimeout(firstTokenWarnTimerRef.current);
    if (hardNoResponseTimerRef.current) window.clearTimeout(hardNoResponseTimerRef.current);
    firstTokenWarnTimerRef.current = null;
    hardNoResponseTimerRef.current = null;
  };

  const activeChat = useMemo(() => chats.find((c) => c.id === activeChatId) || null, [chats, activeChatId]);
  const installedNameSet = useMemo(() => {
    return new Set(localModels);
  }, [localModels]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight || '') || 24;
    const paddingTop = Number.parseFloat(style.paddingTop || '') || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom || '') || 0;
    const maxHeight = lineHeight * 8 + paddingTop + paddingBottom;

    el.style.maxHeight = `${maxHeight}px`;
    el.style.height = 'auto';
    const next = Math.max(lineHeight + paddingTop + paddingBottom, Math.min(el.scrollHeight, maxHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [input]);

  useEffect(() => {
    if (chats.length === 0) {
      const now = Date.now();
      const localChatFirst = localModels.find((n) => !isCloudModelName(n) && !isImageModelName(n)) || '';
      const localAnyFirst = localModels.find((n) => !isCloudModelName(n)) || '';
      const firstModel =
        localChatFirst ||
        localAnyFirst ||
        '';
      const session: ChatSession = {
        id: makeId(),
        title: '新对话',
        model: firstModel,
        messages: [],
        createdAt: now,
        updatedAt: now,
      };
      setChats([session]);
      setActiveChatId(session.id);
    }
  }, [chats.length, installedNameSet, localModels]);

  useEffect(() => {
    if (!window.api) return;
    window.api
      .getOllamaLocalTags()
      .then((res) => {
        if (res?.status === 'ok' && Array.isArray(res.models)) {
          const names = res.models
            .map((m: any) => (m?.name || m?.model || '').toString())
            .map((s: string) => s.trim())
            .filter(Boolean);
          setLocalModels(names);
        }
      })
      .finally(() => setLocalModelsLoaded(true));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (!window.api) {
        if (!cancelled) {
          setEngineReady(false);
          setEngineHint('服务未就绪：未检测到系统接口');
        }
        return;
      }
      try {
        const res = await window.api.checkOllama();
        if (cancelled) return;
        if (res?.status === 'ok') {
          setEngineReady(true);
          setEngineHint('');
        } else {
          setEngineReady(false);
          setEngineHint(`服务未就绪：${res?.message || 'Ollama 未运行'}`);
        }
      } catch (e: any) {
        if (cancelled) return;
        setEngineReady(false);
        setEngineHint(`服务未就绪：${e?.message || 'unknown error'}`);
      }
    };
    tick();
    const id = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!window.api) return;
    if (!isModelMenuOpen) return;
    window.api.getOllamaLocalTags().then((res) => {
      if (res?.status === 'ok' && Array.isArray(res.models)) {
        const names = res.models
          .map((m: any) => (m?.name || m?.model || '').toString())
          .map((s: string) => s.trim())
          .filter(Boolean);
        setLocalModels(names);
      }
    });
  }, [isModelMenuOpen]);

  useEffect(() => {
    if (!window.api) return;
    const unsubscribe = window.api.onOllamaPullProgress((chunk: any) => {
      const requestId = chunk?.requestId;
      if (!requestId) return;
      setPullState((prev) => {
        if (!prev || prev.requestId !== requestId) return prev;
        const now = Date.now();
        const status = typeof chunk?.status === 'string' ? chunk.status : prev.status;
        const total = typeof chunk?.total === 'number' ? chunk.total : prev.total;
        const completed = typeof chunk?.completed === 'number' ? chunk.completed : prev.completed;
        const error = typeof chunk?.error === 'string' ? chunk.error : prev.error;
        const done = Boolean(chunk?.done);
        let speedBps = prev.speedBps;
        if (typeof completed === 'number' && typeof prev.completed === 'number') {
          const delta = completed - prev.completed;
          const dt = prev.updatedAt ? now - prev.updatedAt : 0;
          if (dt > 0 && delta >= 0) {
            const instant = (delta / dt) * 1000;
            speedBps = Number.isFinite(speedBps) ? speedBps! * 0.7 + instant * 0.3 : instant;
          }
        }
        if (done) {
          window.api?.getOllamaLocalTags().then((res) => {
            if (res?.status === 'ok' && Array.isArray(res.models)) {
              const names = res.models
                .map((m: any) => (m?.name || m?.model || '').toString())
                .map((s: string) => s.trim())
                .filter(Boolean);
              setLocalModels(names);
            }
          });
          return null;
        }
        return { ...prev, status, total, completed, error, speedBps, updatedAt: now };
      });
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!activeChatId && chats[0]?.id) {
      setActiveChatId(chats[0].id);
    }
  }, [activeChatId, chats]);

  useEffect(() => {
    if (!localModelsLoaded) return;
    const localChatFirst = localModels.find((n) => !isCloudModelName(n) && !isImageModelName(n)) || '';
    const localAnyFirst = localModels.find((n) => !isCloudModelName(n)) || '';
    const fallback = localChatFirst || localAnyFirst || '';
    const isAllowed = (name: string) => (!isCloudModelName(name) && installedNameSet.has(name)) || isDownloadableModelName(name);
    if (!fallback) return;
    setChats((prev) =>
      prev.map((c) => {
        if (!c.model) return { ...c, model: fallback, updatedAt: Date.now() };
        if (!isAllowed(c.model)) return { ...c, model: fallback, updatedAt: Date.now() };
        return c;
      })
    );
  }, [installedNameSet, localModels, localModelsLoaded]);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChat?.messages.length]);

  useEffect(() => {
    if (!window.api) return;
    const unsubscribe = window.api.onOllamaReply((chunk: any) => {
      const requestId = chunk?.requestId;
      const active = activeRequestRef.current;
      if (!requestId || !active || requestId !== active.requestId) return;

      const chatId = active.chatId;
      const meta = activeRequestMetaRef.current;

      if (chunk?.error) {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c;
            const messages = [...c.messages];
            const last = messages[messages.length - 1];
            if (last?.role === 'assistant') {
              messages[messages.length - 1] = { ...last, content: `${last.content}\n\n错误: ${chunk.error}`.trim() };
            } else {
              messages.push({ role: 'assistant', content: `错误: ${chunk.error}` });
            }
            const updatedAt = Date.now();
            return { ...c, messages, updatedAt };
          })
        );
        setIsGenerating(false);
        activeRequestRef.current = null;
        activeRequestMetaRef.current = null;
        clearGenerationTimers();
        return;
      }

      if (chunk?.done) {
        setIsGenerating(false);
        activeRequestRef.current = null;
        activeRequestMetaRef.current = null;
        clearGenerationTimers();
        return;
      }

      const deltaContent: string | undefined = chunk?.message?.content;
      const deltaThinking: string | undefined = chunk?.message?.thinking;
      if (!deltaContent && !deltaThinking) return;

      if (meta && meta.requestId === requestId && !meta.gotAnyData) {
        meta.gotAnyData = true;
        clearGenerationTimers();
      }

      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c;
          const messages = [...c.messages];
          const last = messages[messages.length - 1];
          if (last?.role === 'assistant') {
            messages[messages.length - 1] = {
              ...last,
              content: last.content + (deltaContent || ''),
              thinking: (last.thinking || '') + (deltaThinking || ''),
            };
          } else {
            messages.push({ role: 'assistant', content: deltaContent || '', thinking: deltaThinking || '' });
          }
          const updatedAt = Date.now();
          const title = c.title === '新对话' ? makeTitleFromFirstUserMessage(messages) : c.title;
          return { ...c, messages, title, updatedAt };
        })
      );
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!isModelMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = modelMenuRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) {
        setIsModelMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    return () => window.removeEventListener('mousedown', onMouseDown);
  }, [isModelMenuOpen]);

  const activateChat = async (chatId: string) => {
    if (!chatId) return;
    if (chatId === activeChatId) return;
    if (isGenerating) await stopGenerating();
    setActiveChatId(chatId);
  };

  const createChat = async () => {
    if (isGenerating) await stopGenerating();
    const now = Date.now();
    const localChatFirst = localModels.find((n) => !isCloudModelName(n) && !isImageModelName(n)) || '';
    const localAnyFirst = localModels.find((n) => !isCloudModelName(n)) || '';
    const firstModel = localChatFirst || localAnyFirst || '';
    const session: ChatSession = {
      id: makeId(),
      title: '新对话',
      model: firstModel,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setChats((prev) => [session, ...prev]);
    setActiveChatId(session.id);
    setInput('');
    setIsGenerating(false);
    activeRequestRef.current = null;
    activeRequestMetaRef.current = null;
    clearGenerationTimers();
  };

  const deleteChat = async (chatId: string) => {
    if (isGenerating && activeChatId === chatId) await stopGenerating();
    setChats((prev) => prev.filter((c) => c.id !== chatId));
    if (activeChatId === chatId) {
      const remaining = chats.filter((c) => c.id !== chatId);
      setActiveChatId(remaining[0]?.id || '');
      setIsGenerating(false);
      activeRequestRef.current = null;
      activeRequestMetaRef.current = null;
      clearGenerationTimers();
    }
  };

  const clearChat = async () => {
    if (!activeChat) return;
    if (isGenerating) await stopGenerating();
    const now = Date.now();
    setChats((prev) =>
      prev.map((c) => (c.id === activeChat.id ? { ...c, title: '新对话', messages: [], updatedAt: now } : c))
    );
    setInput('');
    setIsGenerating(false);
    activeRequestRef.current = null;
    activeRequestMetaRef.current = null;
    clearGenerationTimers();
  };

  const setActiveModel = (model: string) => {
    if (!activeChatId) return;
    const prevModel = activeChat?.model || '';
    if (window.api?.ollamaStopModel && prevModel && prevModel !== model && isLikelyVeryLargeChatModel(prevModel)) {
      window.api.ollamaStopModel(prevModel, { force: true }).catch(() => {});
    }
    setChats((prev) =>
      prev.map((c) => (c.id === activeChatId ? { ...c, model, updatedAt: Date.now() } : c))
    );
  };

  const startPullModel = async (model: string) => {
    if (!window.api) return;
    if (pullState) return;
    const requestId = makeId();
    modelBeforePullRef.current = lastLocalModelRef.current || activeChat?.model || '';
    setPullState({ requestId, model, status: '准备下载...', updatedAt: Date.now(), completed: 0, speedBps: 0 });
    try {
      const res = await window.api.pullOllamaModel(requestId, model);
      if (!res || res.status !== 'ok') {
        setPullState({ requestId, model, error: res?.message || '下载失败' });
      }
    } catch (e: any) {
      setPullState({ requestId, model, error: e?.message || '下载失败' });
    }
  };

  const abortPullModel = async () => {
    if (!window.api) return;
    if (!pullState) return;
    try {
      await window.api.abortOllamaPull(pullState.requestId);
    } finally {
      if (pullState && !installedNameSet.has(pullState.model)) {
        const fallback = modelBeforePullRef.current;
        if (fallback && fallback !== pullState.model) {
          setActiveModel(fallback);
        }
      }
      setPullState(null);
      modelBeforePullRef.current = '';
    }
  };

  const selectedModel = activeChat?.model || '';
  const selectedModelLabel = selectedModel;

  const localChatResolved = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return localModels
      .filter((name) => !isCloudModelName(name) && !isImageModelName(name))
      .filter((name) => (!q ? true : name.toLowerCase().includes(q)))
      .map((name) => ({ name }));
  }, [modelQuery, localModels]);

  const localImageResolved = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return localModels
      .filter((name) => isImageModelName(name) && !isCloudModelName(name))
      .filter((name) => (!q ? true : name.toLowerCase().includes(q)))
      .map((name) => ({ name }));
  }, [modelQuery, localModels]);

  const downloadableChatResolved = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return downloadableChatModels
      .filter((name) => !installedNameSet.has(name) && (!q ? true : name.toLowerCase().includes(q)))
      .map((name) => ({ name }));
  }, [modelQuery, installedNameSet]);

  const downloadableImageResolved = useMemo(() => {
    const q = modelQuery.trim().toLowerCase();
    return downloadableImageModels
      .filter((name) => !installedNameSet.has(name) && (!q ? true : name.toLowerCase().includes(q)))
      .map((name) => ({ name }));
  }, [modelQuery, installedNameSet]);

  const modelKind = useMemo(() => {
    if (isImageModelName(selectedModel)) return 'image';
    if (installedNameSet.has(selectedModel)) return 'local';
    return 'other';
  }, [selectedModel, installedNameSet]);

  const isChatDisabled = modelKind === 'image';
  const isSelectedModelInstalled = Boolean(selectedModel) && installedNameSet.has(selectedModel);
  const canSend = Boolean(input.trim()) && Boolean(activeChat) && Boolean(selectedModel) && !isChatDisabled && isSelectedModelInstalled;

  useEffect(() => {
    if (!selectedModel) return;
    if (installedNameSet.has(selectedModel) && !isCloudModelName(selectedModel) && !isImageModelName(selectedModel)) {
      lastLocalModelRef.current = selectedModel;
    }
  }, [selectedModel, installedNameSet]);

  useEffect(() => {
    if (!isChatDisabled) {
      setImageTerminalNotice('');
      lastImageTerminalModelRef.current = '';
      imageTerminalOpeningRef.current = null;
      return;
    }
    if (!selectedModel) return;
    if (!installedNameSet.has(selectedModel)) {
      setImageTerminalNotice('模型未安装，请先下载后再在系统终端运行。');
      return;
    }
    if (!window.api?.openOllamaRunInSystemTerminal) {
      setImageTerminalNotice('当前环境不支持打开系统终端。');
      return;
    }
    const inflight = imageTerminalOpeningRef.current;
    if (inflight && inflight.model === selectedModel && Date.now() - inflight.startedAt < 10_000) return;
    if (lastImageTerminalModelRef.current === selectedModel) return;
    lastImageTerminalModelRef.current = selectedModel;
    imageTerminalOpeningRef.current = { model: selectedModel, startedAt: Date.now() };
    window.api.openOllamaRunInSystemTerminal(selectedModel).then((res) => {
      if (res?.status === 'ok') {
        setImageTerminalNotice(`已在系统终端执行：ollama run ${selectedModel}`);
      } else {
        setImageTerminalNotice(`打开系统终端失败：${res?.message || '未知错误'}`);
      }
      if (imageTerminalOpeningRef.current?.model === selectedModel) imageTerminalOpeningRef.current = null;
    });
  }, [isChatDisabled, selectedModel, installedNameSet]);

  const reopenImageTerminal = async () => {
    if (!isChatDisabled) return;
    if (!selectedModel || !installedNameSet.has(selectedModel)) return;
    if (!window.api?.openOllamaRunInSystemTerminal) return;
    const res = await window.api.openOllamaRunInSystemTerminal(selectedModel);
    if (res?.status === 'ok') setImageTerminalNotice(`已在系统终端执行：ollama run ${selectedModel}`);
    else setImageTerminalNotice(`打开系统终端失败：${res?.message || '未知错误'}`);
  };

  const copyToClipboard = async (key: string, text: string) => {
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
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1200);
  };

  const stopGenerating = async () => {
    if (!window.api) return;
    const active = activeRequestRef.current;
    const meta = activeRequestMetaRef.current;
    if (!active) return;
    try {
      await window.api.abortOllamaStream(active.requestId);
    } finally {
      clearGenerationTimers();
      activeRequestRef.current = null;
      activeRequestMetaRef.current = null;
      setIsGenerating(false);
      if (meta?.model && window.api?.ollamaStopModel) {
        window.api.ollamaStopModel(meta.model, { force: true }).catch(() => {});
      }
    }
  };

  const sendMessage = async () => {
    if (!activeChat) return;
    if (!input.trim()) return;
    if (isGenerating) return;

    const model = activeChat.model || '';
    if (!model) return;

    const kind = isImageModelName(model) ? 'image' : installedNameSet.has(model) ? 'local' : 'other';

    if (kind === 'image') {
      const notice: ChatMessage = { role: 'assistant', content: '当前选择的是文生图模型，暂不支持在「AI 对话」里聊天。' };
      setChats((prev) =>
        prev.map((c) => (c.id === activeChat.id ? { ...c, messages: [...c.messages, notice], updatedAt: Date.now() } : c))
      );
      return;
    }

    if (!installedNameSet.has(model)) {
      const notice: ChatMessage = { role: 'assistant', content: `模型未安装：${model}（请在模型列表里点击下载图标）` };
      setChats((prev) =>
        prev.map((c) => (c.id === activeChat.id ? { ...c, messages: [...c.messages, notice], updatedAt: Date.now() } : c))
      );
      return;
    }

    const userMsg: ChatMessage = { role: 'user', content: input };
    const requestId = makeId();
    activeRequestRef.current = { requestId, chatId: activeChat.id };
    activeRequestMetaRef.current = { requestId, chatId: activeChat.id, model, gotAnyData: false };
    clearGenerationTimers();

    const now = Date.now();
    const assistantPlaceholder: ChatMessage = { role: 'assistant', content: '', thinking: '', model };
    const messages: ChatMessage[] = [...activeChat.messages, userMsg, assistantPlaceholder];
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== activeChat.id) return c;
        const title = c.title === '新对话' ? makeTitleFromFirstUserMessage(messages) : c.title;
        return { ...c, model, messages, title, updatedAt: now };
      })
    );
    setInput('');
    setIsGenerating(true);

    if (!window.api) {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChat.id) return c;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: '演示模式: 无法连接到本地模型。' };
          }
          return { ...c, messages: msgs, updatedAt: Date.now() };
        })
      );
      setIsGenerating(false);
      activeRequestRef.current = null;
      activeRequestMetaRef.current = null;
      clearGenerationTimers();
      return;
    }

    const warnMs = isLikelyVeryLargeChatModel(model) ? 15_000 : 30_000;
    const hardMs = isLikelyVeryLargeChatModel(model) ? 120_000 : 240_000;

    firstTokenWarnTimerRef.current = window.setTimeout(() => {
      const active = activeRequestRef.current;
      const meta = activeRequestMetaRef.current;
      if (!active || !meta || active.requestId !== requestId || meta.requestId !== requestId) return;
      if (meta.gotAnyData) return;
      const hint = isLikelyVeryLargeChatModel(model)
        ? '提示：该模型体积较大（30B 级别），首次输出可能需要较长时间；如长时间无返回，建议点击“停止”并切换到更小模型（如 7B/14B）。'
        : '提示：模型响应较慢；如长时间无返回，建议点击“停止”并切换到更小模型。';
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== meta.chatId) return c;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role !== 'assistant') return c;
          const prevThinking = (last.thinking || '').trim();
          const nextThinking = prevThinking ? `${prevThinking}\n\n${hint}` : hint;
          msgs[msgs.length - 1] = { ...last, thinking: nextThinking };
          return { ...c, messages: msgs, updatedAt: Date.now() };
        })
      );
    }, warnMs);

    hardNoResponseTimerRef.current = window.setTimeout(async () => {
      const active = activeRequestRef.current;
      const meta = activeRequestMetaRef.current;
      if (!active || !meta || active.requestId !== requestId || meta.requestId !== requestId) return;
      if (meta.gotAnyData) return;
      try {
        await window.api?.abortOllamaStream?.(requestId);
      } catch {}
      try {
        await window.api?.ollamaStopModel?.(model, { force: true });
      } catch {}
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== meta.chatId) return c;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          const msg = `错误: 模型长时间无返回，已自动停止。建议更换更小模型后重试。`;
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: (last.content || msg).trim() || msg };
          } else {
            msgs.push({ role: 'assistant', content: msg, model });
          }
          return { ...c, messages: msgs, updatedAt: Date.now() };
        })
      );
      clearGenerationTimers();
      activeRequestRef.current = null;
      activeRequestMetaRef.current = null;
      setIsGenerating(false);
    }, hardMs);

    try {
      const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await window.api.chatWithOllamaStream(requestId, model, apiMessages);
      if (!res || res.status !== 'ok') {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== activeChat.id) return c;
            const msgs = [...c.messages];
            const last = msgs[msgs.length - 1];
            if (last?.role === 'assistant') {
              msgs[msgs.length - 1] = { ...last, content: `错误: ${res?.message || '未知错误'}` };
            } else {
              msgs.push({ role: 'assistant', content: `错误: ${res?.message || '未知错误'}`, model });
            }
            return { ...c, messages: msgs, updatedAt: Date.now() };
          })
        );
        setIsGenerating(false);
        activeRequestRef.current = null;
        activeRequestMetaRef.current = null;
        clearGenerationTimers();
      }
    } catch (e: any) {
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== activeChat.id) return c;
          const msgs = [...c.messages];
          const last = msgs[msgs.length - 1];
          if (last?.role === 'assistant') {
            msgs[msgs.length - 1] = { ...last, content: `通信失败: ${e?.message || '未知错误'}` };
          } else {
            msgs.push({ role: 'assistant', content: `通信失败: ${e?.message || '未知错误'}`, model });
          }
          return { ...c, messages: msgs, updatedAt: Date.now() };
        })
      );
      setIsGenerating(false);
      activeRequestRef.current = null;
      activeRequestMetaRef.current = null;
      clearGenerationTimers();
    }
  };

  return (
    <div className="ollama-ui">
      <div className="ollama-sidebar">
        <div className="ollama-sidebar-header">
          <button onClick={createChat}>新对话</button>
          <button className="secondary" onClick={clearChat} disabled={!activeChat || activeChat.messages.length === 0}>
            清空
          </button>
        </div>
        <div className="ollama-chat-list">
          {chats.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                className={`ollama-chat-item ${c.id === activeChatId ? 'active' : ''}`}
                onClick={() => activateChat(c.id)}
                title={c.title}
              >
                <span className="title">{c.title}</span>
                <span className="meta">{c.model || '未选模型'}</span>
              </button>
              <button
                aria-label="删除对话"
                onClick={() => deleteChat(c.id)}
                style={{
                  width: '38px',
                  height: '38px',
                  padding: 0,
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--panel-2)',
                  color: 'var(--text)',
                  flex: '0 0 auto',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="ollama-main">
        <div className="ollama-topbar">
          <div className="left">
            <div ref={modelMenuRef} className="ollama-model-picker">
              <button
                className="ollama-model-button"
                onClick={() => setIsModelMenuOpen((v) => !v)}
                disabled={!activeChat || isGenerating}
              >
                <span className="name">{selectedModelLabel || 'Select a model'}</span>
                <span className="chev">▾</span>
              </button>

              {isModelMenuOpen && (
                <div className="ollama-model-menu">
                  <div className="ollama-model-search">
                    <input
                      aria-label="搜索模型"
                      value={modelQuery}
                      onChange={(e) => setModelQuery(e.target.value)}
                      placeholder="搜索模型"
                    />
                  </div>

                  <div className="ollama-model-grid">
                    <div className="ollama-model-col">
                      <div className="ollama-model-section">
                        <div className="title">本地模型</div>
                        <div className="items">
                          {localChatResolved.length ? (
                            localChatResolved.map((m) => (
                              <button
                                key={m.name}
                                className={`ollama-model-item ${m.name === selectedModel ? 'active' : ''}`}
                                onClick={() => {
                                  setActiveModel(m.name);
                                  setIsModelMenuOpen(false);
                                }}
                              >
                                <span className="row">
                                  <span className="primary">{m.name}</span>
                                </span>
                              </button>
                            ))
                          ) : (
                            <div className="empty">无本地模型</div>
                          )}
                        </div>
                      </div>

                      <div className="ollama-model-section">
                        <div className="title">文生图模型</div>
                        <div className="items">
                          {localImageResolved.length || downloadableImageResolved.length ? (
                            <>
                              {localImageResolved.map((m) => (
                                <button
                                  key={m.name}
                                  className={`ollama-model-item ${m.name === selectedModel ? 'active' : ''}`}
                                  onClick={() => {
                                    setActiveModel(m.name);
                                    setIsModelMenuOpen(false);
                                  }}
                                >
                                  <span className="row">
                                    <span className="primary">{m.name}</span>
                                    <span className="tag">文生图</span>
                                  </span>
                                </button>
                              ))}
                              {downloadableImageResolved.map((m) => (
                                <div key={m.name} className="ollama-model-item-row">
                                  <button
                                    className={`ollama-model-item ${m.name === selectedModel ? 'active' : ''}`}
                                    onClick={() => {
                                      setActiveModel(m.name);
                                      setIsModelMenuOpen(false);
                                    }}
                                  >
                                    <span className="row">
                                      <span className="primary">{m.name}</span>
                                      <span className="tag">文生图</span>
                                    </span>
                                  </button>
                                  <button
                                    className="ollama-model-download"
                                    aria-label="下载模型"
                                    title="下载"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      setActiveModel(m.name);
                                      startPullModel(m.name);
                                    }}
                                    disabled={Boolean(pullState)}
                                  >
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                      <path
                                        d="M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </>
                          ) : (
                            <div className="empty">无文生图模型</div>
                          )}
                        </div>
                      </div>

                      <div className="ollama-model-section">
                        <div className="title">可下载模型</div>
                        <div className="items">
                          {downloadableChatResolved.length ? (
                            downloadableChatResolved.map((m) => (
                              <div key={m.name} className="ollama-model-item-row">
                                <button
                                  className={`ollama-model-item ${m.name === selectedModel ? 'active' : ''}`}
                                  onClick={() => {
                                    setActiveModel(m.name);
                                    setIsModelMenuOpen(false);
                                  }}
                                >
                                  <span className="row">
                                    <span className="primary">{m.name}</span>
                                  </span>
                                </button>
                                <button
                                  className="ollama-model-download"
                                  aria-label="下载模型"
                                  title="下载"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setActiveModel(m.name);
                                    startPullModel(m.name);
                                  }}
                                  disabled={Boolean(pullState)}
                                >
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                                    <path
                                      d="M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            ))
                          ) : (
                            <div className="empty">无可下载模型</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="messages">
          {isChatDisabled ? (
            <div className="terminal-shell">
              <div className="terminal-head">
                <div className="terminal-title">文生图模型需在系统终端运行</div>
                <button className="terminal-stop" onClick={reopenImageTerminal} disabled={!isSelectedModelInstalled}>
                  在终端打开
                </button>
              </div>
              <pre className="terminal-body">
                {imageTerminalNotice ? `${imageTerminalNotice}\n` : ''}
                {selectedModel ? `$ ollama run ${selectedModel}\n` : ''}
              </pre>
            </div>
          ) : activeChat?.messages?.length ? (
            activeChat.messages.map((m, i) => (
              <div key={i} className={`message-row ${m.role}`}>
                <div className={`avatar ${m.role}`}>{m.role === 'user' ? 'U' : m.role === 'assistant' ? 'AI' : 'S'}</div>
                <div className={`message-bubble ${m.role}`}>
                  {m.role === 'assistant' && m.model ? (
                    <div className="assistant-meta">{m.model}</div>
                  ) : null}
                  {m.role === 'assistant' && m.thinking && m.thinking.trim() ? (
                    <details className="assistant-thinking">
                      <summary>思考</summary>
                      <pre>{m.thinking}</pre>
                    </details>
                  ) : null}
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || '');
                        return !inline && match ? (
                          <SyntaxHighlighter style={vscDarkPlus} language={match[1]} PreTag="div" {...props}>
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        );
                      },
                    }}
                  >
                    {m.content}
                  </ReactMarkdown>
                  {m.role === 'assistant' && m.content.trim() ? (
                    <div className="message-actions">
                      <button
                        className={`icon-button ${copiedKey === `${activeChatId}:${i}` ? 'active' : ''}`}
                        aria-label="复制回答"
                        title={copiedKey === `${activeChatId}:${i}` ? '已复制' : '复制'}
                        onClick={() => copyToClipboard(`${activeChatId}:${i}`, m.content)}
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
                          <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" opacity="0.75" />
                        </svg>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="ollama-empty-hint">选择模型后输入问题开始对话</div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <div className="ollama-input-row">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={
                !engineReady
                  ? engineHint || '服务未就绪'
                  : isChatDisabled
                  ? '文生图模型已在系统终端运行，请在终端输入提示词'
                  : !isSelectedModelInstalled
                    ? '模型未安装，请在模型列表中点击下载图标'
                    : '输入消息... (Shift+Enter 换行)'
              }
              rows={1}
              disabled={!engineReady || !activeChat || !selectedModel || isGenerating || isChatDisabled || !isSelectedModelInstalled}
            />
            <div className="ollama-input-actions">
              {pullState ? (
                <div className="download-card">
                  <div className="download-head">
                    <div className="download-name">{pullState.model}</div>
                    <button className="download-cancel" onClick={abortPullModel} aria-label="取消下载" title="取消">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path d="M7 7l10 10M17 7 7 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </button>
                  </div>
                  <div className="download-sub">
                    <span>
                      {typeof pullState.completed === 'number' ? formatBytes(pullState.completed) : '—'} /{' '}
                      {typeof pullState.total === 'number' && pullState.total > 0 ? formatBytes(pullState.total) : '—'}
                    </span>
                    <span className="sep">·</span>
                    <span>
                      {typeof pullState.completed === 'number' && typeof pullState.total === 'number' && pullState.total > 0
                        ? `${Math.min(100, Math.floor((pullState.completed / pullState.total) * 100))}%`
                        : '—%'}
                    </span>
                    <span className="sep">·</span>
                    <span>{pullState.speedBps && pullState.speedBps > 0 ? `${formatBytes(pullState.speedBps)}/s` : '—/s'}</span>
                    <span className="sep">·</span>
                    <span>
                      {pullState.speedBps &&
                      pullState.speedBps > 0 &&
                      typeof pullState.total === 'number' &&
                      typeof pullState.completed === 'number' &&
                      pullState.total > pullState.completed
                        ? `ETA ${formatDuration((pullState.total - pullState.completed) / pullState.speedBps)}`
                        : 'ETA —'}
                    </span>
                  </div>
                  <div className="download-bar">
                    <div
                      className="download-bar-fill"
                      style={{
                        width:
                          typeof pullState.completed === 'number' &&
                          typeof pullState.total === 'number' &&
                          pullState.total > 0
                            ? `${Math.min(100, (pullState.completed / pullState.total) * 100)}%`
                            : '12%',
                      }}
                    />
                  </div>
                </div>
              ) : isGenerating ? (
                <button onClick={stopGenerating}>停止</button>
              ) : (
                <button onClick={sendMessage} disabled={!canSend}>
                  发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
