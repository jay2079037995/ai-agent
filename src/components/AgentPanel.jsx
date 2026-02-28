import React, { useState, useRef, useEffect } from "react";
import { useAgents } from "../AgentContext";

export default function AgentPanel({ agentId, onEditAgent }) {
  const { state, dispatch } = useAgents();
  const agent = state.agents[agentId];
  const tabState = state.tabStates[agentId] || { history: [], mode: "agent", running: false };
  const { history, mode, running } = tabState;

  const [command, setCommand] = useState("");
  const [serviceStatuses, setServiceStatuses] = useState({});
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  // Build mode tabs dynamically from installed skills
  const modes = [{ id: "agent", label: "agent", icon: "\u26A1", placeholder: "ask ai to do something..." }];
  const skills = agent?.skills || {};
  if (skills["shell"]?.installed) {
    modes.push({ id: "shell", label: "shell", icon: ">_", placeholder: "enter shell command..." });
  }

  // Check service skill statuses (e.g. telegram)
  useEffect(() => {
    if (!window.electronAPI || !agentId || !agent) return;
    const installedSkills = Object.entries(agent.skills || {}).filter(([name, data]) => data.installed);

    const checkStatuses = async () => {
      const statuses = {};
      for (const [name] of installedSkills) {
        try {
          const status = await window.electronAPI.skillServiceStatus(agentId, name);
          if (!status.error && status.running !== undefined) {
            statuses[name] = status;
          }
        } catch (_) {}
      }
      setServiceStatuses(statuses);
    };
    checkStatuses();
    // Re-check after delay to catch async auto-started services
    const timer = setTimeout(checkStatuses, 3000);
    return () => clearTimeout(timer);
  }, [agentId, agent?.skills]);

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
          text = `\u27F3 Step ${data.step}`;
          break;
        case "tool-call":
          text = `\u2192 ${data.name}(${JSON.stringify(data.args || {})})`;
          break;
        case "tool-result":
          text = `\u2190 ${data.name}: ${data.result}`;
          break;
        case "reasoning":
          text = `\u{1F4AD} ${data.text}`;
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

  const currentMode = modes.find((m) => m.id === mode) || modes[0];

  const handleServiceToggle = async (skillName) => {
    if (!window.electronAPI) return;
    const result = await window.electronAPI.skillServiceToggle(agentId, skillName);
    setServiceStatuses((prev) => ({
      ...prev,
      [skillName]: { ...prev[skillName], running: result.running },
    }));
    if (result.error) {
      dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "error", text: `${skillName}: ${result.error}` } } });
    } else {
      const label = result.running ? "已启动" : "已停止";
      dispatch({
        type: "PUSH_HISTORY",
        payload: { agentId, entry: { type: "ai", text: `${skillName} ${label}` } },
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
    } else if (mode === "shell") {
      // Shell mode
      const result = await window.electronAPI.agentExecCommand(agentId, cmd);
      const output = (result.stdout + result.stderr).trim();
      if (output) {
        dispatch({
          type: "PUSH_HISTORY",
          payload: { agentId, entry: { type: result.code === 0 ? "output" : "error", text: output } },
        });
      }
    } else {
      // Agent mode (default)
      const result = await window.electronAPI.agentChat(agentId, cmd);
      if (result.error) {
        dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "error", text: result.error } } });
      } else {
        dispatch({ type: "PUSH_HISTORY", payload: { agentId, entry: { type: "ai", text: result.output } } });
      }
    }

    dispatch({ type: "SET_RUNNING", payload: { agentId, running: false } });
    inputRef.current?.focus();
  };

  const providerLabel = `${agent.provider.type} — ${agent.provider.model}`;

  // Find service skills that have toggle buttons
  const serviceSkills = Object.entries(agent.skills || {})
    .filter(([name, data]) => data.installed && serviceStatuses[name] !== undefined);

  return (
    <div className="agent-panel">
      <div className="terminal-header">
        <div className="header-left">
          <span className="terminal-title">{agent.name}</span>
          <div className="mode-tabs">
            {modes.map((m) => (
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
          {serviceSkills.map(([skillName, skillData]) => {
            const status = serviceStatuses[skillName] || {};
            return (
              <button
                key={skillName}
                className={`tg-toggle ${status.running ? "active" : ""}`}
                onClick={() => handleServiceToggle(skillName)}
                title={status.running ? `${skillName} running (click to stop)` : `Start ${skillName}`}
              >
                <span className={`tg-dot ${status.running ? "on" : ""}`} />
                {skillName === "telegram" ? "TG" : skillName}
              </button>
            );
          })}
          <button className="header-btn" onClick={onEditAgent} title="Settings">
            <span style={{ fontSize: 14 }}>{"⚙"}</span> Edit
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
