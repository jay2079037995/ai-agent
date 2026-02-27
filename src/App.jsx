import React, { useState, useRef, useEffect } from "react";
import "./App.css";

const MODES = [
  { id: "agent", label: "AI Agent", icon: "⚡", placeholder: "Ask AI to do something..." },
  { id: "shell", label: "Shell", icon: ">_", placeholder: "Enter shell command..." },
  { id: "search", label: "Search", icon: "🔍", placeholder: "Search the web..." },
];

const MODELS = [
  { id: "minimax", label: "MiniMax-M2.5" },
  { id: "ollama", label: "Ollama gemma3:4b" },
];

function App() {
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState([]);
  const [running, setRunning] = useState(false);
  const [modelName, setModelName] = useState("minimax");
  const [mode, setMode] = useState("agent");
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [tgRunning, setTgRunning] = useState(false);
  const [tgHasToken, setTgHasToken] = useState(false);
  const outputRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (window.electronAPI?.getCurrentModel) {
      window.electronAPI.getCurrentModel().then(setModelName);
    }
    if (window.electronAPI?.telegramStatus) {
      window.electronAPI.telegramStatus().then((s) => {
        setTgRunning(s.running);
        setTgHasToken(s.hasToken);
      });
    }
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const handleSwitchModel = async (model) => {
    setShowModelMenu(false);
    if (model === modelName) return;
    const result = await window.electronAPI.switchModel(model);
    if (result.error) {
      setHistory((prev) => [...prev, { type: "error", text: result.error }]);
    } else {
      setModelName(result.model);
      setHistory((prev) => [...prev, { type: "ai", text: result.output }]);
    }
    inputRef.current?.focus();
  };

  const handleNewSession = async () => {
    if (window.electronAPI?.clearSession) {
      await window.electronAPI.clearSession();
    }
    setHistory([{ type: "ai", text: "New session started." }]);
    inputRef.current?.focus();
  };

  const handleTelegramToggle = async () => {
    if (!window.electronAPI?.telegramToggle) return;
    const result = await window.electronAPI.telegramToggle();
    setTgRunning(result.running);
    if (result.error) {
      setHistory((prev) => [...prev, { type: "error", text: `Telegram: ${result.error}` }]);
    } else {
      setHistory((prev) => [...prev, { type: "ai", text: result.running ? "Telegram Bot 已启动" : "Telegram Bot 已停止" }]);
    }
  };

  const handleClear = () => {
    setHistory([]);
    if (window.electronAPI?.clearSession) {
      window.electronAPI.clearSession();
    }
    inputRef.current?.focus();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const cmd = command.trim();
    if (!cmd) return;

    const currentMode = MODES.find((m) => m.id === mode);
    const prefix = currentMode ? currentMode.icon : "$";
    setHistory((prev) => [...prev, { type: "input", text: `${prefix} ${cmd}` }]);
    setCommand("");
    setRunning(true);

    if (!window.electronAPI) {
      setHistory((prev) => [
        ...prev,
        { type: "error", text: "[Not running in Electron]" },
      ]);
    } else if (mode === "agent") {
      // --- AI Agent mode ---
      let removeListener = null;
      if (window.electronAPI.onAgentProgress) {
        removeListener = window.electronAPI.onAgentProgress((data) => {
          let text = "";
          switch (data.type) {
            case "phase":
              text = `▷ ${data.message}`;
              break;
            case "skill":
              text = `★ Skill matched: ${data.name} — ${data.description}`;
              break;
            case "iteration":
              text = `⟳ Step ${data.step}/${data.max}`;
              break;
            case "tool-call":
              text = `→ ${data.name}(${JSON.stringify(data.args || {})})`;
              break;
            case "tool-result":
              text = `← ${data.name}: ${data.result}`;
              break;
            default:
              text = `  ${JSON.stringify(data)}`;
          }
          setHistory((prev) => [...prev, { type: `progress progress-${data.type}`, text }]);
        });
      }

      const result = await window.electronAPI.ollamaAgent(cmd);
      if (removeListener) removeListener();

      if (result.error) {
        setHistory((prev) => [...prev, { type: "error", text: result.error }]);
      } else {
        setHistory((prev) => [...prev, { type: "ai", text: result.output }]);
      }
    } else if (mode === "search") {
      // --- Brave Search mode ---
      const result = await window.electronAPI.braveSearch(cmd);
      setHistory((prev) => [
        ...prev,
        {
          type: result.error ? "error" : "ai",
          text: result.error || result.output,
        },
      ]);
    } else {
      // --- Shell mode ---
      const result = await window.electronAPI.execCommand(cmd);
      const output = (result.stdout + result.stderr).trim();
      if (output) {
        setHistory((prev) => [
          ...prev,
          {
            type: result.code === 0 ? "output" : "error",
            text: output,
          },
        ]);
      }
    }

    setRunning(false);
    inputRef.current?.focus();
  };

  const currentMode = MODES.find((m) => m.id === mode);
  const currentModel = MODELS.find((m) => m.id === modelName);

  return (
    <div className="terminal" onClick={() => showModelMenu && setShowModelMenu(false)}>
      <div className="terminal-header">
        <div className="header-left">
          <span className="terminal-title">Pack</span>
          <div className="mode-tabs">
            {MODES.map((m) => (
              <button
                key={m.id}
                className={`mode-tab ${mode === m.id ? "active" : ""}`}
                onClick={() => { setMode(m.id); inputRef.current?.focus(); }}
                disabled={running}
              >
                <span className="mode-icon">{m.icon}</span>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <div className="header-right">
          <div className="model-selector" onClick={(e) => e.stopPropagation()}>
            <button
              className="model-badge"
              onClick={() => setShowModelMenu(!showModelMenu)}
              disabled={running}
            >
              {currentModel?.label || modelName}
              <span className="caret">▾</span>
            </button>
            {showModelMenu && (
              <div className="model-menu">
                {MODELS.map((m) => (
                  <div
                    key={m.id}
                    className={`model-option ${modelName === m.id ? "selected" : ""}`}
                    onClick={() => handleSwitchModel(m.id)}
                  >
                    {modelName === m.id && <span className="check">✓</span>}
                    {m.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className={`tg-toggle ${tgRunning ? "active" : ""}`}
            onClick={handleTelegramToggle}
            title={tgRunning ? "Telegram Bot 运行中 (点击停止)" : tgHasToken ? "点击启动 Telegram Bot" : "未配置 Bot Token"}
            disabled={!tgHasToken}
          >
            <span className={`tg-dot ${tgRunning ? "on" : ""}`} />
            TG
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
        {running && <pre className="line running">{mode === "agent" ? "Agent thinking..." : "Processing..."}</pre>}
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

export default App;
