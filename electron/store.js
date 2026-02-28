const ElectronStore = require("electron-store");
const Store = ElectronStore.default || ElectronStore;
const { v4: uuidv4 } = require("uuid");

// --- Predefined roles ---

const ROLES = {
  general: { label: "通用", prompt: "" },
  pm: {
    label: "项目经理",
    prompt: `你的角色是【项目经理】。你的职责是：管理项目、拆分需求为子任务、将任务派发给合适角色的 agent、跟踪项目进度、协调团队成员之间的沟通。
当有人问你"你是谁"或"你是做什么的"时，你应该回答你是项目经理，负责项目管理、任务拆分与派发、进度跟踪。
工作流程：1) 收到新需求时，先用 list_agents 查看团队中有哪些 agent 及其角色 2) 分析需求并拆分为子任务 3) 使用 create_task 创建任务并通过 assignedRole 分配给对应角色 4) 使用 list_tasks 跟踪任务进度 5) 需要沟通时使用 send_message_to_agent 联系对应 agent。`,
  },
  developer: {
    label: "程序员",
    prompt: `你的角色是【程序员】。你的职责是：编写代码、实现功能、修复 bug、进行代码优化。
当有人问你"你是谁"或"你是做什么的"时，你应该回答你是程序员，负责编写代码、实现功能和修复 bug。
工作流程：1) 收到任务后分析需求 2) 使用工具编写和执行代码 3) 完成后使用 update_task 将任务状态更新为 done 4) 如发现问题或需要协调，使用 send_message_to_agent 反馈给项目经理或测试员。`,
  },
  tester: {
    label: "测试员",
    prompt: `你的角色是【测试员】。你的职责是：测试软件功能、发现并报告 bug、验证 bug 修复、确保软件质量。
当有人问你"你是谁"或"你是做什么的"时，你应该回答你是测试员，负责测试软件、发现 bug 和确保软件质量。
工作流程：1) 收到测试任务后，根据任务描述测试功能 2) 如发现 bug，使用 send_message_to_agent 通知程序员并使用 create_task 创建 bug 修复任务 3) 验证修复后使用 update_task 标记任务为 done。`,
  },
};

const schema = {
  agents: { type: "object", default: {} },
  tasks: { type: "object", default: {} },
  agentMessages: { type: "object", default: {} },
  uiState: {
    type: "object",
    properties: {
      openTabs: { type: "array", items: { type: "string" }, default: [] },
      activeTabId: { type: "string", default: "" },
    },
    default: { openTabs: [], activeTabId: "" },
  },
};

const store = new Store({ schema, name: "ai-agent-config", projectName: "ai-agent" });

// --- Agent CRUD ---

function createAgent(config = {}) {
  const id = uuidv4();
  const now = Date.now();
  const agent = {
    id,
    name: config.name || "New Agent",
    role: config.role || "general",
    provider: {
      type: config.providerType || "minimax",
      apiKey: config.apiKey || "",
      model: config.model || "",
      endpoint: config.endpoint || "",
    },
    skills: config.skills || {
      "basic-tools": { installed: true, config: {} },
    },
    maxIterations: config.maxIterations || 30,
    workDir: config.workDir || process.env.HOME || "",
    createdAt: now,
    updatedAt: now,
  };

  // Fill default model/endpoint based on provider type
  if (!agent.provider.model) {
    agent.provider.model = getDefaultModel(agent.provider.type);
  }
  if (!agent.provider.endpoint) {
    agent.provider.endpoint = getDefaultEndpoint(agent.provider.type);
  }

  const agents = store.get("agents", {});
  agents[id] = agent;
  store.set("agents", agents);
  return agent;
}

function getAgent(id) {
  const agents = store.get("agents", {});
  return agents[id] || null;
}

function getAllAgents() {
  return store.get("agents", {});
}

function updateAgent(id, updates) {
  const agents = store.get("agents", {});
  if (!agents[id]) return null;

  // Deep merge provider
  if (updates.provider) {
    agents[id].provider = { ...agents[id].provider, ...updates.provider };
    delete updates.provider;
  }

  // Deep merge skills
  if (updates.skills) {
    agents[id].skills = { ...agents[id].skills, ...updates.skills };
    delete updates.skills;
  }

  Object.assign(agents[id], updates, { updatedAt: Date.now() });
  store.set("agents", agents);
  return agents[id];
}

