import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";

const AgentContext = createContext(null);

const initialState = {
  agents: {},         // { [id]: agentConfig }
  openTabs: [],       // [agentId, ...]
  activeTabId: "",
  tabStates: {},      // { [agentId]: { history: [], mode: "agent", running: false } }
  loaded: false,
};

function reducer(state, action) {
  switch (action.type) {
    case "LOAD": {
      const { agents, uiState } = action.payload;
      const tabStates = {};
      for (const id of uiState.openTabs) {
        tabStates[id] = state.tabStates[id] || { history: [], mode: "agent", running: false };
      }
      return {
        ...state,
        agents,
        openTabs: uiState.openTabs,
        activeTabId: uiState.activeTabId || uiState.openTabs[0] || "",
        tabStates,
        loaded: true,
      };
    }
    case "ADD_AGENT": {
      const agent = action.payload;
      return {
        ...state,
        agents: { ...state.agents, [agent.id]: agent },
        openTabs: [...state.openTabs, agent.id],
        activeTabId: agent.id,
        tabStates: { ...state.tabStates, [agent.id]: { history: [], mode: "agent", running: false } },
      };
    }
    case "UPDATE_AGENT": {
      const { id, updates } = action.payload;
      const current = state.agents[id];
      if (!current) return state;
      return {
        ...state,
        agents: { ...state.agents, [id]: { ...current, ...updates } },
      };
    }
    case "DELETE_AGENT": {
      const id = action.payload;
      const newAgents = { ...state.agents };
      delete newAgents[id];
      const newTabs = state.openTabs.filter((t) => t !== id);
      const newTabStates = { ...state.tabStates };
      delete newTabStates[id];
      return {
        ...state,
        agents: newAgents,
        openTabs: newTabs,
        activeTabId: state.activeTabId === id ? (newTabs[0] || "") : state.activeTabId,
        tabStates: newTabStates,
      };
    }
    case "SET_ACTIVE_TAB":
      return { ...state, activeTabId: action.payload };
    case "OPEN_TAB": {
      const id = action.payload;
      if (state.openTabs.includes(id)) {
        return { ...state, activeTabId: id };
      }
      return {
        ...state,
        openTabs: [...state.openTabs, id],
        activeTabId: id,
        tabStates: {
          ...state.tabStates,
          [id]: state.tabStates[id] || { history: [], mode: "agent", running: false },
        },
      };
    }
    case "CLOSE_TAB": {
      const id = action.payload;
      const newTabs = state.openTabs.filter((t) => t !== id);
      const newActive =
        state.activeTabId === id
          ? newTabs[Math.max(0, state.openTabs.indexOf(id) - 1)] || newTabs[0] || ""
          : state.activeTabId;
      return { ...state, openTabs: newTabs, activeTabId: newActive };
    }
    case "PUSH_HISTORY": {
      const { agentId, entry } = action.payload;
      const ts = state.tabStates[agentId] || { history: [], mode: "agent", running: false };
      return {
        ...state,
        tabStates: {
          ...state.tabStates,
          [agentId]: { ...ts, history: [...ts.history, entry] },
        },
      };
    }
    case "CLEAR_HISTORY": {
      const agentId = action.payload;
      const ts = state.tabStates[agentId];
      if (!ts) return state;
      return {
        ...state,
        tabStates: { ...state.tabStates, [agentId]: { ...ts, history: [] } },
      };
    }
    case "SET_MODE": {
      const { agentId, mode } = action.payload;
      const ts = state.tabStates[agentId];
      if (!ts) return state;
      return {
        ...state,
        tabStates: { ...state.tabStates, [agentId]: { ...ts, mode } },
      };
    }
    case "SET_RUNNING": {
      const { agentId, running } = action.payload;
      const ts = state.tabStates[agentId];
      if (!ts) return state;
      return {
        ...state,
        tabStates: { ...state.tabStates, [agentId]: { ...ts, running } },
      };
    }
    default:
      return state;
  }
}

export function AgentProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Load agents + UI state on mount
  useEffect(() => {
    if (!window.electronAPI) return;
    Promise.all([
      window.electronAPI.getAllAgents(),
      window.electronAPI.getUIState(),
    ]).then(([agents, uiState]) => {
      dispatch({ type: "LOAD", payload: { agents, uiState } });
    });
  }, []);

  // Persist UI state when openTabs or activeTabId changes
  useEffect(() => {
    if (!state.loaded || !window.electronAPI) return;
    window.electronAPI.setUIState({
      openTabs: state.openTabs,
      activeTabId: state.activeTabId,
    });
  }, [state.openTabs, state.activeTabId, state.loaded]);

  return (
    <AgentContext.Provider value={{ state, dispatch }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgents() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useAgents must be used within AgentProvider");
  return ctx;
}
