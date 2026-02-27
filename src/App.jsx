import React, { useState, useEffect } from "react";
import { AgentProvider, useAgents } from "./AgentContext";
import TabBar from "./components/TabBar";
import AgentPanel from "./components/AgentPanel";
import AgentConfigModal from "./components/AgentConfigModal";
import "./App.css";

function AppInner() {
  const { state } = useAgents();
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [modalAgent, setModalAgent] = useState(null); // null=new, agentId=edit
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  const handleNewAgent = () => {
    setModalAgent(null);
    setShowModal(true);
  };

  const handleEditAgent = () => {
    setModalAgent(state.activeTabId);
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setModalAgent(null);
  };

  if (!state.loaded) {
    return (
      <div className="terminal loading-screen">
        <span className="thinking-dots">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </span>
        loading...
      </div>
    );
  }

  return (
    <div className="terminal">
      <div className="top-bar">
        <TabBar onNewAgent={handleNewAgent} />
        <button
          className="theme-toggle"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "switch to light mode" : "switch to dark mode"}
        >
          {theme === "dark" ? "light" : "dark"}
        </button>
      </div>
      {state.activeTabId ? (
        <AgentPanel agentId={state.activeTabId} onEditAgent={handleEditAgent} />
      ) : (
        <div className="agent-panel-empty">
          <p>No agents yet.</p>
          <button className="btn-primary" onClick={handleNewAgent}>Create Agent</button>
        </div>
      )}
      {showModal && (
        <AgentConfigModal agentId={modalAgent} onClose={handleCloseModal} />
      )}
    </div>
  );
}

function App() {
  return (
    <AgentProvider>
      <AppInner />
    </AgentProvider>
  );
}

export default App;