function deleteAgent(id) {
  const agents = store.get("agents", {});
  delete agents[id];
  store.set("agents", agents);

  // Also clean up UI state
  const uiState = store.get("uiState", { openTabs: [], activeTabId: "" });
  uiState.openTabs = uiState.openTabs.filter((t) => t !== id);
  if (uiState.activeTabId === id) {
    uiState.activeTabId = uiState.openTabs[0] || "";
  }
  store.set("uiState", uiState);
}

// --- Per-agent skill management ---

function installSkill(agentId, skillName, config = {}) {
  const agents = store.get("agents", {});
  if (!agents[agentId]) return null;

  if (!agents[agentId].skills) agents[agentId].skills = {};
  agents[agentId].skills[skillName] = { installed: true, config };
  agents[agentId].updatedAt = Date.now();
  store.set("agents", agents);
  return agents[agentId];
}

function uninstallSkill(agentId, skillName) {
  const agents = store.get("agents", {});
  if (!agents[agentId]) return null;

  if (agents[agentId].skills) {
    delete agents[agentId].skills[skillName];
  }
  agents[agentId].updatedAt = Date.now();
  store.set("agents", agents);
  return agents[agentId];
}

function updateSkillConfig(agentId, skillName, config) {
  const agents = store.get("agents", {});
  if (!agents[agentId]) return null;
  if (!agents[agentId].skills || !agents[agentId].skills[skillName]) return null;

  agents[agentId].skills[skillName].config = {
    ...agents[agentId].skills[skillName].config,
    ...config,
  };
  agents[agentId].updatedAt = Date.now();
  store.set("agents", agents);
  return agents[agentId];
}

function getAgentSkills(agentId) {
  const agent = getAgent(agentId);
  if (!agent) return {};
  return agent.skills || {};
}

// --- UI state ---

function getUIState() {
  return store.get("uiState", { openTabs: [], activeTabId: "" });
}

function setUIState(state) {
  const current = store.get("uiState", { openTabs: [], activeTabId: "" });
  store.set("uiState", { ...current, ...state });
}

// --- Task CRUD ---

function createTask(taskData = {}) {
  const id = uuidv4();
  const now = Date.now();
  const task = {
    id,
    title: taskData.title || "Untitled Task",
    description: taskData.description || "",
    status: taskData.status || "backlog",
    priority: taskData.priority || "medium",
    assignedRole: taskData.assignedRole || "general",
    assignedAgentId: taskData.assignedAgentId || null,
    createdBy: taskData.createdBy || null,
    triggerType: taskData.triggerType || "auto",
    scheduledAt: taskData.scheduledAt || null,
    repeat: taskData.repeat || false,
    repeatMode: taskData.repeatMode || "daily",
    repeatInterval: taskData.repeatInterval || null,
    startedAt: taskData.startedAt || null,
    completedAt: taskData.completedAt || null,
    nextRunAt: taskData.nextRunAt || null,
    createdAt: now,
    updatedAt: now,
  };
  const tasks = store.get("tasks", {});
  tasks[id] = task;
  store.set("tasks", tasks);
  return task;
}

function getTask(taskId) {
  const tasks = store.get("tasks", {});
  return tasks[taskId] || null;
}

function getAllTasks() {
  return store.get("tasks", {});
}

function updateTask(taskId, updates) {
  const tasks = store.get("tasks", {});
  if (!tasks[taskId]) return null;
  Object.assign(tasks[taskId], updates, { updatedAt: Date.now() });
  store.set("tasks", tasks);
  return tasks[taskId];
}

function deleteTask(taskId) {
  const tasks = store.get("tasks", {});
  delete tasks[taskId];
  store.set("tasks", tasks);
}

// --- Agent Messages ---

function pushAgentMessage(targetAgentId, senderAgentId, message) {
  const allMessages = store.get("agentMessages", {});
  if (!allMessages[targetAgentId]) allMessages[targetAgentId] = [];
  allMessages[targetAgentId].push({
    from: senderAgentId,
    message,
    timestamp: Date.now(),
  });
  store.set("agentMessages", allMessages);
}

