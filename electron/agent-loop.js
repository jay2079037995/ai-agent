/**
 * Agent loop — multi-step tool-calling loop.
 * Accepts agentConfig (provider, workDir) and sessionHistory explicitly.
 */

const { BrowserWindow } = require("electron");
const { chatWithProvider } = require("./providers");
const { executeTool, gmailSendEmail, saveAndOpenWebpage } = require("./tools");
const { aiMatchSkill, matchSkill, loadAllSkills } = require("./skills");
const { getSharedKeys } = require("./store");
const path = require("path");

const AGENT_MAX_ITERATIONS = 15;

const TOOL_SYSTEM_PROMPT = `You are a helpful AI assistant with access to the following tools:

- get_current_time(): Returns the current date and time of the user's computer.
- web_search(query): Searches the web and returns top results. Use this for real-time info like weather, news, prices.
- run_shell_command(command): Executes a shell command on macOS and returns stdout/stderr.
- run_javascript(code): Evaluates a JavaScript expression and returns the result. Good for calculations.
- open_url(url): Opens a URL in the user's default browser. Use for "open browser", "open website", etc.
- open_application(name): Opens an application on macOS by name. Use for "open Finder", "open Terminal", "open Safari", etc.
- read_notes(count): Reads the latest notes from macOS Notes app. count defaults to 1. Returns note titles and content.
- create_note(title, body): Creates a new note in macOS Notes app with the given title and body text.
- create_webpage(title): Creates a webpage and opens it in the browser. Call this with a title first, then you will be asked to provide the HTML code separately. Use this when user asks to create/develop a web page, demo, or interactive HTML content.
- read_emails(count): Reads the latest emails from Gmail inbox. count defaults to 5. Returns sender, subject, date, and preview text.
- send_email(to, subject): Sends an email via Gmail. Call this with "to" (recipient email) and "subject" first, then you will be asked to provide the email body text separately.
- browser_action(action, ...): Controls Chrome browser automatically. Actions:
  - navigate(url): Opens Chrome and goes to the URL. Returns visible interactive elements with index numbers.
  - click(index): Clicks element by its index number from the elements list.
  - type(index, text): Types text into an input element by its index number.
  - key_press(key): Presses a keyboard key. key can be: Enter, Tab, Escape, Backspace, ArrowDown, ArrowUp, etc.
  - scroll(direction): Scrolls page "up" or "down".
  - read(): Re-reads the current page's interactive elements.
  - wait_for_page_change(timeout, interval): Waits for the page to change (URL, title, or content). Polls every "interval" seconds (default 5), up to "timeout" seconds (default 60). Use this when waiting for user action like QR code scan, SMS verification, or page redirect.
  - screenshot(): Takes a screenshot of the current page and saves it to a file.
  - back(): Goes back to previous page.
  - close(): Closes the browser.
  After each action, you'll receive an updated list of interactive elements with index numbers. Use these index numbers for click and type actions. Example: {"tool_call":{"name":"browser_action","args":{"action":"navigate","url":"https://google.com"}}}
- list_skills(): Lists all available automation skills from the skills/ directory.

Rules:
1. If you need real-time or local information, you MUST use a tool. Do NOT guess or make up answers.
2. To use a tool, respond with ONLY a single raw JSON object, nothing else:
   {"tool_call":{"name":"tool_name","args":{"arg1":"value1"}}}
3. After receiving a tool result, decide if you need another tool or can answer.
4. When you have enough information, respond with a plain text answer (NOT JSON).
5. Always answer in the same language as the user's question.
6. When the user asks to "open a website", "go to a page", "search on Baidu/Google", "register an account", "log in", "fill a form", or any task that involves interacting with a webpage, you MUST use browser_action. Use web_search only when you need to look up information, NOT when the user wants you to operate a browser.
7. When using browser_action, you MUST continue step by step. After navigate, read the elements list, then use click/type to interact with the page. Do NOT give up or say you cannot do it. You have full ability to control the browser. For example, to search on Baidu: first navigate to baidu.com, then type in the search box, then click the search button. To register an account: navigate to the signup page, type in each form field one by one, then click submit. Always keep going until the task is done.
8. If a page requires QR code scanning, SMS verification, CAPTCHA, or any manual user action, tell the user what to do, then use wait_for_page_change to poll until the page changes. Example flow: navigate to login page → see QR code → tell user "Please scan the QR code" → call wait_for_page_change(timeout=60, interval=5) → page changes → continue with the task.

`;

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

