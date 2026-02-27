/**
 * All IPC handlers — registered once from main.js.
 */

const { ipcMain, BrowserWindow } = require("electron");
const { spawn } = require("child_process");
const {
  createAgent,
  getAllAgents,
  getAgent,
  updateAgent,
  deleteAgent,
  getSharedKeys,
  setSharedKeys,
  getUIState,
  setUIState,
} = require("./store");
const runtime = require("./runtime");
const { chatWithProvider, ollamaGenerate } = require("./providers");
const { agentLoop } = require("./agent-loop");
const { braveSearch } = require("./tools");
const { loadAllSkills } = require("./skills");
const { startTelegramBot, stopTelegramBot } = require("./telegram");
const path = require("path");

function registerIpcHandlers() {
  // --- Agent CRUD ---

  ipcMain.handle("agent:create", (event, config) => {
    return createAgent(config);
  });

  ipcMain.handle("agent:get-all", () => {
    return getAllAgents();
  });

  ipcMain.handle("agent:update", (event, agentId, updates) => {
    return updateAgent(agentId, updates);
  });

  ipcMain.handle("agent:delete", (event, agentId) => {
    // Stop telegram if running
    if (runtime.isTelegramRunning(agentId)) {
      stopTelegramBot(agentId);
    }
    runtime.remove(agentId);
    deleteAgent(agentId);
    return true;
  });

  // --- Per-agent chat ---

  ipcMain.handle("agent:chat", async (event, agentId, prompt) => {
    const agentConfig = getAgent(agentId);
    if (!agentConfig) return { error: `Agent not found: ${agentId}` };

    try {
      const history = runtime.getHistory(agentId);
      const result = await agentLoop(prompt, history, agentConfig, agentId);

      runtime.pushHistory(agentId, "user", prompt);
      runtime.pushHistory(agentId, "assistant", result.output || "");

      return result;
    } catch (err) {
      return { error: `Agent error: ${err.message}`, trace: [] };
    }
  });

  ipcMain.handle("agent:clear-session", (event, agentId) => {
    runtime.clearHistory(agentId);
    return { output: "Session cleared." };
  });

  // --- Per-agent shell command (uses agent's workDir) ---

  ipcMain.handle("agent:exec-command", (event, agentId, command) => {
    const agentConfig = getAgent(agentId);
    const cwd = agentConfig?.workDir || process.env.HOME;

    return new Promise((resolve) => {
      const sh = process.platform === "win32" ? "cmd" : "/bin/bash";
      const args = process.platform === "win32" ? ["/c", command] : ["-c", command];
      const child = spawn(sh, args, { cwd, env: process.env });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (data) => { stdout += data.toString(); });
      child.stderr.on("data", (data) => { stderr += data.toString(); });
      child.on("close", (code) => { resolve({ stdout, stderr, code }); });
      child.on("error", (err) => { resolve({ stdout: "", stderr: err.message, code: -1 }); });
    });
  });

  // --- Per-agent Telegram ---

  ipcMain.handle("agent:telegram-status", (event, agentId) => {
    const agentConfig = getAgent(agentId);
    const token = agentConfig?.telegram?.token;
    return {
      running: runtime.isTelegramRunning(agentId),
      hasToken: !!token && token !== "YOUR_BOT_TOKEN_HERE",
    };
  });

  ipcMain.handle("agent:telegram-toggle", (event, agentId) => {
    if (runtime.isTelegramRunning(agentId)) {
      stopTelegramBot(agentId);
      return { running: false };
    }
    const ok = startTelegramBot(agentId);
    return { running: ok, error: ok ? null : "启动失败，请检查 Bot Token 是否正确" };
  });

  // --- Shared: Brave Search (not agent-specific) ---

  ipcMain.handle("brave-search", async (event, query) => {
    const keys = getSharedKeys();
    if (!keys.braveApiKey) return { error: "Brave API key not configured." };

    try {
      const results = await braveSearch(keys.braveApiKey, query);
      if (results.length === 0) return { output: "No results found." };

      const context = results
        .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
        .join("\n\n");

      // Use a simple generate for search summarization (try ollama first, fallback)
      try {
        const aiPrompt = `Based on the following search results for "${query}", provide a direct, concise answer in the same language as the query. Extract the key facts and give a clear answer.\n\nSearch results:\n${context}\n\nAnswer:`;
        const aiAnswer = await ollamaGenerate(aiPrompt);
        return { output: aiAnswer.trim() || context };
      } catch (_) {
        return { output: context };
      }
    } catch (err) {
      return { error: err.message };
    }
  });

  // --- Shared: Skills ---

  ipcMain.handle("list-skills", () => {
    const skills = loadAllSkills();
    return skills.map((s) => ({
      name: s.name,
      description: s.description,
      keywords: s.matchKeywords,
      file: path.basename(s.filePath),
    }));
  });

  // --- Shared keys management ---

  ipcMain.handle("shared-keys:get", () => {
    return getSharedKeys();
  });

  ipcMain.handle("shared-keys:set", (event, keys) => {
    setSharedKeys(keys);
    return getSharedKeys();
  });

  // --- UI state persistence ---

  ipcMain.handle("ui:get-state", () => {
    return getUIState();
  });

  ipcMain.handle("ui:set-state", (event, state) => {
    setUIState(state);
    return getUIState();
  });
}

module.exports = { registerIpcHandlers };
