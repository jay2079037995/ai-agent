/**
 * Collaboration module — inter-agent communication and shared task tools.
 * These tools are injected into every agent's system prompt alongside skill tools.
 */

const { BrowserWindow } = require("electron");
const {
  getAllAgents,
  getAgent,
  ROLES,
  createTask,
  getAllTasks,
  updateTask,
  pushAgentMessage,
} = require("./store");

// Lazy reference to agentLoop (set at init to break circular dependency)
let _agentLoop = null;

function setAgentLoop(fn) {
  _agentLoop = fn;
}

// Track dispatched task IDs to avoid re-dispatching
const _dispatchedTasks = new Set();
// Track agents currently busy processing a task
const _busyAgents = new Set();

// Task execution status: taskId → { agentId, agentName, step, toolName, status }
// status: "running" | "completed" | "failed"
const _taskExecutions = {};
// Reverse map: agentId → taskId (for progress event correlation)
const _agentTaskMap = {};
// Cancelled tasks — agent loop checks this to abort early
const _cancelledAgents = new Set();

// Tool descriptions injected into system prompt
const COLLABORATION_TOOLS = [
  {
    name: "send_message_to_agent",
    description: "Send a message to another agent for collaboration. The target agent will process your message asynchronously.",
    args: { agentId: "string", message: "string" },
  },
  {
    name: "create_task",
    description: "Create a task on the kanban board. Use assignedRole to assign to a role. triggerType: auto (default), scheduled, or manual.",
    args: { title: "string", description: "string", priority: "string (low/medium/high)", assignedRole: "string (general/pm/developer/tester)", triggerType: "string (auto/scheduled/manual)", scheduledAt: "number (timestamp ms, for scheduled)", repeat: "boolean", repeatInterval: "number (minutes)" },
  },
  {
    name: "update_task",
    description: "Update a task's status. Status can be: backlog, in_progress, done.",
    args: { taskId: "string", status: "string (backlog/in_progress/done)" },
  },
  {
    name: "list_tasks",
    description: "List all tasks. Optionally filter by status or assignedRole.",
    args: { status: "string (optional)", assignedRole: "string (optional)" },
  },
  {
    name: "list_agents",
    description: "List all available agents with their IDs, names, and roles.",
    args: {},
  },
];

const COLLAB_TOOL_NAMES = new Set(COLLABORATION_TOOLS.map((t) => t.name));

function isCollaborationTool(toolName) {
  return COLLAB_TOOL_NAMES.has(toolName);
}

function getToolDescriptions() {
  return COLLABORATION_TOOLS.map((t) => {
    const argList = Object.keys(t.args).join(", ");
    return `- ${t.name}(${argList}): ${t.description}`;
  });
}

// Broadcast tasks-updated to all windows
function broadcastTasksUpdated() {
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send("tasks-updated"); } catch (_) {}
  });
}

// Broadcast task-execution-updated to all windows
function broadcastTaskExecutionUpdated() {
  const snapshot = { ..._taskExecutions };
  BrowserWindow.getAllWindows().forEach((w) => {
    try { w.webContents.send("task-execution-updated", snapshot); } catch (_) {}
  });
}

/**
 * Called from agent-loop whenever a progress event is emitted.
 * Correlates agentId → taskId and updates execution status.
 */
function updateTaskExecution(agentId, progressData) {
  const taskId = _agentTaskMap[agentId];
  if (!taskId) return; // agent is not working on a tracked task

  const exec = _taskExecutions[taskId];
  if (!exec || exec.status !== "running") return;

  if (progressData.type === "iteration") {
    exec.step = progressData.step;
  } else if (progressData.type === "tool-call") {
    exec.toolName = progressData.name;
  } else if (progressData.type === "tool-result") {
    exec.toolName = null; // tool finished
  }

  broadcastTaskExecutionUpdated();
}

function getTaskExecutions() {
  return { ..._taskExecutions };
}

/**
 * Cancel a running task — marks the agent for early abort.
 * Called when a task is deleted from the kanban board.
 */
function cancelTask(taskId) {
  const exec = _taskExecutions[taskId];
  if (exec && exec.status === "running") {
    _cancelledAgents.add(exec.agentId);
    exec.status = "cancelled";
    broadcastTaskExecutionUpdated();
    // Clean up maps
    delete _agentTaskMap[exec.agentId];
    _busyAgents.delete(exec.agentId);
    _dispatchedTasks.delete(taskId);
  }
  delete _taskExecutions[taskId];
}

/**
 * Check if an agent's current task has been cancelled.
 * Called from agent-loop at each iteration.
 */
function isAgentCancelled(agentId) {
  return _cancelledAgents.has(agentId);
}

/**
 * Clear cancellation flag after agent loop exits.
 */
function clearAgentCancelled(agentId) {
  _cancelledAgents.delete(agentId);
}

/**
 * Auto-dispatch: find an agent matching the task's role and trigger it.
 * If assignedAgentId is set, use that agent directly.
 * Otherwise, find the first agent with the matching role.
 */
