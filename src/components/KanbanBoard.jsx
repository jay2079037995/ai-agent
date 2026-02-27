import React, { useState, useEffect } from "react";
import { useAgents } from "../AgentContext";

const COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in_progress", label: "In Progress" },
  { key: "done", label: "Done" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

const ROLE_OPTIONS = [
  { value: "general", label: "通用" },
  { value: "pm", label: "项目经理" },
  { value: "developer", label: "程序员" },
  { value: "tester", label: "测试员" },
];

const PRIORITY_COLORS = {
  high: "#e74c3c",
  medium: "#f39c12",
  low: "#2ecc71",
};

function TaskModal({ task, agents, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [assignedRole, setAssignedRole] = useState(task?.assignedRole || "general");
  const [assignedAgentId, setAssignedAgentId] = useState(task?.assignedAgentId || "");
  const [status, setStatus] = useState(task?.status || "backlog");

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      ...(task || {}),
      title: title.trim(),
      description,
      priority,
      assignedRole,
      assignedAgentId: assignedAgentId || null,
      status,
    });
  };

  const roleAgents = Object.values(agents).filter((a) => a.role === assignedRole);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{task ? "Edit Task" : "New Task"}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <label className="form-label">
            Title
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Task title" className="form-input" />
          </label>
          <label className="form-label">
            Description
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Task description..." className="form-input form-textarea" rows={3} />
          </label>
          <label className="form-label">
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className="form-select">
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="form-select">
              {COLUMNS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Assigned Role
            <select value={assignedRole} onChange={(e) => { setAssignedRole(e.target.value); setAssignedAgentId(""); }} className="form-select">
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {roleAgents.length > 0 && (
            <label className="form-label">
              Assigned Agent
              <select value={assignedAgentId} onChange={(e) => setAssignedAgentId(e.target.value)} className="form-select">
                <option value="">Auto (any {ROLE_OPTIONS.find((r) => r.value === assignedRole)?.label})</option>
                {roleAgents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="modal-footer">
          <div className="modal-footer-right">
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button className="btn-primary" onClick={handleSubmit} disabled={!title.trim()}>
              {task ? "Save" : "Create"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExecutionStatus({ execution }) {
  if (!execution) return null;

  const isRunning = execution.status === "running";
  const statusClass = isRunning ? "exec-running" : execution.status === "completed" ? "exec-completed" : "exec-failed";
  const statusLabel = isRunning ? "执行中" : execution.status === "completed" ? "已完成" : "失败";

  return (
    <div className={`kanban-card-execution ${statusClass}`}>
      <div className="exec-header">
        <span className={`exec-dot ${statusClass}`} />
        <span className="exec-agent">{execution.agentName}</span>
        <span className="exec-status">{statusLabel}</span>
      </div>
      {isRunning && (
        <div className="exec-detail">
          Step {execution.step || 1}
          {execution.toolName && <span className="exec-tool"> · {execution.toolName}</span>}
        </div>
      )}
    </div>
  );
}

function KanbanCard({ task, agents, execution, onEdit, onDelete, onDispatch }) {
  const agent = task.assignedAgentId ? agents[task.assignedAgentId] : null;
  const roleName = ROLE_OPTIONS.find((r) => r.value === task.assignedRole)?.label || task.assignedRole;
  const canDispatch = task.status === "backlog" && task.assignedRole && task.assignedRole !== "general";

  return (
    <div className="kanban-card" onClick={() => onEdit(task)}>
      <div className="kanban-card-priority" style={{ backgroundColor: PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium }} />
      <div className="kanban-card-body">
        <div className="kanban-card-title">{task.title}</div>
        {task.description && <div className="kanban-card-desc">{task.description}</div>}
        <div className="kanban-card-meta">
          <span className="kanban-card-role">{roleName}</span>
          {agent && <span className="kanban-card-agent">{agent.name}</span>}
        </div>
        <ExecutionStatus execution={execution} />
        {!execution && task.status !== "done" && (
          <div className="kanban-card-no-exec">暂无 Agent 执行</div>
        )}
        <div className="kanban-card-actions" onClick={(e) => e.stopPropagation()}>
          {canDispatch && (
            <button className="btn-tiny btn-dispatch" onClick={() => onDispatch(task.id)}>Dispatch</button>
          )}
          <button className="btn-tiny btn-danger" onClick={() => onDelete(task.id)}>×</button>
        </div>
      </div>
    </div>
  );
}

export default function KanbanBoard() {
  const { state } = useAgents();
  const [tasks, setTasks] = useState({});
  const [executions, setExecutions] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  const loadTasks = () => {
    if (!window.electronAPI) return;
    window.electronAPI.getAllTasks().then(setTasks);
  };

  useEffect(() => {
    loadTasks();
    if (!window.electronAPI?.onTasksUpdated) return;
    const unsub = window.electronAPI.onTasksUpdated(loadTasks);
    return unsub;
  }, []);

  // Load initial task executions and listen for updates
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.getTaskExecutions?.().then((data) => {
      if (data) setExecutions(data);
    });
    if (!window.electronAPI.onTaskExecutionUpdated) return;
    const unsub = window.electronAPI.onTaskExecutionUpdated((data) => {
      setExecutions(data || {});
    });
    return unsub;
  }, []);


  const handleSave = async (taskData) => {
    if (!window.electronAPI) return;
    if (taskData.id) {
      await window.electronAPI.updateTask(taskData.id, taskData);
    } else {
      await window.electronAPI.createTask(taskData);
    }
    setShowModal(false);
    setEditingTask(null);
    loadTasks();
  };

  const handleMove = async (taskId, newStatus) => {
    if (!window.electronAPI) return;
    await window.electronAPI.updateTask(taskId, { status: newStatus });
    loadTasks();
  };

  const handleDelete = async (taskId) => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteTask(taskId);
    loadTasks();
  };

  const handleEdit = (task) => {
    setEditingTask(task);
    setShowModal(true);
  };

  const handleDispatch = async (taskId) => {
    if (!window.electronAPI) return;
    await window.electronAPI.dispatchTask(taskId);
  };

  const handleNew = () => {
    setEditingTask(null);
    setShowModal(true);
  };

  const taskList = Object.values(tasks).sort((a, b) => {
    const pOrder = { high: 0, medium: 1, low: 2 };
    return (pOrder[a.priority] ?? 1) - (pOrder[b.priority] ?? 1) || b.createdAt - a.createdAt;
  });

  return (
    <div className="kanban-container">
      <div className="kanban-header">
        <h3>Task Board</h3>
        <button className="btn-primary btn-small" onClick={handleNew}>+ New Task</button>
      </div>
      <div className="kanban-board">
        {COLUMNS.map((col) => {
          const colTasks = taskList.filter((t) => t.status === col.key);
          return (
            <div key={col.key} className="kanban-column">
              <div className="kanban-column-header">
                <span>{col.label}</span>
                <span className="kanban-column-count">{colTasks.length}</span>
              </div>
              <div className="kanban-column-body">
                {colTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    agents={state.agents}
                    execution={executions[task.id] || null}
                    onEdit={handleEdit}
                    onMove={handleMove}
                    onDelete={handleDelete}
                    onDispatch={handleDispatch}
                  />
                ))}
                {colTasks.length === 0 && <div className="kanban-empty">No tasks</div>}
              </div>
            </div>
          );
        })}
      </div>
      {showModal && (
        <TaskModal
          task={editingTask}
          agents={state.agents}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditingTask(null); }}
        />
      )}
    </div>
  );
}
