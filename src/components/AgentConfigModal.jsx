import React, { useState, useEffect } from "react";
import { useAgents } from "../AgentContext";

const PROVIDER_TYPES = [
  { value: "minimax", label: "MiniMax" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "ollama", label: "Ollama (Local)" },
];

const DEFAULTS = {
  minimax: { model: "MiniMax-M2.5", endpoint: "https://api.minimaxi.com/anthropic/v1/messages" },
  deepseek: { model: "deepseek-chat", endpoint: "https://api.deepseek.com/v1/chat/completions" },
  ollama: { model: "gemma3:4b", endpoint: "http://127.0.0.1:11434" },
};

export default function AgentConfigModal({ agentId, onClose }) {
  const { state, dispatch } = useAgents();
  const isNew = !agentId;

  const [name, setName] = useState("");
  const [providerType, setProviderType] = useState("minimax");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [telegramToken, setTelegramToken] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [workDir, setWorkDir] = useState("");

  useEffect(() => {
    if (agentId && state.agents[agentId]) {
      const agent = state.agents[agentId];
      setName(agent.name);
      setProviderType(agent.provider.type);
      setApiKey(agent.provider.apiKey);
      setModel(agent.provider.model);
      setEndpoint(agent.provider.endpoint);
      setTelegramToken(agent.telegram?.token || "");
      setTelegramEnabled(agent.telegram?.enabled || false);
      setWorkDir(agent.workDir || "");
    } else {
      // Defaults for new agent
      setName("");
      setProviderType("minimax");
      setApiKey("");
      setModel(DEFAULTS.minimax.model);
      setEndpoint(DEFAULTS.minimax.endpoint);
      setTelegramToken("");
      setTelegramEnabled(false);
      setWorkDir("");
    }
  }, [agentId, state.agents]);

  const handleProviderChange = (type) => {
    setProviderType(type);
    setModel(DEFAULTS[type]?.model || "");
    setEndpoint(DEFAULTS[type]?.endpoint || "");
  };

  const handleSave = async () => {
    if (!window.electronAPI) return;

    if (isNew) {
      const agent = await window.electronAPI.createAgent({
        name: name || "New Agent",
        providerType,
        apiKey,
        model,
        endpoint,
        telegramToken,
        telegramEnabled,
        workDir,
      });
      dispatch({ type: "ADD_AGENT", payload: agent });
    } else {
      const updates = {
        name,
        provider: { type: providerType, apiKey, model, endpoint },
        telegram: { token: telegramToken, enabled: telegramEnabled },
        workDir,
      };
      const updated = await window.electronAPI.updateAgent(agentId, updates);
      if (updated) {
        dispatch({ type: "UPDATE_AGENT", payload: { id: agentId, updates: updated } });
      }
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!agentId || !window.electronAPI) return;
    await window.electronAPI.deleteAgent(agentId);
    dispatch({ type: "DELETE_AGENT", payload: agentId });
    onClose();
  };

  const needsApiKey = providerType === "minimax" || providerType === "deepseek";

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isNew ? "Create Agent" : "Edit Agent"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label className="form-label">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent name"
              className="form-input"
            />
          </label>

          <label className="form-label">
            Provider
            <select
              value={providerType}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="form-select"
            >
              {PROVIDER_TYPES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          {needsApiKey && (
            <label className="form-label">
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                className="form-input"
              />
            </label>
          )}

          <label className="form-label">
            Model
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULTS[providerType]?.model || "model name"}
              className="form-input"
            />
          </label>

          <label className="form-label">
            Endpoint
            <input
              type="text"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder={DEFAULTS[providerType]?.endpoint || "API endpoint"}
              className="form-input"
            />
          </label>

          <div className="form-divider" />

          <label className="form-label">
            Telegram Bot Token
            <input
              type="text"
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder="123456:ABC-DEF..."
              className="form-input"
            />
          </label>

          <label className="form-label-inline">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(e) => setTelegramEnabled(e.target.checked)}
            />
            Auto-start Telegram Bot
          </label>

          <div className="form-divider" />

          <label className="form-label">
            Working Directory
            <input
              type="text"
              value={workDir}
              onChange={(e) => setWorkDir(e.target.value)}
              placeholder="~/Documents"
              className="form-input"
            />
          </label>
        </div>
        <div className="modal-footer">
          {!isNew && (
            <button className="btn-danger" onClick={handleDelete}>Delete</button>
          )}
          <div className="modal-footer-right">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>
              {isNew ? "Create" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