function popAgentMessages(agentId) {
  const allMessages = store.get("agentMessages", {});
  const messages = allMessages[agentId] || [];
  if (messages.length > 0) {
    allMessages[agentId] = [];
    store.set("agentMessages", allMessages);
  }
  return messages;
}

// --- Defaults ---

function getDefaultModel(providerType) {
  switch (providerType) {
    case "minimax": return "MiniMax-M2.5";
    case "deepseek": return "deepseek-chat";
    case "ollama": return "gemma3:4b";
    default: return "";
  }
}

function getDefaultEndpoint(providerType) {
  switch (providerType) {
    case "minimax": return "https://api.minimaxi.com/anthropic/v1/messages";
    case "deepseek": return "https://api.deepseek.com";
    case "ollama": return "http://127.0.0.1:11434";
    default: return "";
  }
}

// --- Migration ---

function migrateIfNeeded() {
  const agents = store.get("agents", {});

  // If no agents, create a default one
  if (Object.keys(agents).length === 0) {
    createAgent({
      name: "Default Agent",
      providerType: "minimax",
      skills: {
        "basic-tools": { installed: true, config: {} },
        "shell": { installed: true, config: {} },
        "browser": { installed: true, config: {} },
        "web-search": { installed: true, config: {} },
        "notes": { installed: true, config: {} },
        "webpage": { installed: true, config: {} },
      },
    });
    const allAgents = store.get("agents", {});
    const firstId = Object.keys(allAgents)[0];
    if (firstId) {
      store.set("uiState", { openTabs: [firstId], activeTabId: firstId });
    }
    return;
  }

  // Migrate existing agents from old format to skill-based format
  let changed = false;
  for (const id of Object.keys(agents)) {
    const agent = agents[id];

    // Add role field if missing
    if (!agent.role) {
      agent.role = "general";
      changed = true;
    }

    // If agent already has skills, skip
    if (agent.skills) continue;

    changed = true;
    agent.skills = {
      "basic-tools": { installed: true, config: {} },
      "shell": { installed: true, config: {} },
      "browser": { installed: true, config: {} },
      "notes": { installed: true, config: {} },
      "webpage": { installed: true, config: {} },
    };

    // Migrate sharedKeys (from old top-level) into skill configs
    const sharedKeys = store.get("sharedKeys", {});
    if (sharedKeys.braveApiKey) {
      agent.skills["web-search"] = { installed: true, config: { braveApiKey: sharedKeys.braveApiKey } };
    }
    if (sharedKeys.gmailUser || sharedKeys.gmailAppPassword) {
      agent.skills["email"] = {
        installed: true,
        config: { gmailUser: sharedKeys.gmailUser || "", gmailAppPassword: sharedKeys.gmailAppPassword || "" },
      };
    }

    // Migrate old telegram field into telegram skill
    if (agent.telegram && agent.telegram.token) {
      agent.skills["telegram"] = {
        installed: true,
        config: { token: agent.telegram.token, autoStart: agent.telegram.enabled || false },
      };
    }
    delete agent.telegram;

    agent.updatedAt = Date.now();
  }

  if (changed) {
    store.set("agents", agents);
    // Clean up old sharedKeys
    store.delete("sharedKeys");
  }

  // Migrate tasks: add trigger fields if missing
  const tasks = store.get("tasks", {});
  let tasksChanged = false;
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    if (t.triggerType === undefined) {
      t.triggerType = "auto";
      t.scheduledAt = null;
      t.repeat = false;
      t.repeatInterval = null;
      tasksChanged = true;
    }
  }
  if (tasksChanged) {
    store.set("tasks", tasks);
  }
}

module.exports = {
  store,
  ROLES,
  createAgent,
  getAgent,
  getAllAgents,
  updateAgent,
  deleteAgent,
  installSkill,
  uninstallSkill,
  updateSkillConfig,
  getAgentSkills,
  createTask,
  getTask,
  getAllTasks,
  updateTask,
  deleteTask,
  pushAgentMessage,
  popAgentMessages,
  getUIState,
  setUIState,
  getDefaultModel,
  getDefaultEndpoint,
  migrateIfNeeded,
};
