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
  installSkill,
  uninstallSkill,
  updateSkillConfig,
  getAgentSkills,
  createTask,
  getAllTasks,
  updateTask: updateTaskStore,
  deleteTask: deleteTaskStore,
  getUIState,
  setUIState,
} = require("./store");
const runtime = require("./runtime");
const { agentLoop } = require("./agent-loop");
const { getAvailableSkills, loadSkillCode, downloadSkill } = require("./skill-registry");
const { dispatchTaskToAgent, getTaskExecutions, cancelTask } = require("./collaboration");

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
    // Stop any running services for this agent
    const agentSkills = getAgentSkills(agentId);
    for (const [skillName, skillData] of Object.entries(agentSkills)) {
      if (!skillData.installed) continue;
      const code = loadSkillCode(skillName);
      if (code && code.isRunning && code.isRunning(agentId)) {
        code.stopService(agentId);
      }
    }
    runtime.remove(agentId);
    deleteAgent(agentId);
    return true;
  });

  // --- Per-agent chat ---

  ipcMain.handle("agent:chat", async (event, agentId, prompt, attachments = []) => {
    const agentConfig = getAgent(agentId);
    if (!agentConfig) return { error: `Agent not found: ${agentId}` };

    try {
      const history = runtime.getHistory(agentId);
      const result = await agentLoop(prompt, history, agentConfig, agentId, attachments);

      // Store prompt with text file contents in history (images too large to persist)
      const textFiles = attachments.filter((a) => a.type === "text");
      const storedPrompt = textFiles.length > 0
        ? prompt + "\n\n" + textFiles.map((a) => `--- ${a.name} ---\n${a.textContent}`).join("\n\n")
        : prompt;
      runtime.pushHistory(agentId, "user", storedPrompt);
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

  // --- Skill management ---

  ipcMain.handle("skill:list-available", () => {
    return getAvailableSkills();
  });

  ipcMain.handle("skill:install", (event, agentId, skillName, config) => {
    return installSkill(agentId, skillName, config || {});
  });

  ipcMain.handle("skill:uninstall", (event, agentId, skillName) => {
    // Stop service if running
    const code = loadSkillCode(skillName);
    if (code && code.isRunning && code.isRunning(agentId)) {
      code.stopService(agentId);
    }
    return uninstallSkill(agentId, skillName);
  });

  ipcMain.handle("skill:update-config", (event, agentId, skillName, config) => {
    return updateSkillConfig(agentId, skillName, config);
  });

  ipcMain.handle("skill:download", async (event, url) => {
    return await downloadSkill(url);
  });

  // --- Skill service management ---

  ipcMain.handle("skill:service-status", (event, agentId, skillName) => {
    const { getSkillManifest } = require("./skill-registry");
    const manifest = getSkillManifest(skillName);
    if (!manifest || manifest.type !== "service") return { error: "not-a-service" };

    const code = loadSkillCode(skillName);
    if (!code || !code.isRunning) return { running: false, hasConfig: false };

    const agentSkills = getAgentSkills(agentId);
    const skillData = agentSkills[skillName];
    const hasConfig = !!skillData?.config;

    return {
      running: code.isRunning(agentId),
      hasConfig,
    };
  });

  ipcMain.handle("skill:service-toggle", async (event, agentId, skillName) => {
    const { getSkillManifest } = require("./skill-registry");
    const manifest = getSkillManifest(skillName);
    if (!manifest || manifest.type !== "service") {
      return { running: false, error: `${skillName}: not a service skill.` };
    }

    const code = loadSkillCode(skillName);
    if (!code || !code.startService || !code.stopService) {
      return { running: false, error: `${skillName}: missing service implementation.` };
    }

    if (code.isRunning && code.isRunning(agentId)) {
      code.stopService(agentId);
      return { running: false };
    }

    const agentSkills = getAgentSkills(agentId);
    const skillConfig = agentSkills[skillName]?.config || {};

    const deps = {
      getAgentConfig: (id) => getAgent(id),
      agentLoop,
    };

    const ok = await code.startService(agentId, skillConfig, deps);
    return { running: ok, error: ok ? null : "启动失败，请检查 token 是否有效" };
  });

  // --- Task management ---

  ipcMain.handle("task:create", (event, taskData) => {
    const task = createTask(taskData);
    BrowserWindow.getAllWindows().forEach((w) => {
      try { w.webContents.send("tasks-updated"); } catch (_) {}
    });
    return task;
  });

  ipcMain.handle("task:dispatch", (event, taskId) => {
    const { getTask } = require("./store");
    const task = getTask(taskId);
    if (!task) return { error: "Task not found" };
    dispatchTaskToAgent(task);
    return { ok: true };
  });

  ipcMain.handle("task:get-all", () => {
    return getAllTasks();
  });

  ipcMain.handle("task:update", (event, taskId, updates) => {
    const task = updateTaskStore(taskId, updates);
    BrowserWindow.getAllWindows().forEach((w) => {
      try { w.webContents.send("tasks-updated"); } catch (_) {}
    });
    return task;
  });

  ipcMain.handle("task:delete", (event, taskId) => {
    cancelTask(taskId);
    deleteTaskStore(taskId);
    BrowserWindow.getAllWindows().forEach((w) => {
      try { w.webContents.send("tasks-updated"); } catch (_) {}
    });
    return true;
  });

  ipcMain.handle("task:get-executions", () => {
    return getTaskExecutions();
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
