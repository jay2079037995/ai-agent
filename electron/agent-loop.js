/**
 * Agent loop — multi-step tool-calling loop.
 * Dynamically builds system prompt and tool routing from installed skills.
 */

const { BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");
const { chatWithProvider } = require("./providers");
const { getAgentSkills, getAgent, ROLES } = require("./store");
const { getSkillManifest, loadSkillCode, loadWorkflow } = require("./skill-registry");
const collaboration = require("./collaboration");

const DEFAULT_MAX_ITERATIONS = 30;

// Set collaboration's agentLoop reference (deferred to avoid circular dep)
setImmediate(() => collaboration.setAgentLoop(agentLoop));

// --- Dynamic system prompt building ---

function buildSystemPrompt(agentId) {
  const agentSkills = getAgentSkills(agentId);
  const agent = getAgent(agentId);
  const role = agent?.role || "general";
  const roleConfig = ROLES[role];
  const toolDescriptions = [];
  const skillRules = [];

  for (const [skillName, skillData] of Object.entries(agentSkills)) {
    if (!skillData.installed) continue;
    const manifest = getSkillManifest(skillName);
    if (!manifest) continue;

    if ((manifest.type === "tool-provider" || manifest.type === "service") && manifest.tools && manifest.tools.length > 0) {
      for (const tool of manifest.tools) {
        const argList = Object.keys(tool.args || {}).join(", ");
        toolDescriptions.push(`- ${tool.name}(${argList}): ${tool.description}`);
      }
    }

    // Collect promptRules from installed skills
    if (manifest.promptRules && manifest.promptRules.length > 0) {
      skillRules.push(...manifest.promptRules);
    }
  }

  const agentName = agent?.name || "Assistant";
  const roleIdentity = roleConfig && roleConfig.prompt
    ? `\n\n=== 你的身份 ===\n你的名字是「${agentName}」。\n${roleConfig.prompt}\n=== 身份结束 ===\n`
    : "";

  // Add collaboration tools
  const collabDescs = collaboration.getToolDescriptions();
  toolDescriptions.push(...collabDescs);

  if (toolDescriptions.length === 0) {
    return `You are a helpful AI assistant. Answer the user's questions directly. Always answer in the same language as the user's question.${roleIdentity}`;
  }

  // Build numbered rules: base rules + skill-specific rules
  const baseRules = [
    "If you need real-time or local information, you MUST use a tool. Do NOT guess or make up answers.",
    'To use a tool, respond with ONLY a single raw JSON object, nothing else:\n   {"tool_call":{"name":"tool_name","args":{"arg1":"value1"}}}',
    "After receiving a tool result, decide if you need another tool or can answer.",
    "When you have enough information, respond with a plain text answer (NOT JSON).",
    "Always answer in the same language as the user's question.",
  ];
  const allRules = [...baseRules, ...skillRules];
  const rulesText = allRules.map((r, i) => `${i + 1}. ${r}`).join("\n");

  return `You are a helpful AI assistant with access to the following tools:

${toolDescriptions.join("\n")}

Rules:
${rulesText}
${roleIdentity}
`;
}

// --- Tool routing ---

function buildToolRouter(agentId) {
  const agentSkills = getAgentSkills(agentId);
  const router = {}; // { toolName: { skillName, manifest } }

  for (const [skillName, skillData] of Object.entries(agentSkills)) {
    if (!skillData.installed) continue;
    const manifest = getSkillManifest(skillName);
    if (!manifest) continue;
    if (manifest.type !== "tool-provider" && !(manifest.type === "service" && manifest.tools?.length > 0)) continue;

    for (const tool of (manifest.tools || [])) {
      router[tool.name] = { skillName, manifest };
    }
  }

  return router;
}

async function executeToolViaSkill(toolName, args, router, context) {
  // Check collaboration tools first
  if (collaboration.isCollaborationTool(toolName)) {
    return await collaboration.executeCollaborationTool(toolName, args, context.agentId);
  }

  const route = router[toolName];
  if (!route) return `Error: Unknown tool "${toolName}". This tool is not available with current skills.`;

  const code = loadSkillCode(route.skillName);
  if (!code || !code.executeTool) {
    return `Error: Skill "${route.skillName}" has no executeTool function.`;
  }

  const agentSkills = context.agentSkills || {};
  const skillConfig = agentSkills[route.skillName]?.config || {};
  const toolContext = { ...context, config: skillConfig };

  return await code.executeTool(toolName, args, toolContext);
}

// --- Workflow matching ---

function matchWorkflowSkill(userPrompt, agentId) {
  const agentSkills = getAgentSkills(agentId);
  const lower = userPrompt.toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const [skillName, skillData] of Object.entries(agentSkills)) {
    if (!skillData.installed) continue;
    const manifest = getSkillManifest(skillName);
    if (!manifest || manifest.type !== "workflow") continue;

    const keywords = manifest.matchKeywords || [];
    const hits = keywords.filter((k) => lower.includes(k)).length;
    if (hits >= 2 && hits > bestScore) {
      bestScore = hits;
      best = { skillName, manifest };
    }
  }

  return best;
}