function dispatchTaskToAgent(task) {
  if (!_agentLoop) return;
  if (_dispatchedTasks.has(task.id)) return;

  let targetAgent = null;

  // Prefer specific agent
  if (task.assignedAgentId) {
    targetAgent = getAgent(task.assignedAgentId);
  }

  // Fallback: find an agent with the matching role that is not busy
  if (!targetAgent && task.assignedRole) {
    const agents = getAllAgents();
    targetAgent = Object.values(agents).find(
      (a) => a.role === task.assignedRole && !_busyAgents.has(a.id)
    );
    // If all matching agents are busy, skip for now (scanner will retry later)
    if (!targetAgent) return;
  }

  if (!targetAgent) return;
  if (_busyAgents.has(targetAgent.id)) return;

  // Mark task as dispatched and agent as busy
  _dispatchedTasks.add(task.id);
  _busyAgents.add(targetAgent.id);

  // Track execution status
  _taskExecutions[task.id] = {
    agentId: targetAgent.id,
    agentName: targetAgent.name,
    step: 0,
    toolName: null,
    status: "running",
  };
  _agentTaskMap[targetAgent.id] = task.id;
  broadcastTaskExecutionUpdated();

  // Auto-move task to in_progress and record start time
  if (task.status === "backlog") {
    updateTask(task.id, { status: "in_progress", startedAt: Date.now() });
    broadcastTasksUpdated();
  }

  const roleLabel = ROLES[targetAgent.role]?.label || targetAgent.role;
  const prompt = `[新任务分配给你] 任务标题: ${task.title}\n任务描述: ${task.description || "(无描述)"}\n优先级: ${task.priority}\n任务ID: ${task.id}\n\n请根据你的角色（${roleLabel}）处理这个任务。任务状态会自动更新，你只需专注于完成任务内容。如需与其他 agent 协作，可使用 send_message_to_agent。`;

  setImmediate(async () => {
    try {
      console.log(`Auto-dispatching task "${task.title}" to agent "${targetAgent.name}" (${targetAgent.role})`);
      await _agentLoop(prompt, [], targetAgent, targetAgent.id);

      // If task was cancelled during execution, skip completion and repeat
      if (_cancelledAgents.has(targetAgent.id)) {
        console.log(`Task "${task.title}" was cancelled, skipping completion.`);
        return;
      }

      // Mark completed and auto-move to done
      const now = Date.now();
      if (_taskExecutions[task.id]) {
        _taskExecutions[task.id].status = "completed";
        _taskExecutions[task.id].toolName = null;
        broadcastTaskExecutionUpdated();
      }
      // Repeat: move to repeat_queue with nextRunAt instead of done
      if (task.repeat) {
        const repeatMode = task.repeatMode || "daily";
        const INTERVAL_MAP = { daily: 24 * 60, weekly: 7 * 24 * 60 };
        const intervalMinutes = repeatMode === "custom" ? (task.repeatInterval || 60) : (INTERVAL_MAP[repeatMode] || INTERVAL_MAP.daily);
        const intervalMs = intervalMinutes * 60 * 1000;

        let nextRunAt;
        if (task.triggerType === "scheduled" && task.scheduledAt) {
          nextRunAt = task.scheduledAt + intervalMs;
          while (nextRunAt <= now) {
            nextRunAt += intervalMs;
          }
        } else {
          nextRunAt = now + intervalMs;
        }

        updateTask(task.id, { status: "repeat_queue", completedAt: now, nextRunAt });
        _dispatchedTasks.delete(task.id);
      } else {
        updateTask(task.id, { status: "done", completedAt: now });
      }
      broadcastTasksUpdated();
    } catch (e) {
      console.log(`Task dispatch to agent ${targetAgent.id} failed: ${e.message}`);
      if (_taskExecutions[task.id]) {
        _taskExecutions[task.id].status = "failed";
        broadcastTaskExecutionUpdated();
      }
    } finally {
      _busyAgents.delete(targetAgent.id);
      delete _agentTaskMap[targetAgent.id];
      clearAgentCancelled(targetAgent.id);
    }
  });
}

