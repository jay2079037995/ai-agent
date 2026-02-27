const ElectronStore = require("electron-store");
const Store = ElectronStore.default || ElectronStore;
const { v4: uuidv4 } = require("uuid");

const schema = {
  agents: { type: "object", default: {} },
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
    provider: {
      type: config.providerType || "minimax",
      apiKey: config.apiKey || "",
      model: config.model || "",
      endpoint: config.endpoint || "",
    },
    skills: config.skills || {
      "basic-tools": { installed: true, config: {} },
    },
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
    case "deepseek": return "https://api.deepseek.com/v1/chat/completions";
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
}

module.exports = {
  store,
  createAgent,
  getAgent,
  getAllAgents,
  updateAgent,
  deleteAgent,
  installSkill,
  uninstallSkill,
  updateSkillConfig,
  getAgentSkills,
  getUIState,
  setUIState,
  getDefaultModel,
  getDefaultEndpoint,
  migrateIfNeeded,
};
