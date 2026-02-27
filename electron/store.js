const ElectronStore = require("electron-store");
const Store = ElectronStore.default || ElectronStore;
const { v4: uuidv4 } = require("uuid");

const schema = {
  agents: { type: "object", default: {} },
  sharedKeys: {
    type: "object",
    properties: {
      braveApiKey: { type: "string", default: "" },
      gmailUser: { type: "string", default: "" },
      gmailAppPassword: { type: "string", default: "" },
    },
    default: {},
  },
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
    telegram: {
      token: config.telegramToken || "",
      enabled: config.telegramEnabled || false,
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

  // Deep merge provider and telegram
  if (updates.provider) {
    agents[id].provider = { ...agents[id].provider, ...updates.provider };
    delete updates.provider;
  }
  if (updates.telegram) {
    agents[id].telegram = { ...agents[id].telegram, ...updates.telegram };
    delete updates.telegram;
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

// --- Shared keys ---

function getSharedKeys() {
  return store.get("sharedKeys", {});
}

function setSharedKeys(keys) {
  const current = store.get("sharedKeys", {});
  store.set("sharedKeys", { ...current, ...keys });
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

// --- Migration: seed default agent from env/hardcoded keys on first run ---

function migrateIfNeeded() {
  const agents = store.get("agents", {});
  if (Object.keys(agents).length > 0) return; // already has agents

  // Create a default agent with minimax config
  createAgent({
    name: "Default Agent",
    providerType: "minimax",
    apiKey: "",
    telegramToken: "",
    telegramEnabled: false,
  });

  // Ensure UI state points to the new agent
  const allAgents = store.get("agents", {});
  const firstId = Object.keys(allAgents)[0];
  if (firstId) {
    store.set("uiState", { openTabs: [firstId], activeTabId: firstId });
  }
}

module.exports = {
  store,
  createAgent,
  getAgent,
  getAllAgents,
  updateAgent,
  deleteAgent,
  getSharedKeys,
  setSharedKeys,
  getUIState,
  setUIState,
  getDefaultModel,
  getDefaultEndpoint,
  migrateIfNeeded,
};
