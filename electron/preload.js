const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,

  // --- Agent CRUD ---
  createAgent: (config) => ipcRenderer.invoke("agent:create", config),
  getAllAgents: () => ipcRenderer.invoke("agent:get-all"),
  updateAgent: (agentId, updates) => ipcRenderer.invoke("agent:update", agentId, updates),
  deleteAgent: (agentId) => ipcRenderer.invoke("agent:delete", agentId),

  // --- Per-agent operations ---
  agentChat: (agentId, prompt) => ipcRenderer.invoke("agent:chat", agentId, prompt),
  agentClearSession: (agentId) => ipcRenderer.invoke("agent:clear-session", agentId),
  agentExecCommand: (agentId, command) => ipcRenderer.invoke("agent:exec-command", agentId, command),
  agentTelegramStatus: (agentId) => ipcRenderer.invoke("agent:telegram-status", agentId),
  agentTelegramToggle: (agentId) => ipcRenderer.invoke("agent:telegram-toggle", agentId),

  // --- Shared ---
  braveSearch: (query) => ipcRenderer.invoke("brave-search", query),
  listSkills: () => ipcRenderer.invoke("list-skills"),

  // --- Shared keys ---
  getSharedKeys: () => ipcRenderer.invoke("shared-keys:get"),
  setSharedKeys: (keys) => ipcRenderer.invoke("shared-keys:set", keys),

  // --- UI state ---
  getUIState: () => ipcRenderer.invoke("ui:get-state"),
  setUIState: (state) => ipcRenderer.invoke("ui:set-state", state),

  // --- Progress events (carries agentId, filtered on frontend) ---
  onAgentProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("agent-progress", handler);
    return () => ipcRenderer.removeListener("agent-progress", handler);
  },
});
