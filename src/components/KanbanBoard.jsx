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

const TRIGGER_TYPES = [
  { value: "auto", label: "自动触发" },
  { value: "scheduled", label: "定时触发" },
  { value: "manual", label: "手动触发" },
];

const PRIORITY_COLORS = {
  high: "#e74c3c",
  medium: "#f39c12",
  low: "#2ecc71",
};

function formatTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function TaskModal({ task, agents, onSave, onClose }) {
  const [title, setTitle] = useState(task?.title || "");
  const [description, setDescription] = useState(task?.description || "");
  const [priority, setPriority] = useState(task?.priority || "medium");
  const [assignedRole, setAssignedRole] = useState(task?.assignedRole || "general");
  const [assignedAgentId, setAssignedAgentId] = useState(task?.assignedAgentId || "");
  const [triggerType, setTriggerType] = useState(task?.triggerType || "auto");
  const [scheduledAt, setScheduledAt] = useState(() => {
    if (!task?.scheduledAt) return "";
    const d = new Date(task.scheduledAt);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [repeat, setRepeat] = useState(task?.repeat || false);
  const [repeatMode, setRepeatMode] = useState(task?.repeatMode || "daily");
  const [repeatInterval, setRepeatInterval] = useState(task?.repeatInterval || 60);

  const handleSubmit = () => {
    if (!title.trim()) return;
    onSave({
      ...(task || {}),
      title: title.trim(),
      description,
      priority,
      assignedRole,
      assignedAgentId: assignedAgentId || null,
      triggerType,
      scheduledAt: triggerType === "scheduled" && scheduledAt ? new Date(scheduledAt).getTime() : null,
      repeat,
      repeatMode: repeat ? repeatMode : null,
      repeatInterval: repeat && repeatMode === "custom" ? Number(repeatInterval) || 60 : null,
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
          <div className="form-divider" />
          <label className="form-label">
            触发方式
            <select value={triggerType} onChange={(e) => setTriggerType(e.target.value)} className="form-select">
              {TRIGGER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>
          {triggerType === "scheduled" && (
            <label className="form-label">
              计划执行时间
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="form-input" />
            </label>
          )}
          <label className="form-label-inline">
            <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            循环执行
          </label>
          {repeat && (
            <>
              <label className="form-label">
                循环方式
                <select value={repeatMode} onChange={(e) => setRepeatMode(e.target.value)} className="form-select">
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                  <option value="custom">自定义间隔</option>
                </select>
              </label>
              {repeatMode === "custom" && (
                <label className="form-label">
                  间隔 (分钟)
                  <input type="number" value={repeatInterval} onChange={(e) => setRepeatInterval(e.target.value)} className="form-input" min={1} placeholder="60" />
                </label>
              )}
            </>
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
          <span className={`kanban-card-trigger trigger-${task.triggerType || "auto"}`}>
            {TRIGGER_TYPES.find((t) => t.value === (task.triggerType || "auto"))?.label || "自动"}
          </span>
          {task.repeat && <span className="kanban-card-repeat">
            {task.repeatMode === "weekly" ? "每周" : task.repeatMode === "custom" ? `每${task.repeatInterval}分钟` : "每天"}
          </span>}
        </div>
        {task.triggerType === "scheduled" && task.scheduledAt && (
          <div className="kanban-card-scheduled">计划: {formatTime(task.scheduledAt)}</div>
        )}
        <div className="kanban-card-info">
          <span className="kanban-card-creator">
            {task.createdBy === "user" ? "用户创建" : task.createdBy ? `由 ${agents[task.createdBy]?.name || "Agent"} 创建` : "用户创建"}
          </span>
          {task.createdAt && <span className="kanban-card-time">{formatTime(task.createdAt)}</span>}
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
      await window.electronAPI.createTask({ ...taskData, createdBy: "user" });
    }
    setShowModal(false);
    setEditingTask(null);
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
