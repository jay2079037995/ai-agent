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

// Tool descriptions injected into system prompt
const COLLABORATION_TOOLS = [
  {
    name: "send_message_to_agent",
    description: "Send a message to another agent for collaboration. The target agent will process your message asynchronously.",
    args: { agentId: "string", message: "string" },
  },
  {
    name: "create_task",
    description: "Create a task on the kanban board. Use assignedRole to assign to a role (pm/developer/tester).",
    args: { title: "string", description: "string", priority: "string (low/medium/high)", assignedRole: "string (general/pm/developer/tester)" },
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
      });
      broadcastTasksUpdated();
      return `Task created: ${task.title} (id: ${task.id}, role: ${task.assignedRole}, priority: ${task.priority})`;
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

module.exports = {
  COLLABORATION_TOOLS,
  isCollaborationTool,
  getToolDescriptions,
  executeCollaborationTool,
  setAgentLoop,
};
