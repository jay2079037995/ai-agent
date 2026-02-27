import React from "react";
import { useAgents } from "../AgentContext";

export default function TabBar({ onNewAgent }) {
  const { state, dispatch } = useAgents();
  const { agents, openTabs, activeTabId } = state;

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {openTabs.map((id) => {
          const agent = agents[id];
          if (!agent) return null;
          return (
            <div
              key={id}
              className={`tab-item ${activeTabId === id ? "active" : ""}`}
              onClick={() => dispatch({ type: "SET_ACTIVE_TAB", payload: id })}
            >
              <span className="tab-dot" style={{ background: getProviderColor(agent.provider.type) }} />
              <span className="tab-name">{agent.name}</span>
              {openTabs.length > 1 && (
                <button
                  className="tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "CLOSE_TAB", payload: id });
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button className="tab-add" onClick={onNewAgent} title="New Agent">
        +
      </button>
    </div>
  );
}

function getProviderColor(type) {
  switch (type) {
    case "minimax": return "#22C55E";
    case "deepseek": return "#3B82F6";
    case "ollama": return "#F59E0B";
    default: return "#737373";
  }
}
