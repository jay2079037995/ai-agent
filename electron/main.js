const { app, BrowserWindow } = require("electron");
const path = require("path");
const { migrateIfNeeded, getAllAgents, getAgent } = require("./store");
const { registerIpcHandlers } = require("./ipc-handlers");
const { loadSkillCode, getSkillManifest } = require("./skill-registry");
const { agentLoop } = require("./agent-loop");
const { startTaskScanner, stopTaskScanner } = require("./collaboration");

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "../dist/index.html"));
}

// --- App lifecycle ---

app.whenReady().then(() => {
  migrateIfNeeded();
  registerIpcHandlers();
  createWindow();
  startTaskScanner();

  // Auto-start service skills (e.g. Telegram) for agents that have autoStart enabled
  const agents = getAllAgents();
  for (const [id, agent] of Object.entries(agents)) {
    for (const [skillName, skillData] of Object.entries(agent.skills || {})) {
      if (!skillData.installed) continue;
      const manifest = getSkillManifest(skillName);
      if (!manifest || manifest.type !== "service") continue;
      if (!skillData.config?.autoStart) continue;

      const code = loadSkillCode(skillName);
      if (code && code.startService) {
        const deps = { getAgentConfig: (aid) => getAgent(aid), agentLoop };
        code.startService(id, skillData.config, deps).catch((err) => {
          console.log(`Auto-start ${skillName} failed for agent ${id}: ${err.message}`);
        });
      }
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopTaskScanner();
  // Stop all running service skills
  const agents = getAllAgents();
  for (const [id, agent] of Object.entries(agents)) {
    for (const [skillName, skillData] of Object.entries(agent.skills || {})) {
      if (!skillData.installed) continue;
      const code = loadSkillCode(skillName);
      if (code && code.isRunning && code.isRunning(id)) {
        code.stopService(id);
      }
    }
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