async function executeCollaborationTool(toolName, args, callingAgentId) {
  switch (toolName) {
    case "list_agents": {
      const agents = getAllAgents();
      const list = Object.values(agents).map((a) => ({
        id: a.id,
        name: a.name,
        role: a.role || "general",
        roleLabel: ROLES[a.role]?.label || "通用",
      }));
      return JSON.stringify(list, null, 2);
    }

    case "list_tasks": {
      const tasks = getAllTasks();
      let list = Object.values(tasks);
      if (args.status) list = list.filter((t) => t.status === args.status);
      if (args.assignedRole) list = list.filter((t) => t.assignedRole === args.assignedRole);
      list.sort((a, b) => b.createdAt - a.createdAt);
      const result = list.map((t) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        assignedRole: t.assignedRole,
        assignedAgentId: t.assignedAgentId,
      }));
      return JSON.stringify(result, null, 2);
    }

    case "create_task": {
      const task = createTask({
        title: args.title || "Untitled",
        description: args.description || "",
        priority: args.priority || "medium",
        assignedRole: args.assignedRole || "general",
        assignedAgentId: args.assignedAgentId || null,
        createdBy: callingAgentId,
        triggerType: args.triggerType || "auto",
        scheduledAt: args.scheduledAt || null,
        repeat: args.repeat || false,
        repeatMode: args.repeatMode || "daily",
        repeatInterval: args.repeatInterval || null,
      });
      broadcastTasksUpdated();
      return `Task created: ${task.title} (id: ${task.id}, role: ${task.assignedRole}, trigger: ${task.triggerType}). Use send_message_to_agent to notify the assigned agent if needed.`;
    }

    case "update_task": {
      if (!args.taskId) return "Error: taskId is required.";
      const updates = {};
      if (args.status) updates.status = args.status;
      if (args.title) updates.title = args.title;
      if (args.description) updates.description = args.description;
      if (args.priority) updates.priority = args.priority;
      if (args.assignedRole) updates.assignedRole = args.assignedRole;
      const task = updateTask(args.taskId, updates);
      if (!task) return `Error: Task "${args.taskId}" not found.`;
      broadcastTasksUpdated();
      return `Task updated: ${task.title} → status: ${task.status}`;
    }

    case "send_message_to_agent": {
      if (!args.agentId) return "Error: agentId is required.";
      if (!args.message) return "Error: message is required.";
      const target = getAgent(args.agentId);
      if (!target) return `Error: Agent "${args.agentId}" not found.`;

      // Store the message
      pushAgentMessage(args.agentId, callingAgentId, args.message);

      // Fire-and-forget: trigger the target agent to process the message asynchronously
      if (_agentLoop) {
        const sender = getAgent(callingAgentId);
        const senderName = sender?.name || callingAgentId;
        const prompt = `[Message from agent "${senderName}" (role: ${sender?.role || "general"})]: ${args.message}`;

        setImmediate(async () => {
          try {
            await _agentLoop(prompt, [], target, args.agentId);
          } catch (e) {
            console.log(`Collaboration message to ${args.agentId} failed: ${e.message}`);
          }
        });
      }

      return `Message sent to agent "${target.name}" (${target.role || "general"}). They will process it asynchronously.`;
    }

    default:
      return `Error: Unknown collaboration tool "${toolName}".`;
  }
}

// --- Task scanner ---
// Periodically scans backlog tasks and dispatches to matching agents.

let _scanInterval = null;
const SCAN_INTERVAL_MS = 30_000;

function scanAndDispatchTasks() {
  if (!_agentLoop) return;
  const tasks = getAllTasks();
  const now = Date.now();

  // 1. Promote repeat_queue tasks whose nextRunAt has arrived back to backlog
  for (const t of Object.values(tasks)) {
    if (t.status !== "repeat_queue") continue;
    if (!t.nextRunAt || t.nextRunAt > now) continue;
    // Reset execution fields and move back to backlog for re-dispatch
    updateTask(t.id, { status: "backlog", startedAt: null, completedAt: null, nextRunAt: null });
    _dispatchedTasks.delete(t.id);
  }

  // Re-read tasks after potential promotions
  const freshTasks = getAllTasks();

  // 2. Dispatch backlog tasks
  const dispatchable = Object.values(freshTasks)
    .filter((t) => {
      if (t.status !== "backlog") return false;
      if (_dispatchedTasks.has(t.id)) return false;
      if (!t.assignedRole) return false;

      const triggerType = t.triggerType || "auto";
      if (triggerType === "manual") return false;
      if (t.scheduledAt && t.scheduledAt > now) return false;
      if (triggerType === "scheduled" && !t.scheduledAt) return false;

      return true;
    })
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 };
      return (p[a.priority] ?? 1) - (p[b.priority] ?? 1) || a.createdAt - b.createdAt;
    });

  for (const task of dispatchable) {
    dispatchTaskToAgent(task);
  }
  // Broadcast if any repeat_queue tasks were promoted
  broadcastTasksUpdated();
}

function startTaskScanner() {
  if (_scanInterval) return;
  console.log(`Task scanner started (${SCAN_INTERVAL_MS / 1000}s interval)`);
  setTimeout(scanAndDispatchTasks, 5000);
  _scanInterval = setInterval(scanAndDispatchTasks, SCAN_INTERVAL_MS);
}

function stopTaskScanner() {
  if (_scanInterval) {
    clearInterval(_scanInterval);
    _scanInterval = null;
  }
}

module.exports = {
  COLLABORATION_TOOLS,
  isCollaborationTool,
  getToolDescriptions,
  executeCollaborationTool,
  dispatchTaskToAgent,
  setAgentLoop,
  startTaskScanner,
  stopTaskScanner,
  updateTaskExecution,
  getTaskExecutions,
  cancelTask,
  isAgentCancelled,
};
