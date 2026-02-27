const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  execCommand: (command) => ipcRenderer.invoke("exec-command", command),
  braveSearch: (query) => ipcRenderer.invoke("brave-search", query),
  ollamaChat: (prompt) => ipcRenderer.invoke("ollama-chat", prompt),
  ollamaAgent: (prompt) => ipcRenderer.invoke("ollama-agent", prompt),
  switchModel: (model) => ipcRenderer.invoke("switch-model", model),
  getCurrentModel: () => ipcRenderer.invoke("get-current-model"),
  listSkills: () => ipcRenderer.invoke("list-skills"),
  clearSession: () => ipcRenderer.invoke("clear-session"),
  telegramStatus: () => ipcRenderer.invoke("telegram-status"),
  telegramToggle: () => ipcRenderer.invoke("telegram-toggle"),
  onAgentProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on("agent-progress", handler);
    return () => ipcRenderer.removeListener("agent-progress", handler);
  },
});
