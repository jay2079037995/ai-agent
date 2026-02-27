const { app, BrowserWindow } = require("electron");
const path = require("path");
const { migrateIfNeeded, getAllAgents } = require("./store");
const { registerIpcHandlers } = require("./ipc-handlers");
const { startTelegramBot, stopAllTelegramBots } = require("./telegram");

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

  // Auto-start Telegram bots for agents that have it enabled
  const agents = getAllAgents();
  for (const [id, agent] of Object.entries(agents)) {
    if (agent.telegram?.enabled && agent.telegram?.token) {
      startTelegramBot(id);
    }
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopAllTelegramBots();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