async function aiMatchWorkflowSkill(userPrompt, agentId, providerConfig) {
  const agentSkills = getAgentSkills(agentId);
  const workflows = [];

  for (const [skillName, skillData] of Object.entries(agentSkills)) {
    if (!skillData.installed) continue;
    const manifest = getSkillManifest(skillName);
    if (!manifest || manifest.type !== "workflow") continue;
    workflows.push({ skillName, manifest });
  }

  if (workflows.length === 0) return null;

  const summaries = workflows
    .map((w, i) => `[${i}] ${w.manifest.displayName} — ${w.manifest.description}`)
    .join("\n");

  const matchPrompt = `You are a skill-matching assistant. The user wants to perform a task. Below is a list of available automation workflows.

Your job: Decide which workflow (if any) is the best match for the user's task. If a workflow is clearly relevant, respond with ONLY its index number (e.g. "0" or "2"). If no workflow is relevant, respond with ONLY the word "none".

Do NOT explain. Do NOT output anything other than the index number or "none".

Available workflows:
${summaries}

User task: ${userPrompt}

Your answer:`;

  try {
    const { content: response } = await chatWithProvider([{ role: "user", content: matchPrompt }], providerConfig);
    const answer = response.trim().toLowerCase();
    console.log(`AI workflow matching response: "${answer}"`);

    if (answer === "none" || answer.includes("none")) return null;

    const indexMatch = answer.match(/(\d+)/);
    if (!indexMatch) return null;
    const idx = parseInt(indexMatch[1]);
    if (idx < 0 || idx >= workflows.length) return null;

    console.log(`AI matched workflow: [${idx}] ${workflows[idx].manifest.displayName}`);
    return workflows[idx];
  } catch (e) {
    console.log(`AI workflow matching failed: ${e.message}, falling back to keyword matching`);
    return matchWorkflowSkill(userPrompt, agentId);
  }
}

// --- JSON tool call parser ---

function parseToolCall(content) {
  const stripped = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  if (!stripped.includes("tool_call")) return null;

  const start = stripped.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }

  const candidates = [];
  if (end !== -1) candidates.push(stripped.slice(start, end + 1));
  candidates.push(stripped.slice(start));

  for (const raw of candidates) {
    const fixed = raw.replace(/[\n\r\t]/g, (ch) =>
      ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t"
    );
    for (const str of [raw, fixed]) {
      for (let extra = 0; extra <= 3; extra++) {
        try {
          const parsed = JSON.parse(str + "}".repeat(extra));
          if (parsed.tool_call && typeof parsed.tool_call.name === "string") {
            return parsed.tool_call;
          }
        } catch (_) {}
      }
    }
  }

  const nameMatch = stripped.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    const name = nameMatch[1];
    const argsMatch = stripped.match(/"args"\s*:\s*\{([^]*)\}\s*\}?\s*\}?\s*$/);
    if (argsMatch) {
      try {
        const args = JSON.parse(
          "{" + argsMatch[1].replace(/[\n\r\t]/g, (ch) =>
            ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t"
          ) + "}"
        );
        return { name, args };
      } catch (_) {}
    }
    return { name, args: {} };
  }

  return null;
}

// --- Progress helper ---

function sendProgress(win, agentId, type, data) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent-progress", { agentId, type, ...data });
    }
  } catch (_) {}
  // Also update task execution tracking (if this agent is working on a task)
  collaboration.updateTaskExecution(agentId, { type, ...data });
}

// --- Main agent loop ---

