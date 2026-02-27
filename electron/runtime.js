/**
 * AgentRuntime — in-memory state for each agent instance.
 * Chat history, Telegram bot instances, processing flags live here (not persisted).
 */

const MAX_SESSION_MESSAGES = 40;

class AgentRuntime {
  constructor() {
    // Map<agentId, RuntimeState>
    this._agents = new Map();
  }

  _ensure(agentId) {
    if (!this._agents.has(agentId)) {
      this._agents.set(agentId, {
        sessionHistory: [],
        telegramBot: null,
        telegramRunning: false,
        telegramSessions: {}, // chatId → message[]
        isProcessing: false,
      });
    }
    return this._agents.get(agentId);
  }

  // --- Session history ---

  getHistory(agentId) {
    return this._ensure(agentId).sessionHistory;
  }

  pushHistory(agentId, role, content) {
    const state = this._ensure(agentId);
    state.sessionHistory.push({ role, content });
    if (state.sessionHistory.length > MAX_SESSION_MESSAGES) {
      state.sessionHistory = state.sessionHistory.slice(-MAX_SESSION_MESSAGES);
    }
  }

  clearHistory(agentId) {
    const state = this._ensure(agentId);
    state.sessionHistory = [];
  }

  // --- Processing flag ---

  isProcessing(agentId) {
    return this._ensure(agentId).isProcessing;
  }

  setProcessing(agentId, value) {
    this._ensure(agentId).isProcessing = value;
  }

  // --- Telegram ---

  getTelegramBot(agentId) {
    return this._ensure(agentId).telegramBot;
  }

  setTelegramBot(agentId, bot) {
    this._ensure(agentId).telegramBot = bot;
  }

  isTelegramRunning(agentId) {
    return this._ensure(agentId).telegramRunning;
  }

  setTelegramRunning(agentId, value) {
    this._ensure(agentId).telegramRunning = value;
  }

  getTelegramSession(agentId, chatId) {
    const state = this._ensure(agentId);
    if (!state.telegramSessions[chatId]) {
      state.telegramSessions[chatId] = [];
    }
    return state.telegramSessions[chatId];
  }

  trimTelegramSession(agentId, chatId) {
    const state = this._ensure(agentId);
    const session = state.telegramSessions[chatId];
    if (session && session.length > MAX_SESSION_MESSAGES) {
      state.telegramSessions[chatId] = session.slice(-MAX_SESSION_MESSAGES);
    }
  }

  // --- Cleanup ---

  remove(agentId) {
    this._agents.delete(agentId);
  }

  getAll() {
    return this._agents;
  }
}

module.exports = new AgentRuntime();
