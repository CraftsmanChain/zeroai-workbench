import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  checkOllama: () => ipcRenderer.invoke('check-ollama'),
  checkOpenClaw: () => ipcRenderer.invoke('check-openclaw'),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (content: string) => ipcRenderer.invoke('save-config', content),
  restartGateway: () => ipcRenderer.invoke('restart-gateway'),
  getGatewayToken: () => ipcRenderer.invoke('get-gateway-token'),
  tailOpenClawLogs: (stream?: 'out' | 'err', lines?: number) => ipcRenderer.invoke('openclaw-logs-tail', { stream, lines }),
  tailOllamaLogs: (stream?: 'out' | 'err', lines?: number) => ipcRenderer.invoke('ollama-logs-tail', { stream, lines }),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  installOffline: () => ipcRenderer.invoke('install-offline'),
  importLocalLlm: () => ipcRenderer.invoke('import-local-llm'),
  openclawSkillsList: () => ipcRenderer.invoke('openclaw-skills-list'),
  openclawSkillSetEnabled: (name: string, enabled: boolean) => ipcRenderer.invoke('openclaw-skill-set-enabled', { name, enabled }),
  openclawGatewayStatus: () => ipcRenderer.invoke('openclaw-gateway-status'),
  openclawDoctorRepair: () => ipcRenderer.invoke('openclaw-doctor-repair'),
  openclawRestart: () => ipcRenderer.invoke('openclaw-restart'),
  openclawModelsStatus: () => ipcRenderer.invoke('openclaw-models-status'),
  openclawStatus: () => ipcRenderer.invoke('openclaw-status'),
  openclawSecurityAudit: (opts?: { deep?: boolean }) => ipcRenderer.invoke('openclaw-security-audit', { deep: Boolean(opts?.deep) }),
  openclawFixPermissions: () => ipcRenderer.invoke('openclaw-fix-permissions'),
  openclawRepairConfig: () => ipcRenderer.invoke('openclaw-repair-config'),
  openclawNetworkOnline: () => ipcRenderer.invoke('openclaw-network-online'),
  openclawLastLlmError: () => ipcRenderer.invoke('openclaw-last-llm-error'),
  openclawSessionStallStatus: () => ipcRenderer.invoke('openclaw-session-stall-status'),
  openclawSetPrimaryModel: (ref: string) => ipcRenderer.invoke('openclaw-set-primary-model', { ref }),
  openclawSwitchToLocalOllama: () => ipcRenderer.invoke('openclaw-switch-to-local-ollama'),
  openclawSetLocalOllamaModel: (model: string) => ipcRenderer.invoke('openclaw-set-local-ollama-model', { model }),
  openclawAddModel: (payload: {
    providerId: string;
    baseUrl?: string;
    apiKey?: string;
    api?: string;
    modelId: string;
    setPrimary?: boolean;
  }) => ipcRenderer.invoke('openclaw-add-model', payload),
  startOpenclawAuthLogin: (requestId: string, provider: string) => ipcRenderer.invoke('openclaw-auth-login-start', { requestId, provider }),
  stopOpenclawAuthLogin: (requestId: string) => ipcRenderer.invoke('openclaw-auth-login-stop', { requestId }),
  onOpenclawAuthOutput: (callback: (chunk: any) => void) => {
    const subscription = (_: any, chunk: any) => callback(chunk);
    ipcRenderer.on('openclaw-auth-chunk', subscription);
    return () => ipcRenderer.removeListener('openclaw-auth-chunk', subscription);
  },
  startOllamaService: () => ipcRenderer.invoke('ollama-service-start'),
  stopOllamaService: () => ipcRenderer.invoke('ollama-service-stop'),
  startGatewayService: () => ipcRenderer.invoke('gateway-service-start'),
  stopGatewayService: () => ipcRenderer.invoke('gateway-service-stop'),
  startOllamaRun: (requestId: string, model: string) => ipcRenderer.invoke('ollama-run-start', { requestId, model }),
  sendOllamaRunInput: (requestId: string, input: string) => ipcRenderer.invoke('ollama-run-send', { requestId, input }),
  stopOllamaRun: (requestId: string) => ipcRenderer.invoke('ollama-run-stop', { requestId }),
  openOllamaRunInSystemTerminal: (model: string) => ipcRenderer.invoke('ollama-open-system-terminal', { model }),
  onOllamaRunOutput: (callback: (chunk: any) => void) => {
    const subscription = (_: any, chunk: any) => callback(chunk);
    ipcRenderer.on('ollama-run-chunk', subscription);
    return () => ipcRenderer.removeListener('ollama-run-chunk', subscription);
  },
  chatWithOllamaStream: (requestId: string, model: string, messages: any[]) =>
    ipcRenderer.invoke('chat-ollama-stream', { requestId, model, messages }),
  abortOllamaStream: (requestId: string) => ipcRenderer.invoke('abort-ollama-stream', { requestId }),
  ollamaPs: () => ipcRenderer.invoke('ollama-ps'),
  ollamaStopModel: (model: string, opts?: { force?: boolean }) => ipcRenderer.invoke('ollama-stop-model', { model, force: Boolean(opts?.force) }),
  onOllamaReply: (callback: (chunk: any) => void) => {
    const subscription = (_: any, chunk: any) => callback(chunk);
    ipcRenderer.on('ollama-reply-chunk', subscription);
    return () => ipcRenderer.removeListener('ollama-reply-chunk', subscription);
  },
  getOllamaLocalTags: () => ipcRenderer.invoke('ollama-local-tags'),
  searchOllamaLibrary: (query: string) => ipcRenderer.invoke('ollama-library-search', { query }),
  pullOllamaModel: (requestId: string, model: string) => ipcRenderer.invoke('ollama-pull', { requestId, model }),
  abortOllamaPull: (requestId: string) => ipcRenderer.invoke('ollama-pull-abort', { requestId }),
  onOllamaPullProgress: (callback: (chunk: any) => void) => {
    const subscription = (_: any, chunk: any) => callback(chunk);
    ipcRenderer.on('ollama-pull-chunk', subscription);
    return () => ipcRenderer.removeListener('ollama-pull-chunk', subscription);
  },
  startOpenWebUI: () => ipcRenderer.invoke('start-webui'),
  installOpenWebUI: () => ipcRenderer.invoke('install-webui'),
  getOllamaUiUrl: () => ipcRenderer.invoke('get-ollama-ui-url'),
  onInstallProgress: (callback: (log: string) => void) => {
    const subscription = (_: any, log: string) => callback(log);
    ipcRenderer.on('install-progress', subscription);
    return () => ipcRenderer.removeListener('install-progress', subscription);
  },
});
