import React, { useState, useRef, useEffect } from "react";
import { useAgents } from "../AgentContext";

const MODES = [
  { id: "agent", label: "agent", icon: "\u26A1", placeholder: "ask ai to do something..." },
  { id: "shell", label: "shell", icon: ">_", placeholder: "enter shell command..." },
  { id: "search", label: "search", icon: "\uD83D\uDD0D", placeholder: "search the web..." },
];

export default function AgentPanel({ agentId, onEditAgent }) {
  const { state, dispatch } = useAgents();
  const agent = state.agents[agentId];
  const tabState = state.tabStates[agentId] || { history: [], mode: "agent", running: false };
  const { history, mode, running } = tabState;

  const [command, setCommand] = useState("");
  const [tgRunning, setTgRunning] = useState(false);
  const [tgHasToken, setTgHasToken] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  // Load telegram status
  useEffect(() => {
    if (!window.electronAPI || !agentId) return;
    window.electronAPI.agentTelegramStatus(agentId).then((s) => {
      setTgRunning(s.running);
      setTgHasToken(s.hasToken);
    });
  }, [agentId]);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  // Focus input on mount / tab switch
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

  // Listen for progress events scoped to this agent
  useEffect(() => {
    if (!window.electronAPI) return;
    const removeListener = window.electronAPI.onAgentProgress((data) => {
      if (data.agentId !== agentId) return;
      let text = "";
      switch (data.type) {
        case "phase":
          text = `\u25B7 ${data.message}`;
          break;
        case "skill":
          text = `\u2605 Skill matched: ${data.name} \u2014 ${data.description}`;
          break;
        case "iteration":
          text = `\u27F3 Step ${data.step}/${data.max}`;
          break;
        case "tool-call":
          text = `\u2192 ${data.name}(${JSON.stringify(data.args || {})})`;
          break;
        case "tool-result":
          text = `\u2190 ${data.name}: ${data.result}`;
          break;
        default:
          text = `  ${JSON.stringify(data)}`;
      }
      dispatch({
        type: "PUSH_HISTORY",
        payload: { agentId, entry: { type: `progress progress-${data.type}`, text } },
      });
    });
    return removeListener;
  }, [agentId, dispatch]);

  if (!agent) return <div className="agent-panel-empty">No agent selected</div>;

  const currentMode = MODES.find((m) => m.id === mode);

  const handleTelegramToggle = async () => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.agentTelegramToggle(agentId);
    setTgRunning(result.running);
    if (result.error) {
      dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "error", text: `Telegram: ${result.error}` } } });
    } else {
      dispatch({
        type: "PUSH_HISTORY",
        payload: { agentId, entry: { type: "ai", text: result.running ? "Telegram Bot \u5DF2\u542F\u52A8" : "Telegram Bot \u5DF2\u505C\u6B62" } },
      });
    }
  };

  const handleClear = () => {
    dispatch({ type: "CLEAR_HISTORY", payload: agentId });
    if (window.electronAPI) {
      window.electronAPI.agentClearSession(agentId);
    }
    inputRef.current?.focus();
  };

  const handleNewSession = async () => {
    if (window.electronAPI) {
      await window.electronAPI.agentClearSession(agentId);
    }
    dispatch({ type: "CLEAR_HISTORY", payload: agentId });
    dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "ai", text: "New session started." } } });
    inputRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;

    const prefix = currentMode ? currentMode.icon : "$";
    dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "input", text: `${prefix} ${cmd}` } } });
    setCommand("");
    dispatch({ type: "SET_RUNNING", payload: { agentId, running: true } });

    if (!window.electronAPI) {
      dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "error", text: "[Not running in Electron]" } } });
    } else if (mode === "agent") {
      const result = await window.electronAPI.agentChat(agentId, cmd);
      if (result.error) {
        dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "error", text: result.error } } });
      } else {
        dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "ai", text: result.output } } });
      }
    } else if (mode === "search") {
      const result = await window.electronAPI.braveSearch(cmd);
      dispatch({
        type: "PUSH_HISTORY",
        payload: { agentId, entry: { type: result.error ? "error" : "ai", text: result.error || result.output } },
      });
    } else {
      // Shell mode
      const result = await window.electronAPI.agentExecCommand(agentId, cmd);
      const output = (result.stdout + result.stderr).trim();
      if (output) {
        dispatch({
          type: "PUSH_HISTORY",
          payload: { agentId, entry: { type: result.code === 0 ? "output" : "error", text: output } },
        });
      }
    }

    dispatch({ type: "SET_RUNNING", payload: { agentId, running: false } });
    inputRef.current?.focus();
  };

  const providerLabel = `${agent.provider.type} — ${agent.provider.model}`;

  return (
    <div className="agent-panel">
      <div className="terminal-header">
        <div className="header-left">
          <span className="terminal-title">{agent.name}</span>
          <div className="mode-tabs">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-tab ${mode === m.id ? "active" : ""}`}
                onClick={() => {
                  dispatch({ type: "SET_MODE", payload: { agentId, mode: m.id } });
                  inputRef.current?.focus();
                }}
                disabled={running}
              >
                <span className="mode-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="header-right">
          <span className="provider-badge">{providerLabel}</span>
          <button
            className={`tg-toggle ${tgRunning ? "active" : ""}`}
            onClick={handleTelegramToggle}
            title={tgRunning ? "Telegram Bot \u8FD0\u884C\u4E2D (\u70B9\u51FB\u505C\u6B62)" : tgHasToken ? "\u70B9\u51FB\u542F\u52A8 Telegram Bot" : "\u672A\u914D\u7F6E Bot Token"}
            disabled={!tgHasToken}
          >
            <span className={`tg-dot ${tgRunning ? "on" : ""}`} />
            TG
          </button>
          <button className="header-btn" onClick={onEditAgent} title="Settings">
            \u2699
          </button>
          <button className="header-btn" onClick={handleNewSession} disabled={running} title="New Session">
            New
          </button>
          <button className="header-btn" onClick={handleClear} title="Clear">
            Clear
          </button>
        </div>
      </div>
      <div className="terminal-output" ref={outputRef}>
        {history.map((item, i) => (
          <pre key={i} className={`line ${item.type}`}>
            {item.text}
          </pre>
        ))}
        {running && (
          <div className="line running">
            <span className="thinking-dots">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </span>
            {mode === "agent" ? "agent thinking..." : "processing..."}
          </div>
        )}
      </div>
      <form className="terminal-input" onSubmit={handleSubmit}>
        <span className="prompt">{currentMode?.icon || "$"}</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder={currentMode?.placeholder || "Enter command..."}
          autoFocus
          disabled={running}
        />
      </form>
    </div>
  );
}
