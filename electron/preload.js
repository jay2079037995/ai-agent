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

  // --- Skill management ---
  listAvailableSkills: () => ipcRenderer.invoke("skill:list-available"),
  installSkill: (agentId, skillName, config) => ipcRenderer.invoke("skill:install", agentId, skillName, config),
  uninstallSkill: (agentId, skillName) => ipcRenderer.invoke("skill:uninstall", agentId, skillName),
  updateSkillConfig: (agentId, skillName, config) => ipcRenderer.invoke("skill:update-config", agentId, skillName, config),
  downloadSkill: (url) => ipcRenderer.invoke("skill:download", url),

  // --- Skill service management ---
  skillServiceStatus: (agentId, skillName) => ipcRenderer.invoke("skill:service-status", agentId, skillName),
  skillServiceToggle: (agentId, skillName) => ipcRenderer.invoke("skill:service-toggle", agentId, skillName),

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