async function agentLoop(userPrompt, sessionHistory, agentConfig, agentId, attachments = []) {
  const win = BrowserWindow.getAllWindows()[0] || null;
  const providerConfig = agentConfig.provider;
  const agentSkills = agentConfig.skills || {};
  const toolContext = { workDir: agentConfig.workDir, agentSkills, agentId };
  const router = buildToolRouter(agentId);

  // Phase 1: Workflow matching
  sendProgress(win, agentId, "phase", { message: "Matching workflows..." });
  let workflow = await aiMatchWorkflowSkill(userPrompt, agentId, providerConfig);

  if (!workflow) {
    workflow = matchWorkflowSkill(userPrompt, agentId);
    if (workflow) console.log(`Keyword fallback matched workflow: ${workflow.manifest.displayName}`);
  }

  if (workflow) {
    sendProgress(win, agentId, "skill", { name: workflow.manifest.displayName, description: workflow.manifest.description });
  } else {
    sendProgress(win, agentId, "phase", { message: "No workflow matched, using general agent mode" });
  }

  // Phase 2: Build system prompt
  let systemContent;
  const basePrompt = buildSystemPrompt(agentId);

  if (workflow) {
    const workflowContent = loadWorkflow(workflow.skillName) || "";
    systemContent =
      basePrompt +
      `\n\n=== SKILL WORKFLOW: ${workflow.manifest.displayName} ===\n` +
      `${workflow.manifest.description}\n\n` +
      `You MUST follow these steps in order. Do NOT skip steps or invent your own steps. Follow the skill workflow precisely:\n\n${workflowContent}\n\n` +
      `=== END SKILL WORKFLOW ===\n\n` +
      `User request: ${userPrompt}`;
  } else {
    systemContent = basePrompt + userPrompt;
  }

  const messages = [];
  if (sessionHistory.length > 0) {
    let historySlice = sessionHistory.slice(-10);
    if (historySlice.length > 0 && historySlice[0].role !== "user") {
      historySlice = historySlice.slice(1);
    }
    for (const msg of historySlice) {
      messages.push({ role: msg.role, content: msg.content });
    }
  }
  // Process user attachments: text files → appended to content, images → images field
  const imageAttachments = attachments.filter((a) => a.type === "image");
  const textAttachments = attachments.filter((a) => a.type === "text");

  let augmentedContent = systemContent;
  if (textAttachments.length > 0) {
    augmentedContent += "\n\n=== Attached Files ===\n";
    for (const att of textAttachments) {
      augmentedContent += `\n--- ${att.name} ---\n${att.textContent}\n`;
    }
    augmentedContent += "=== End Attached Files ===\n";
  }

  const userMessage = { role: "user", content: augmentedContent };
  if (imageAttachments.length > 0) {
    userMessage.images = imageAttachments.map((att) => ({
      base64: att.data,
      mediaType: att.mimeType,
      fileName: att.name,
    }));
    for (const att of imageAttachments) {
      const sizeKB = Math.round((att.data.length * 3) / 4 / 1024);
      console.log(`[vision] User attached image: ${att.name} (${sizeKB} KB, ${att.mimeType})`);
    }
  }
  messages.push(userMessage);

  const toolTrace = [];
  if (workflow) {
    toolTrace.push({ tool: "(workflow matched)", args: { name: workflow.manifest.displayName, description: workflow.manifest.description } });
  }
  let pendingWebpageTitle = null;
  let pendingEmail = null;

  const maxIter = agentConfig.maxIterations || DEFAULT_MAX_ITERATIONS;
  for (let i = 0; i < maxIter; i++) {
    // Check if task was cancelled (e.g. deleted from kanban)
    if (collaboration.isAgentCancelled(agentId)) {
      return { output: "[任务已取消]", trace: toolTrace };
    }
    sendProgress(win, agentId, "iteration", { step: i + 1 });

    let content, reasoning;
    try {
      ({ content, reasoning } = await chatWithProvider(messages, providerConfig));
    } catch (err) {
      // If messages contain images and the call failed, retry without images
      // (model may not support vision)
      const hasImages = messages.some((m) => m.images && m.images.length > 0);
      if (hasImages) {
        console.log(`chatWithProvider failed with images, retrying text-only: ${err.message}`);
        sendProgress(win, agentId, "phase", { message: "当前模型不支持图片识别，将以纯文本模式重试。如需图片分析，请更换支持 vision 的模型。" });
        const textOnly = messages.map(({ images, ...rest }) => {
          if (images && images.length > 0) {
            const names = images.map((img, idx) => img.fileName || `image_${idx + 1}`);
            const notice = `\n\n[注意：用户附加了 ${images.length} 张图片（${names.join("、")}），但当前模型不支持图片识别，无法查看图片内容。请告知用户需要使用支持 vision 的模型才能分析图片。]`;
            return { ...rest, content: rest.content + notice };
          }
          return rest;
        });
        ({ content, reasoning } = await chatWithProvider(textOnly, providerConfig));
      } else {
        throw err;
      }
    }
    if (reasoning) {
      sendProgress(win, agentId, "reasoning", { text: reasoning });
    }
    const toolCall = parseToolCall(content);

    // Pending email body
    if (pendingEmail && !toolCall) {
      sendProgress(win, agentId, "tool-call", { name: "send_email", args: { to: pendingEmail.to, subject: pendingEmail.subject } });
      let result;
      try {
        const emailCode = loadSkillCode("email");
        if (emailCode && emailCode.gmailSendEmail) {
          const emailConfig = agentSkills["email"]?.config || {};
          result = await emailCode.gmailSendEmail(emailConfig.gmailUser, emailConfig.gmailAppPassword, pendingEmail.to, pendingEmail.subject, content);
        } else {
          result = "Error: Email skill not available.";
        }
      } catch (e) {
        result = `Gmail send error: ${e.message}`;
      }
      sendProgress(win, agentId, "tool-result", { name: "send_email", result: result.slice(0, 200) });
      toolTrace.push({ tool: "send_email (sent)", args: { to: pendingEmail.to, subject: pendingEmail.subject } });
      pendingEmail = null;
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `${result}\n\nNow provide your final answer to the user in plain text.` });
      continue;
    }

    // Pending webpage HTML
    if (pendingWebpageTitle && !toolCall) {
      sendProgress(win, agentId, "tool-call", { name: "create_webpage", args: { title: pendingWebpageTitle } });
      const webpageCode = loadSkillCode("webpage");
      let result;
      if (webpageCode && webpageCode.saveAndOpenWebpage) {
        result = await webpageCode.saveAndOpenWebpage(pendingWebpageTitle, content);
      } else {
        result = "Error: Webpage skill not available.";
      }
      sendProgress(win, agentId, "tool-result", { name: "create_webpage", result: result.slice(0, 200) });
      toolTrace.push({ tool: "create_webpage (saved)", args: { title: pendingWebpageTitle } });
      pendingWebpageTitle = null;
      messages.push({ role: "assistant", content });
      messages.push({ role: "user", content: `${result}\n\nNow provide your final answer to the user in plain text.` });
      continue;
    }

    if (!toolCall) {
      if (content.includes("tool_call")) {
        toolTrace.push({ tool: "(parse_error)", args: { raw: content.slice(0, 200) } });
        messages.push({ role: "assistant", content });
        messages.push({
          role: "user",
          content: 'Your tool call JSON was malformed and could not be parsed. Please output ONLY a valid JSON object in this exact format, with NO extra text before or after:\n{"tool_call":{"name":"tool_name","args":{"arg1":"value1"}}}\nMake sure all strings are properly escaped and the JSON is on a single line.',
        });
        continue;
      }
      return { output: content, trace: toolTrace };
    }

    const { name, args = {} } = toolCall;
    toolTrace.push({ tool: name, args });
    sendProgress(win, agentId, "tool-call", { name, args });

    // Execute tool via skill router
    const toolResult = await executeToolViaSkill(name, args, router, toolContext);

    if (toolResult === "__WEBPAGE_PENDING__") {
      pendingWebpageTitle = args.title || "page";
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Webpage "${pendingWebpageTitle}" is ready to be created. Now output ONLY the complete HTML code starting with <!DOCTYPE html>. Do NOT wrap it in JSON or code fences. Output raw HTML only.`,
      });
      continue;
    }

    if (toolResult === "__EMAIL_PENDING__") {
      pendingEmail = { to: args.to || args.recipient || "", subject: args.subject || "(no subject)" };
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Email to "${pendingEmail.to}" with subject "${pendingEmail.subject}" is ready. Now output ONLY the email body text. Do NOT wrap it in JSON or code fences. Output plain text only.`,
      });
      continue;
    }

    // Tool result can be a string or an object { text, images: [{path}] }
    let resultText = toolResult;
    let resultImages = null;
    if (typeof toolResult === "object" && toolResult !== null) {
      resultText = toolResult.text || JSON.stringify(toolResult);
      resultImages = toolResult.images || null;
    }

    sendProgress(win, agentId, "tool-result", { name, result: resultText.slice(0, 300) });
    messages.push({ role: "assistant", content });

    const userMsg = {
      role: "user",
      content: `Tool "${name}" returned:\n${resultText}\n\nBased on this result, either use another tool or provide your final answer in plain text.`,
    };

    // Attach images from tool result (e.g. screenshots) for vision-capable models
    if (resultImages && resultImages.length > 0) {
      userMsg.images = [];
      for (const img of resultImages) {
        const imgPath = img.path || img;
        try {
          const data = fs.readFileSync(imgPath);
          const base64 = data.toString("base64");
          const ext = path.extname(imgPath).toLowerCase();
          const mediaType = ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
          userMsg.images.push({ base64, mediaType, fileName: path.basename(imgPath) });
          const sizeKB = Math.round(data.length / 1024);
          console.log(`[vision] Attached image: ${imgPath} (${sizeKB} KB, ${mediaType})`);
        } catch (e) {
          console.log(`[vision] Failed to read image ${imgPath}: ${e.message}`);
        }
      }
      if (userMsg.images.length === 0) delete userMsg.images;
    }

    messages.push(userMsg);
  }

  messages.push({ role: "user", content: "Please provide your final answer now based on all information gathered." });
  const { content: finalContent } = await chatWithProvider(messages, providerConfig);
  return { output: finalContent, trace: toolTrace };
}

module.exports = { agentLoop, parseToolCall, buildSystemPrompt, buildToolRouter };
