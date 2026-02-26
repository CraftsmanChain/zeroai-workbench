/// <reference types="vite/client" />

interface Window {
  api?: {
    checkOllama: () => Promise<{ status: string; models?: string; message?: string }>;
    checkOpenClaw: () => Promise<{ status: string; ready?: boolean; version?: string; message?: string }>;
    getConfig: () => Promise<{ status: string; content?: string; message?: string }>;
    saveConfig: (content: string) => Promise<{ status: string; message?: string }>;
    restartGateway: () => Promise<{ status: string; message?: string }>;
    getGatewayToken: () => Promise<{ status: string; token?: string; message?: string }>;
    getSystemInfo: () => Promise<{ platform: string; arch: string; totalmem: number; freemem: number; cpus: any[] }>;
    installOffline: () => Promise<{ status: string; message?: string }>;
    importLocalLlm: () => Promise<{ status: string; message?: string }>;
    openclawSkillsList: () => Promise<{ status: string; data?: any; message?: string }>;
    openclawSkillSetEnabled: (name: string, enabled: boolean) => Promise<{ status: string; output?: string; message?: string }>;
    openclawGatewayStatus: () => Promise<{ status: string; output?: string; message?: string }>;
    openclawDoctorRepair: () => Promise<{ status: string; output?: string; message?: string }>;
    openclawRestart: () => Promise<{ status: string; output?: string; message?: string }>;
    openclawModelsStatus: () => Promise<{ status: string; output?: string; message?: string }>;
    openclawStatus: () => Promise<{ status: string; output?: string; message?: string }>;
    openclawSecurityAudit: (opts?: { deep?: boolean }) => Promise<{ status: string; output?: string; message?: string }>;
    openclawFixPermissions: () => Promise<{ status: string; changed?: boolean; items?: any[]; message?: string }>;
    openclawRepairConfig: () => Promise<{ status: string; changed?: boolean; output?: string; message?: string }>;
    openclawNetworkOnline: () => Promise<{ status: string; online: boolean; message?: string }>;
    openclawLastLlmError: () => Promise<{ status: string; found: boolean; provider?: string; model?: string; errorMessage?: string; stopReason?: string; timestamp?: string; sessionFile?: string; message?: string }>;
    openclawSessionStallStatus: () => Promise<{ status: string; found: boolean; pending?: boolean; ageMs?: number | null; lastUserAt?: string; lastAssistantAt?: string | null; lastAssistantErrorMessage?: string | null; lastAssistantStopReason?: string | null; lastAssistantProvider?: string | null; lastAssistantModel?: string | null; sessionFile?: string; message?: string }>;
    openclawSetPrimaryModel: (ref: string) => Promise<{ status: string; changed?: boolean; output?: string; message?: string }>;
    openclawSwitchToLocalOllama: () => Promise<{ status: string; model?: string; output?: string; message?: string }>;
    openclawSetLocalOllamaModel: (model: string) => Promise<{ status: string; model?: string; output?: string; message?: string }>;
    startOpenclawAuthLogin: (requestId: string, provider: string) => Promise<{ status: string; requestId?: string; message?: string }>;
    stopOpenclawAuthLogin: (requestId: string) => Promise<{ status: string; message?: string }>;
    onOpenclawAuthOutput: (callback: (chunk: any) => void) => () => void;
    startOllamaService: () => Promise<{ status: string; output?: string; message?: string }>;
    stopOllamaService: () => Promise<{ status: string; output?: string; message?: string }>;
    startGatewayService: () => Promise<{ status: string; output?: string; message?: string }>;
    stopGatewayService: () => Promise<{ status: string; output?: string; message?: string }>;
    startOllamaRun: (requestId: string, model: string) => Promise<{ status: string; requestId?: string; message?: string }>;
    sendOllamaRunInput: (requestId: string, input: string) => Promise<{ status: string; message?: string }>;
    stopOllamaRun: (requestId: string) => Promise<{ status: string; message?: string }>;
    openOllamaRunInSystemTerminal: (model: string) => Promise<{ status: string; output?: string; message?: string }>;
    onOllamaRunOutput: (callback: (chunk: any) => void) => () => void;
    chatWithOllamaStream: (requestId: string, model: string, messages: any[]) => Promise<{ status: string; requestId?: string; message?: string }>;
    abortOllamaStream: (requestId: string) => Promise<{ status: string; message?: string }>;
    ollamaPs: () => Promise<{ status: string; output?: string; message?: string }>;
    ollamaStopModel: (model: string, opts?: { force?: boolean }) => Promise<{ status: string; output?: string; message?: string }>;
    onOllamaReply: (callback: (chunk: any) => void) => () => void;
    getOllamaLocalTags: () => Promise<{ status: string; models?: any[]; message?: string }>;
    searchOllamaLibrary: (query: string) => Promise<{ status: string; models?: any[]; message?: string }>;
    pullOllamaModel: (requestId: string, model: string) => Promise<{ status: string; requestId?: string; message?: string }>;
    abortOllamaPull: (requestId: string) => Promise<{ status: string; message?: string }>;
    onOllamaPullProgress: (callback: (chunk: any) => void) => () => void;
    startOpenWebUI: () => Promise<{ status: string; message: string }>;
  installOpenWebUI: () => Promise<{ status: string; message: string }>;
  getOllamaUiUrl: () => Promise<{ status: string; url?: string; message?: string }>;
  onInstallProgress: (callback: (log: string) => void) => () => void;
};
}
