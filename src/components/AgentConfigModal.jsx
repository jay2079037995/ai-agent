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
  const [workDir, setWorkDir] = useState("");
  const [maxIterations, setMaxIterations] = useState(30);

  // Skill management
  const [availableSkills, setAvailableSkills] = useState([]);
  const [agentSkills, setAgentSkills] = useState({});
  const [expandedSkill, setExpandedSkill] = useState(null);
  const [skillConfigs, setSkillConfigs] = useState({});
  const [downloadUrl, setDownloadUrl] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [installedFilter, setInstalledFilter] = useState("");
  const [availableFilter, setAvailableFilter] = useState("");

  // Load available skills
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.listAvailableSkills().then(setAvailableSkills);
  }, []);

  // Load agent data
  useEffect(() => {
    if (agentId && state.agents[agentId]) {
      const agent = state.agents[agentId];
      setName(agent.name);
      setProviderType(agent.provider.type);
      setApiKey(agent.provider.apiKey);
      setModel(agent.provider.model);
      setEndpoint(agent.provider.endpoint);
      setWorkDir(agent.workDir || "");
      setMaxIterations(agent.maxIterations || 30);
      setAgentSkills(agent.skills || {});
      const configs = {};
      for (const [skillName, skillData] of Object.entries(agent.skills || {})) {
        if (skillData.config) configs[skillName] = { ...skillData.config };
      }
      setSkillConfigs(configs);
    } else {
      setName("");
      setProviderType("minimax");
      setApiKey("");
      setModel(DEFAULTS.minimax.model);
      setEndpoint(DEFAULTS.minimax.endpoint);
      setWorkDir("");
      setMaxIterations(30);
      setAgentSkills({ "basic-tools": { installed: true, config: {} } });
      setSkillConfigs({});
    }
  }, [agentId, state.agents]);

  const handleProviderChange = (type) => {
    setProviderType(type);
    setModel(DEFAULTS[type]?.model || "");
    setEndpoint(DEFAULTS[type]?.endpoint || "");
  };

  const handleInstallSkill = (skillName) => {
    const config = skillConfigs[skillName] || {};
    setAgentSkills((prev) => ({
      ...prev,
      [skillName]: { installed: true, config },
    }));
  };

  const handleUninstallSkill = (skillName) => {
    setAgentSkills((prev) => {
      const next = { ...prev };
      delete next[skillName];
      return next;
    });
    setExpandedSkill(null);
  };

  const handleSkillConfigChange = (skillName, key, value) => {
    setSkillConfigs((prev) => ({
      ...prev,
      [skillName]: { ...(prev[skillName] || {}), [key]: value },
    }));
    setAgentSkills((prev) => ({
      ...prev,
      [skillName]: {
        ...prev[skillName],
        config: { ...(prev[skillName]?.config || {}), [key]: value },
      },
    }));
  };

  const handleDownloadSkill = async () => {
    if (!downloadUrl.trim() || !window.electronAPI) return;
    setDownloading(true);
    try {
      const result = await window.electronAPI.downloadSkill(downloadUrl.trim());
      if (result.success) {
        setDownloadUrl("");
        const skills = await window.electronAPI.listAvailableSkills();
        setAvailableSkills(skills);
      } else {
        alert(`Download failed: ${result.error}`);
      }
    } catch (e) {
      alert(`Download error: ${e.message}`);
    }
    setDownloading(false);
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
        workDir,
        maxIterations,
        skills: agentSkills,
      });
      dispatch({ type: "ADD_AGENT", payload: agent });
    } else {
      const updates = {
        name,
        provider: { type: providerType, apiKey, model, endpoint },
        skills: agentSkills,
        maxIterations,
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

  const installedSkillNames = Object.keys(agentSkills).filter((n) => agentSkills[n]?.installed);
  const uninstalledSkills = availableSkills.filter((s) => !installedSkillNames.includes(s.name));

  const instLower = installedFilter.toLowerCase();
  const filteredInstalled = installedSkillNames.filter((n) => {
    if (!instLower) return true;
    const manifest = availableSkills.find((s) => s.name === n);
    return n.toLowerCase().includes(instLower) || (manifest?.displayName || "").toLowerCase().includes(instLower);
  });
  const availLower = availableFilter.toLowerCase();
  const filteredUninstalled = uninstalledSkills.filter((s) => {
    if (!availLower) return true;
    return s.name.toLowerCase().includes(availLower) || s.displayName.toLowerCase().includes(availLower);
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{isNew ? "Create Agent" : "Edit Agent"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label className="form-label">
            Name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name" className="form-input" />
          </label>

          <label className="form-label">
            Provider
            <select value={providerType} onChange={(e) => handleProviderChange(e.target.value)} className="form-select">
              {PROVIDER_TYPES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>

          {needsApiKey && (
            <label className="form-label">
              API Key
              <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="form-input" />
            </label>
          )}

          <label className="form-label">
            Model
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULTS[providerType]?.model || "model name"} className="form-input" />
          </label>

          <label className="form-label">
            Endpoint
            <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder={DEFAULTS[providerType]?.endpoint || "API endpoint"} className="form-input" />
          </label>

          <label className="form-label">
            Working Directory
            <input type="text" value={workDir} onChange={(e) => setWorkDir(e.target.value)} placeholder="~/Documents" className="form-input" />
          </label>

          <label className="form-label">
            Max Steps
            <input type="number" value={maxIterations} onChange={(e) => setMaxIterations(Math.max(1, parseInt(e.target.value) || 30))} min="1" max="100" className="form-input" />
          </label>

          <div className="form-divider" />

          {/* Installed Skills */}
          <div className="skills-section">
            <div className="skills-section-header">
              <h4 className="skills-title">Installed Skills ({filteredInstalled.length})</h4>
              <input
                type="text"
                value={installedFilter}
                onChange={(e) => setInstalledFilter(e.target.value)}
                placeholder="Filter..."
                className="form-input skill-filter-inline"
              />
            </div>
            <div className="skills-scroll">
              {filteredInstalled.length === 0 && <p className="skills-empty">{installedFilter ? "No match" : "No skills installed"}</p>}
              {filteredInstalled.map((skillName) => {
                const manifest = availableSkills.find((s) => s.name === skillName);
                const isExpanded = expandedSkill === skillName;
                const configSchema = manifest?.configSchema || {};
                const hasConfig = Object.keys(configSchema).length > 0;

                return (
                  <div key={skillName} className="skill-card installed">
                    <div className="skill-card-header" onClick={() => setExpandedSkill(isExpanded ? null : skillName)}>
                      <div className="skill-card-info">
                        <span className="skill-name">{manifest?.displayName || skillName}</span>
                        <span className="skill-type">{manifest?.type || "unknown"}</span>
                      </div>
                      <div className="skill-card-actions">
                        {hasConfig && <span className="skill-expand">{isExpanded ? "\u25B2" : "\u25BC"}</span>}
                        <button className="btn-small btn-danger" onClick={(e) => { e.stopPropagation(); handleUninstallSkill(skillName); }}>
                          Uninstall
                        </button>
                      </div>
                    </div>
                    {manifest && <p className="skill-description">{manifest.description}</p>}
                    {isExpanded && hasConfig && (
                      <div className="skill-config">
                        {Object.entries(configSchema).map(([key, schema]) => (
                          <label key={key} className="form-label">
                            {schema.label || key}
                            {schema.type === "boolean" ? (
                              <input
                                type="checkbox"
                                checked={skillConfigs[skillName]?.[key] || false}
                                onChange={(e) => handleSkillConfigChange(skillName, key, e.target.checked)}
                                style={{ marginLeft: 8 }}
                              />
                            ) : (
                              <input
                                type={schema.type === "password" ? "password" : "text"}
                                value={skillConfigs[skillName]?.[key] ?? schema.default ?? ""}
                                onChange={(e) => handleSkillConfigChange(skillName, key, schema.type === "number" ? Number(e.target.value) : e.target.value)}
                                placeholder={String(schema.default || "")}
                                className="form-input"
                              />
                            )}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Available Skills */}
          <div className="skills-section">
            <div className="skills-section-header">
              <h4 className="skills-title">Available Skills ({filteredUninstalled.length})</h4>
              <input
                type="text"
                value={availableFilter}
                onChange={(e) => setAvailableFilter(e.target.value)}
                placeholder="Filter..."
                className="form-input skill-filter-inline"
              />
            </div>
            <div className="skills-scroll">
              {filteredUninstalled.length === 0 && <p className="skills-empty">{availableFilter ? "No match" : "All skills installed"}</p>}
              {filteredUninstalled.map((skill) => (
                <div key={skill.name} className="skill-card available">
                  <div className="skill-card-header">
                    <div className="skill-card-info">
                      <span className="skill-name">{skill.displayName}</span>
                      <span className="skill-type">{skill.type}</span>
                    </div>
                    <button className="btn-small btn-primary" onClick={() => handleInstallSkill(skill.name)}>
                      Install
                    </button>
                  </div>
                  <p className="skill-description">{skill.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Download from URL */}
          <div className="skills-section">
            <h4 className="skills-title">Install from URL</h4>
            <div className="download-row">
              <input
                type="text"
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="https://example.com/my-skill.tar.gz"
                className="form-input"
                disabled={downloading}
              />
              <button className="btn-small btn-primary" onClick={handleDownloadSkill} disabled={downloading || !downloadUrl.trim()}>
                {downloading ? "..." : "Download"}
              </button>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          {!isNew && <button className="btn-danger" onClick={handleDelete}>Delete</button>}
          <div className="modal-footer-right">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSave}>{isNew ? "Create" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