function sendProgress(win, agentId, type, data) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent-progress", { agentId, type, ...data });
    }
  } catch (_) {}
}

/**
 * @param {string} userPrompt
 * @param {Array} sessionHistory
 * @param {object} agentConfig - { provider: { type, apiKey, model, endpoint }, workDir }
 * @param {string} agentId
 */
async function agentLoop(userPrompt, sessionHistory, agentConfig, agentId) {
  const win = BrowserWindow.getAllWindows()[0] || null;
  const providerConfig = agentConfig.provider;
  const sharedKeys = getSharedKeys();
  const toolContext = { workDir: agentConfig.workDir, sharedKeys };

  // Phase 1: AI-driven skill matching
  sendProgress(win, agentId, "phase", { message: "Matching skills..." });
  let skill = await aiMatchSkill(userPrompt, providerConfig);

  if (!skill) {
    skill = matchSkill(userPrompt);
    if (skill) console.log(`Keyword fallback matched skill: ${skill.name}`);
  }

  if (skill) {
    sendProgress(win, agentId, "skill", { name: skill.name, description: skill.description });
  } else {
    sendProgress(win, agentId, "phase", { message: "No skill matched, using general agent mode" });
  }

  // Phase 2: Build system prompt
  let systemContent;
  if (skill) {
    systemContent =
      TOOL_SYSTEM_PROMPT +
      `\n\n=== SKILL WORKFLOW: ${skill.name} ===\n` +
      `${skill.description}\n\n` +
      `You MUST follow these steps in order. Do NOT skip steps or invent your own steps. Follow the skill workflow precisely:\n\n${skill.steps}\n\n` +
      `=== END SKILL WORKFLOW ===\n\n` +
      `User request: ${userPrompt}`;
  } else {
    systemContent = TOOL_SYSTEM_PROMPT + userPrompt;
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
  messages.push({ role: "user", content: systemContent });

  const toolTrace = [];
  if (skill) {
    toolTrace.push({ tool: "(skill matched by AI)", args: { name: skill.name, description: skill.description } });
  }
  let pendingWebpageTitle = null;
  let pendingEmail = null;

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    sendProgress(win, agentId, "iteration", { step: i + 1, max: AGENT_MAX_ITERATIONS });
    const content = await chatWithProvider(messages, providerConfig);
    const toolCall = parseToolCall(content);

    // Pending email body
    if (pendingEmail && !toolCall) {
      sendProgress(win, agentId, "tool-call", { name: "send_email", args: { to: pendingEmail.to, subject: pendingEmail.subject } });
      let result;
      try {
        result = await gmailSendEmail(sharedKeys.gmailUser, sharedKeys.gmailAppPassword, pendingEmail.to, pendingEmail.subject, content);
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
      const result = await saveAndOpenWebpage(pendingWebpageTitle, content);
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

    // Handle list_skills specially
    let toolResult;
    if (name === "list_skills") {
      const skills = loadAllSkills();
      if (skills.length === 0) {
        toolResult = "No skills found. Add .md files to the skills/ directory.";
      } else {
        toolResult = skills
          .map((s) => `- ${s.name}: ${s.description}\n  Keywords: ${s.matchKeywords.join(", ")}\n  File: ${path.basename(s.filePath)}`)
          .join("\n\n");
      }
    } else {
      toolResult = await executeTool(name, args, toolContext);
    }

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

    sendProgress(win, agentId, "tool-result", { name, result: toolResult.slice(0, 300) });
    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `Tool "${name}" returned:\n${toolResult}\n\nBased on this result, either use another tool or provide your final answer in plain text.`,
    });
  }

  messages.push({ role: "user", content: "Please provide your final answer now based on all information gathered." });
  const finalContent = await chatWithProvider(messages, providerConfig);
  return { output: finalContent, trace: toolTrace };
}

module.exports = { agentLoop, parseToolCall, TOOL_SYSTEM_PROMPT };
