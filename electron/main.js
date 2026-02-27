const { app, BrowserWindow, ipcMain, net, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const vm = require("vm");
const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");
const TelegramBot = require("node-telegram-bot-api");

const BRAVE_API_KEY = "BSA0GYIcNd1ciSkOYGhRyNQs5Tsz-C3";
const MINIMAX_API_KEY = "sk-api-P76aWsGVn-Qp9VHe1iQfs6YYz4ERo0tUOsiGN3IeTw-k-wMv5g_zllmlFmsDMEUBcXaGlgTBnYJw_becFR7sJ5qMNSO0WuM6eaQGDmgjOK-dEjBxAVvIdLE";
const GMAIL_USER = "279037995jay@gmail.com";
const GMAIL_APP_PASSWORD = "njvdueefexcyhdly";
const AGENT_MAX_ITERATIONS = 15;
const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHELL_TIMEOUT_MS = 10000;
const JS_TIMEOUT_MS = 5000;
const TELEGRAM_BOT_TOKEN = "8798525472:AAGQXR4eZFFE79rLVHlmHCZ1G7RaAig3Qtg"; // 替换为你的 Telegram Bot Token

// --- Model switching ---
let currentModel = "minimax"; // "ollama" or "minimax"

// --- Chat session history ---
const MAX_SESSION_MESSAGES = 40; // keep last 40 messages (20 rounds)
let chatSessionHistory = [];

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile(path.join(__dirname, "../dist/index.html"));
}

// --- Shell command execution ---

ipcMain.handle("exec-command", (event, command) => {
  return new Promise((resolve) => {
    const shell = process.platform === "win32" ? "cmd" : "/bin/bash";
    const args = process.platform === "win32" ? ["/c", command] : ["-c", command];

    const child = spawn(shell, args, {
      cwd: process.env.HOME,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, code });
    });

    child.on("error", (err) => {
      resolve({ stdout: "", stderr: err.message, code: -1 });
    });
  });
});

// --- Brave Search ---

async function braveSearch(query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
  const response = await net.fetch(url, {
    headers: { "X-Subscription-Token": BRAVE_API_KEY, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }
  const data = await response.json();
  return (data.web?.results || []).slice(0, 8).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description || "",
  }));
}

// --- Ollama ---

async function ollamaGenerate(prompt) {
  const response = await net.fetch("http://127.0.0.1:11434/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma3:4b", prompt, stream: false }),
  });
  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }
  const data = await response.json();
  return data.response || "";
}

async function ollamaChat(messages) {
  const response = await net.fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gemma3:4b", messages, stream: false }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat error: ${response.status}`);
  }
  const data = await response.json();
  return data.message?.content || "";
}

// --- Gmail ---

const gmailTransporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

function gmailReadEmails(count = 5) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: GMAIL_USER,
      password: GMAIL_APP_PASSWORD,
      host: "imap.gmail.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    const results = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err) => {
        if (err) { imap.end(); return reject(err); }
        imap.search(["ALL"], (err, uids) => {
          if (err) { imap.end(); return reject(err); }
          if (!uids || uids.length === 0) { imap.end(); return resolve("No emails found."); }

          const latest = uids.slice(-count);
          const f = imap.fetch(latest, { bodies: "", struct: true });

          f.on("message", (msg) => {
            msg.on("body", (stream) => {
              simpleParser(stream, (err, parsed) => {
                if (err) return;
                results.push({
                  from: parsed.from?.text || "",
                  subject: parsed.subject || "(no subject)",
                  date: parsed.date?.toLocaleString("zh-CN") || "",
                  text: (parsed.text || "").slice(0, 500),
                });
              });
            });
          });

          f.once("end", () => {
            setTimeout(() => {
              imap.end();
              if (results.length === 0) return resolve("No emails parsed.");
              resolve(results.map((r, i) =>
                `--- Email ${i + 1} ---\nFrom: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\n${r.text}`
              ).join("\n\n"));
            }, 1000);
          });
        });
      });
    });

    imap.once("error", (err) => reject(err));
    imap.connect();
  });
}

async function gmailSendEmail(to, subject, body) {
  const info = await gmailTransporter.sendMail({
    from: GMAIL_USER,
    to,
    subject,
    text: body,
  });
  return `Email sent successfully. Message ID: ${info.messageId}`;
}

// --- MiniMax (Anthropic Messages API) ---

async function minimaxChat(messages) {
  const response = await net.fetch("https://api.minimaxi.com/anthropic/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": MINIMAX_API_KEY,
      "anthropic-version": "2024-06-20",
    },
    body: JSON.stringify({
      model: "MiniMax-M2.5",
      max_tokens: 8192,
      messages,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`MiniMax error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  // Anthropic format: { content: [{ type: "text", text: "..." }] }
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock?.text || "";
}

// --- Unified chat interface ---

async function chatWithModel(messages) {
  if (currentModel === "minimax") {
    return minimaxChat(messages);
  }
  return ollamaChat(messages);
}

// --- Browser automation (Puppeteer) ---

let browserInstance = null;
let browserPage = null;

async function launchBrowser() {
  if (browserInstance && browserPage) return;
  browserInstance = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: false,
    defaultViewport: null,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  const pages = await browserInstance.pages();
  browserPage = pages[0] || await browserInstance.newPage();
  browserInstance.on("disconnected", () => {
    browserInstance = null;
    browserPage = null;
  });
}

async function getPageElements() {
  if (!browserPage) return "Browser is not open.";
  const title = await browserPage.title();
  const url = browserPage.url();

  const elements = await browserPage.evaluate(() => {
    const selectors = "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
    const nodes = document.querySelectorAll(selectors);
    const results = [];
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top > window.innerHeight + 200) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;

      const tag = el.tagName.toLowerCase();
      let desc = "";
      if (tag === "input" || tag === "textarea") {
        const inputType = el.type || "text";
        const val = el.value ? ` value="${el.value.slice(0, 30)}"` : "";
        const ph = el.placeholder ? ` "${el.placeholder}"` : "";
        const label = el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : "";
        desc = `input(${inputType})${ph}${label}${val}`;
      } else if (tag === "select") {
        const opts = Array.from(el.options).slice(0, 5).map(o => o.text.slice(0, 20)).join(", ");
        desc = `select: [${opts}]`;
      } else {
        const text = (el.textContent || "").trim().slice(0, 60);
        const aria = el.getAttribute("aria-label") || "";
        desc = `${tag}: "${text || aria || "(empty)"}"`;
      }
      results.push(desc);
      if (results.length >= 50) break;
    }
    return results;
  });

  let output = `Page: ${title}\nURL: ${url}\n\nInteractive elements:\n`;
  elements.forEach((desc, i) => {
    output += `[${i}] ${desc}\n`;
  });
  if (elements.length === 0) {
    output += "(no interactive elements found)\n";
  }
  return output;
}

async function executeBrowserAction(action, args) {
  try {
    switch (action) {
      case "navigate": {
        const url = args.url || "";
        if (!url) return "Error: navigate requires a 'url' argument.";
        await launchBrowser();
        const target = url.startsWith("http") ? url : `https://${url}`;
        await browserPage.goto(target, { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise(r => setTimeout(r, 1000));
        return await getPageElements();
      }
      case "click": {
        if (!browserPage) return "Error: Browser is not open. Use navigate first.";
        const index = parseInt(args.index);
        if (isNaN(index)) return "Error: click requires an 'index' argument (number).";
        const clicked = await browserPage.evaluate((idx) => {
          const selectors = "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
          const nodes = document.querySelectorAll(selectors);
          const visible = [];
          for (const el of nodes) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.top > window.innerHeight + 200) continue;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
            visible.push(el);
            if (visible.length > idx) break;
          }
          if (idx >= visible.length) return false;
          visible[idx].click();
          return true;
        }, index);
        if (!clicked) return `Error: Element [${index}] not found. Use read action to see current elements.`;
        await new Promise(r => setTimeout(r, 1500));
        return `Clicked element [${index}].\n\n` + await getPageElements();
      }
      case "type": {
        if (!browserPage) return "Error: Browser is not open. Use navigate first.";
        const idx = parseInt(args.index);
        const text = args.text || "";
        if (isNaN(idx)) return "Error: type requires an 'index' argument (number).";
        if (!text) return "Error: type requires a 'text' argument.";
        const typed = await browserPage.evaluate((i) => {
          const selectors = "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
          const nodes = document.querySelectorAll(selectors);
          const visible = [];
          for (const el of nodes) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.top > window.innerHeight + 200) continue;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
            visible.push(el);
            if (visible.length > i) break;
          }
          if (i >= visible.length) return false;
          const el = visible[i];
          el.focus();
          el.value = "";
          return true;
        }, idx);
        if (!typed) return `Error: Element [${idx}] not found.`;
        await browserPage.keyboard.type(text, { delay: 50 });
        return `Typed "${text}" into element [${idx}].\n\n` + await getPageElements();
      }
      case "scroll": {
        if (!browserPage) return "Error: Browser is not open.";
        const dir = (args.direction || "down").toLowerCase();
        const delta = dir === "up" ? -500 : 500;
        await browserPage.evaluate((d) => window.scrollBy(0, d), delta);
        await new Promise(r => setTimeout(r, 500));
        return `Scrolled ${dir}.\n\n` + await getPageElements();
      }
      case "read": {
        return await getPageElements();
      }
      case "back": {
        if (!browserPage) return "Error: Browser is not open.";
        await browserPage.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise(r => setTimeout(r, 1000));
        return await getPageElements();
      }
      case "wait_for_page_change": {
        if (!browserPage) return "Error: Browser is not open.";
        const maxWait = parseInt(args.timeout) || 60;
        const interval = parseInt(args.interval) || 5;
        const oldUrl = browserPage.url();
        const oldTitle = await browserPage.title();
        const oldElements = await getPageElements();
        let waited = 0;
        while (waited < maxWait) {
          await new Promise(r => setTimeout(r, interval * 1000));
          waited += interval;
          const newUrl = browserPage.url();
          const newTitle = await browserPage.title();
          if (newUrl !== oldUrl || newTitle !== oldTitle) {
            return `Page changed after ${waited}s!\nOld: ${oldTitle} (${oldUrl})\nNew: ${newTitle} (${newUrl})\n\n` + await getPageElements();
          }
          const newElements = await getPageElements();
          if (newElements !== oldElements) {
            return `Page content changed after ${waited}s!\n\n${newElements}`;
          }
        }
        return `No page change detected after ${maxWait}s. Current page:\n\n` + await getPageElements();
      }
      case "key_press": {
        if (!browserPage) return "Error: Browser is not open.";
        const key = args.key || "";
        if (!key) return "Error: key_press requires a 'key' argument (e.g. Enter, Tab, Escape, Backspace).";
        await browserPage.keyboard.press(key);
        await new Promise(r => setTimeout(r, 1000));
        return `Pressed "${key}".\n\n` + await getPageElements();
      }
      case "screenshot": {
        if (!browserPage) return "Error: Browser is not open.";
        const dir = "/tmp/pack-screenshots";
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `screenshot_${Date.now()}.png`);
        await browserPage.screenshot({ path: filePath, fullPage: false });
        return `Screenshot saved: ${filePath}`;
      }
      case "close": {
        if (browserInstance) {
          await browserInstance.close();
          browserInstance = null;
          browserPage = null;
        }
        return "Browser closed.";
      }
      default:
        return `Error: Unknown browser action "${action}". Available: navigate, click, type, scroll, read, back, close, wait_for_page_change, key_press, screenshot.`;
    }
  } catch (e) {
    return `Browser error: ${e.message}`;
  }
}

// --- Skill system ---

function getSkillsDir() {
  const devPath = path.join(__dirname, "..", "skills");
  if (fs.existsSync(devPath)) return devPath;
  const prodPath = path.join(path.dirname(app.getPath("exe")), "skills");
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

function parseSkillFile(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const name = titleMatch ? titleMatch[1].trim() : path.basename(filePath, ".md");

  const metaMatch = content.match(/## Meta\n([\s\S]*?)(?=\n## )/);
  let matchKeywords = [];
  let description = "";
  if (metaMatch) {
    for (const line of metaMatch[1].trim().split("\n")) {
      const m = line.match(/^-\s*match:\s*(.+)/i);
      if (m) matchKeywords = m[1].split(",").map(k => k.trim().toLowerCase());
      const d = line.match(/^-\s*description:\s*(.+)/i);
      if (d) description = d[1].trim();
    }
  }

  const stepsMatch = content.match(/## Steps\n([\s\S]*?)$/);
  const steps = stepsMatch ? stepsMatch[1].trim() : "";

  return { name, matchKeywords, description, steps, filePath };
}

function loadAllSkills() {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith(".md"))
    .map(f => {
      try { return parseSkillFile(path.join(dir, f)); }
      catch (e) { console.log(`Failed to load skill ${f}: ${e.message}`); return null; }
    })
    .filter(Boolean);
}

function matchSkill(userPrompt) {
  const skills = loadAllSkills();
  const lower = userPrompt.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const skill of skills) {
    const hits = skill.matchKeywords.filter(k => lower.includes(k)).length;
    if (hits >= 2 && hits > bestScore) {
      bestScore = hits;
      best = skill;
    }
  }
  return best;
}

// --- AI-driven two-phase skill matching ---

function getSkillSummaries() {
  const skills = loadAllSkills();
  if (skills.length === 0) return { text: "", skills: [] };
  const lines = skills.map((s, i) =>
    `[${i}] ${s.name} — ${s.description} (file: ${path.basename(s.filePath)})`
  );
  return { text: lines.join("\n"), skills };
}

async function aiMatchSkill(userPrompt) {
  const { text: summaries, skills } = getSkillSummaries();
  if (!summaries || skills.length === 0) return null;

  const matchPrompt = `You are a skill-matching assistant. The user wants to perform a task. Below is a list of available automation skills with brief descriptions.

Your job: Decide which skill (if any) is the best match for the user's task. If a skill is clearly relevant, respond with ONLY its index number (e.g. "0" or "2"). If no skill is relevant, respond with ONLY the word "none".

Do NOT explain. Do NOT output anything other than the index number or "none".

Available skills:
${summaries}

User task: ${userPrompt}

Your answer:`;

  try {
    const response = await chatWithModel([{ role: "user", content: matchPrompt }]);
    const answer = response.trim().toLowerCase();
    console.log(`AI skill matching response: "${answer}"`);

    if (answer === "none" || answer.includes("none")) return null;

    // Extract index number from response
    const indexMatch = answer.match(/(\d+)/);
    if (!indexMatch) return null;
    const idx = parseInt(indexMatch[1]);
    if (idx < 0 || idx >= skills.length) return null;

    console.log(`AI matched skill: [${idx}] ${skills[idx].name}`);
    return skills[idx];
  } catch (e) {
    console.log(`AI skill matching failed: ${e.message}, falling back to keyword matching`);
    return matchSkill(userPrompt);
  }
}

// --- Agent: Tool definitions & execution ---

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
- list_skills(): Lists all available automation skills from the skills directory.

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
  // Strip markdown code fences
  const stripped = content.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  if (!stripped.includes("tool_call")) return null;

  const start = stripped.indexOf("{");
  if (start === -1) return null;

  // --- Strategy 1: balanced-brace matching ---
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

  // --- Strategy 2: regex fallback for badly formatted JSON ---
  const nameMatch = stripped.match(/"name"\s*:\s*"([^"]+)"/);
  if (nameMatch) {
    const name = nameMatch[1];
    const argsMatch = stripped.match(/"args"\s*:\s*\{([^]*)\}\s*\}?\s*\}?\s*$/);
    if (argsMatch) {
      try {
        const args = JSON.parse("{" + argsMatch[1].replace(/[\n\r\t]/g, (ch) =>
          ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : "\\t"
        ) + "}");
        return { name, args };
      } catch (_) {}
    }
    // Even if args fail, return the tool name with empty args
    return { name, args: {} };
  }

  return null;
}

async function executeTool(name, args) {
  switch (name) {
    case "get_current_time": {
      return new Date().toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false, timeZoneName: "short",
      });
    }

    case "web_search": {
      const query = args.query || args.q || "";
      if (!query) return "Error: web_search requires a 'query' argument.";
      try {
        const results = await braveSearch(query);
        if (results.length === 0) return "No results found.";
        return results
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
          .join("\n\n");
      } catch (e) {
        return `Search error: ${e.message}`;
      }
    }

    case "run_shell_command": {
      const command = args.command || "";
      if (!command) return "Error: run_shell_command requires a 'command' argument.";
      return new Promise((resolve) => {
        const shell = process.platform === "win32" ? "cmd" : "/bin/bash";
        const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
        const child = spawn(shell, shellArgs, {
          cwd: process.env.HOME,
          env: process.env,
        });
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          child.kill();
          resolve(`Error: command timed out after ${SHELL_TIMEOUT_MS / 1000}s`);
        }, SHELL_TIMEOUT_MS);
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", () => {
          clearTimeout(timer);
          resolve((stdout + stderr).trim() || "(no output)");
        });
        child.on("error", (err) => {
          clearTimeout(timer);
          resolve(`Error: ${err.message}`);
        });
      });
    }

    case "run_javascript": {
      const code = args.code || "";
      if (!code) return "Error: run_javascript requires a 'code' argument.";
      try {
        const result = vm.runInNewContext(code, {}, { timeout: JS_TIMEOUT_MS });
        return String(result);
      } catch (e) {
        return `JS Error: ${e.message}`;
      }
    }

    case "open_url": {
      const url = args.url || "";
      if (!url) return "Error: open_url requires a 'url' argument.";
      const target = url.startsWith("http") ? url : `https://${url}`;
      await shell.openExternal(target);
      return `Opened ${target} in default browser.`;
    }

    case "open_application": {
      const name = args.name || args.app || "";
      if (!name) return "Error: open_application requires a 'name' argument.";
      return new Promise((resolve) => {
        const child = spawn("open", ["-a", name]);
        child.on("close", (code) => {
          resolve(code === 0 ? `Opened ${name}.` : `Failed to open ${name}. Make sure the app name is correct.`);
        });
        child.on("error", (err) => {
          resolve(`Error: ${err.message}`);
        });
      });
    }

    case "read_notes": {
      const count = parseInt(args.count) || 1;
      return new Promise((resolve) => {
        const script = `
          tell application "Notes"
            set noteList to every note in folder "Notes"
            set maxCount to ${count}
            if (count of noteList) < maxCount then set maxCount to count of noteList
            set output to ""
            repeat with i from 1 to maxCount
              set n to item i of noteList
              set output to output & "--- Note " & i & " ---" & linefeed
              set output to output & "Title: " & (name of n) & linefeed
              set output to output & "Body: " & (plaintext of n) & linefeed & linefeed
            end repeat
            return output
          end tell
        `;
        const child = spawn("osascript", ["-e", script]);
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (d) => { stdout += d.toString(); });
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", () => {
          resolve(stdout.trim() || stderr.trim() || "(no notes found)");
        });
      });
    }

    case "create_note": {
      const title = (args.title || "").replace(/"/g, '\\"');
      const body = (args.body || args.content || "").replace(/"/g, '\\"');
      if (!title && !body) return "Error: create_note requires a 'title' or 'body' argument.";
      return new Promise((resolve) => {
        const script = `tell application "Notes" to make new note in folder "Notes" with properties {name:"${title}", body:"${body}"}`;
        const child = spawn("osascript", ["-e", script]);
        let stderr = "";
        child.stderr.on("data", (d) => { stderr += d.toString(); });
        child.on("close", (code) => {
          resolve(code === 0 ? `Note "${title}" created successfully.` : `Failed to create note: ${stderr}`);
        });
      });
    }

    case "create_webpage": {
      // Only stores title; HTML will be collected in the agent loop's next iteration
      return "__WEBPAGE_PENDING__";
    }

    case "read_emails": {
      const count = parseInt(args.count) || 5;
      try {
        return await gmailReadEmails(count);
      } catch (e) {
        return `Gmail read error: ${e.message}`;
      }
    }

    case "send_email": {
      const to = args.to || args.recipient || "";
      if (!to) return "Error: send_email requires a 'to' argument (recipient email address).";
      return "__EMAIL_PENDING__";
    }

    case "browser_action": {
      const action = args.action || "";
      if (!action) return "Error: browser_action requires an 'action' argument (navigate, click, type, scroll, read, back, close).";
      return await executeBrowserAction(action, args);
    }

    case "list_skills": {
      const skills = loadAllSkills();
      if (skills.length === 0) return "No skills found. Add .md files to the skills/ directory.";
      return skills.map(s =>
        `- ${s.name}: ${s.description}\n  Keywords: ${s.matchKeywords.join(", ")}\n  File: ${path.basename(s.filePath)}`
      ).join("\n\n");
    }

    default:
      return `Error: Unknown tool "${name}".`;
  }
}

// --- Webpage save & open helper ---

function saveAndOpenWebpage(title, html) {
  const dir = "/tmp/pack-pages";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 50);
  const filePath = path.join(dir, `${safeName}_${Date.now()}.html`);
  // Strip markdown code fences if model wrapped HTML in them
  const cleanHtml = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  fs.writeFileSync(filePath, cleanHtml, "utf-8");
  return new Promise((resolve) => {
    const child = spawn("open", [filePath]);
    child.on("close", (code) => {
      resolve(code === 0
        ? `Webpage created and opened in browser.\nFile: ${filePath}`
        : `Webpage saved but failed to open.\nFile: ${filePath}`);
    });
    child.on("error", () => {
      resolve(`Webpage saved but failed to open.\nFile: ${filePath}`);
    });
  });
}

// --- Agent loop ---

function sendProgress(win, type, data) {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send("agent-progress", { type, ...data });
    }
  } catch (_) {}
}

async function agentLoop(userPrompt, sessionHistory = []) {
  const win = BrowserWindow.getAllWindows()[0] || null;

  // Phase 1: AI-driven skill matching — let AI pick the best skill from summaries
  sendProgress(win, "phase", { message: "Matching skills..." });
  console.log("Phase 1: AI skill matching...");
  let skill = await aiMatchSkill(userPrompt);

  // Fallback: if AI matching returned nothing, try keyword matching
  if (!skill) {
    skill = matchSkill(userPrompt);
    if (skill) console.log(`Keyword fallback matched skill: ${skill.name}`);
  }

  if (skill) {
    sendProgress(win, "skill", { name: skill.name, description: skill.description });
  } else {
    sendProgress(win, "phase", { message: "No skill matched, using general agent mode" });
  }

  // Phase 2: If a skill was matched, load its full details into the system prompt
  let systemContent;
  if (skill) {
    console.log(`Using skill: ${skill.name} (${skill.filePath})`);
    systemContent = TOOL_SYSTEM_PROMPT +
      `\n\n=== SKILL WORKFLOW: ${skill.name} ===\n` +
      `${skill.description}\n\n` +
      `You MUST follow these steps in order. Do NOT skip steps or invent your own steps. Follow the skill workflow precisely:\n\n${skill.steps}\n\n` +
      `=== END SKILL WORKFLOW ===\n\n` +
      `User request: ${userPrompt}`;
  } else {
    console.log("No matching skill found, using general agent mode.");
    systemContent = TOOL_SYSTEM_PROMPT + userPrompt;
  }

  // Build messages with conversation history as real message turns
  const messages = [];
  if (sessionHistory.length > 0) {
    // Take last 10 messages as context, ensure it starts with a user message
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
  let pendingEmail = null; // { to, subject }

  for (let i = 0; i < AGENT_MAX_ITERATIONS; i++) {
    sendProgress(win, "iteration", { step: i + 1, max: AGENT_MAX_ITERATIONS });
    const content = await chatWithModel(messages);
    const toolCall = parseToolCall(content);
    console.log(`Agent iteration ${i + 1} response:\n${content}. Parsed tool call: ${toolCall ? JSON.stringify(toolCall) : "none"}`);

    // If we're waiting for email body from send_email
    if (pendingEmail && !toolCall) {
      sendProgress(win, "tool-call", { name: "send_email", args: { to: pendingEmail.to, subject: pendingEmail.subject } });
      let result;
      try {
        result = await gmailSendEmail(pendingEmail.to, pendingEmail.subject, content);
      } catch (e) {
        result = `Gmail send error: ${e.message}`;
      }
      console.log(`Email sent: ${result}`);
      sendProgress(win, "tool-result", { name: "send_email", result: result.slice(0, 200) });
      toolTrace.push({ tool: "send_email (sent)", args: { to: pendingEmail.to, subject: pendingEmail.subject } });
      pendingEmail = null;
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `${result}\n\nNow provide your final answer to the user in plain text.`,
      });
      continue;
    }

    // If we're waiting for HTML from create_webpage
    if (pendingWebpageTitle && !toolCall) {
      sendProgress(win, "tool-call", { name: "create_webpage", args: { title: pendingWebpageTitle } });
      const result = await saveAndOpenWebpage(pendingWebpageTitle, content);
      console.log(`Webpage saved: ${result}`);
      sendProgress(win, "tool-result", { name: "create_webpage", result: result.slice(0, 200) });
      toolTrace.push({ tool: "create_webpage (saved)", args: { title: pendingWebpageTitle } });
      pendingWebpageTitle = null;
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `${result}\n\nNow provide your final answer to the user in plain text.`,
      });
      continue;
    }

    if (!toolCall) {
      // Model tried to call a tool but format was wrong — ask it to retry
      if (content.includes("tool_call")) {
        console.log("Tool call detected but parsing failed, asking model to retry...");
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
    sendProgress(win, "tool-call", { name, args });

    const toolResult = await executeTool(name, args);

    // Special handling: create_webpage returns a pending marker
    if (toolResult === "__WEBPAGE_PENDING__") {
      pendingWebpageTitle = args.title || "page";
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Webpage "${pendingWebpageTitle}" is ready to be created. Now output ONLY the complete HTML code starting with <!DOCTYPE html>. Do NOT wrap it in JSON or code fences. Output raw HTML only.`,
      });
      continue;
    }

    // Special handling: send_email returns a pending marker
    if (toolResult === "__EMAIL_PENDING__") {
      pendingEmail = {
        to: args.to || args.recipient || "",
        subject: args.subject || "(no subject)",
      };
      messages.push({ role: "assistant", content });
      messages.push({
        role: "user",
        content: `Email to "${pendingEmail.to}" with subject "${pendingEmail.subject}" is ready. Now output ONLY the email body text. Do NOT wrap it in JSON or code fences. Output plain text only.`,
      });
      continue;
    }

    console.log(`Tool "${name}" executed with args ${JSON.stringify(args)} and returned:\n${toolResult}`);
    sendProgress(win, "tool-result", { name, result: toolResult.slice(0, 300) });

    messages.push({ role: "assistant", content });
    messages.push({
      role: "user",
      content: `Tool "${name}" returned:\n${toolResult}\n\nBased on this result, either use another tool or provide your final answer in plain text.`,
    });
  }

  messages.push({
    role: "user",
    content: "Please provide your final answer now based on all information gathered.",
  });
  const finalContent = await chatWithModel(messages);
  return { output: finalContent, trace: toolTrace };
}

// --- Telegram Bot ---

let telegramBot = null;
let telegramBotRunning = false;
const telegramSessions = {}; // key: chatId, value: message array
const TELEGRAM_MAX_SESSION = 40;

function getTelegramSession(chatId) {
  if (!telegramSessions[chatId]) {
    telegramSessions[chatId] = [];
  }
  return telegramSessions[chatId];
}

function trimTelegramSession(chatId) {
  if (telegramSessions[chatId] && telegramSessions[chatId].length > TELEGRAM_MAX_SESSION) {
    telegramSessions[chatId] = telegramSessions[chatId].slice(-TELEGRAM_MAX_SESSION);
  }
}

async function sendTelegramLong(bot, chatId, text) {
  const MAX_LEN = 4000;
  if (text.length <= MAX_LEN) {
    await bot.sendMessage(chatId, text);
    return;
  }
  // Split into chunks at line breaks when possible
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      await bot.sendMessage(chatId, remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf("\n", MAX_LEN);
    if (cutIndex < MAX_LEN * 0.3) cutIndex = MAX_LEN;
    const chunk = remaining.slice(0, cutIndex);
    remaining = remaining.slice(cutIndex).trimStart();
    await bot.sendMessage(chatId, chunk);
  }
}

function startTelegramBot() {
  if (telegramBotRunning || !TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN === "YOUR_BOT_TOKEN_HERE") {
    console.log("Telegram bot not started: missing or placeholder token.");
    return false;
  }

  try {
    telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
    telegramBotRunning = true;
    console.log("Telegram bot started (polling).");

    telegramBot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      if (!text) return;

      // /start command
      if (text === "/start") {
        await telegramBot.sendMessage(chatId, "Pack AI Agent 已连接。\n\n直接发送消息即可提问，AI 可以调用搜索、浏览器、Shell 等工具帮你完成任务。\n\n命令：\n/clear — 清空对话历史\n/model — 查看当前模型\n/status — 查看状态");
        return;
      }

      // /clear command
      if (text === "/clear") {
        telegramSessions[chatId] = [];
        await telegramBot.sendMessage(chatId, "对话历史已清空。");
        return;
      }

      // /model command
      if (text === "/model") {
        const label = currentModel === "minimax" ? "MiniMax-M2.5" : "Ollama gemma3:4b";
        await telegramBot.sendMessage(chatId, `当前模型: ${label}`);
        return;
      }

      // /status command
      if (text === "/status") {
        const session = getTelegramSession(chatId);
        await telegramBot.sendMessage(chatId, `状态: 运行中\n当前模型: ${currentModel === "minimax" ? "MiniMax-M2.5" : "Ollama gemma3:4b"}\n对话历史: ${session.length} 条消息`);
        return;
      }

      // Regular message → send to AI Agent
      const session = getTelegramSession(chatId);

      // Send "thinking" indicator
      await telegramBot.sendChatAction(chatId, "typing");

      try {
        const result = await agentLoop(text, session);

        // Save to session
        session.push({ role: "user", content: text });
        session.push({ role: "assistant", content: result.output || "" });
        trimTelegramSession(chatId);

        const reply = result.output || "（AI 无回复）";
        await sendTelegramLong(telegramBot, chatId, reply);
      } catch (err) {
        console.log(`Telegram agent error for chat ${chatId}: ${err.message}`);
        await telegramBot.sendMessage(chatId, `出错了: ${err.message}`);
      }
    });

    telegramBot.on("polling_error", (err) => {
      console.log(`Telegram polling error: ${err.message}`);
    });

    return true;
  } catch (err) {
    console.log(`Failed to start Telegram bot: ${err.message}`);
    telegramBotRunning = false;
    telegramBot = null;
    return false;
  }
}

function stopTelegramBot() {
  if (telegramBot) {
    telegramBot.stopPolling();
    telegramBot = null;
  }
  telegramBotRunning = false;
  console.log("Telegram bot stopped.");
}

// --- IPC handlers ---

ipcMain.handle("telegram-status", () => {
  return {
    running: telegramBotRunning,
    hasToken: TELEGRAM_BOT_TOKEN && TELEGRAM_BOT_TOKEN !== "YOUR_BOT_TOKEN_HERE",
  };
});

ipcMain.handle("telegram-toggle", () => {
  if (telegramBotRunning) {
    stopTelegramBot();
    return { running: false };
  }
  const ok = startTelegramBot();
  return { running: ok, error: ok ? null : "启动失败，请检查 Bot Token 是否正确" };
});

ipcMain.handle("brave-search", async (event, query) => {
  try {
    const results = await braveSearch(query);
    if (results.length === 0) {
      return { output: "No results found." };
    }

    const context = results
      .map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`)
      .join("\n\n");

    const aiPrompt = `Based on the following search results for "${query}", provide a direct, concise answer in the same language as the query. Extract the key facts and give a clear answer. Do NOT just list links or say "according to search results". Give the actual information directly.

Search results:
${context}

Answer:`;

    const aiAnswer = await ollamaGenerate(aiPrompt);
    return { output: aiAnswer.trim() || "AI could not generate an answer." };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle("ollama-chat", async (event, prompt) => {
  try {
    chatSessionHistory.push({ role: "user", content: prompt });
    if (chatSessionHistory.length > MAX_SESSION_MESSAGES) {
      chatSessionHistory = chatSessionHistory.slice(-MAX_SESSION_MESSAGES);
    }
    const answer = await chatWithModel([...chatSessionHistory]);
    chatSessionHistory.push({ role: "assistant", content: answer });
    if (chatSessionHistory.length > MAX_SESSION_MESSAGES) {
      chatSessionHistory = chatSessionHistory.slice(-MAX_SESSION_MESSAGES);
    }
    return { output: answer || "No response." };
  } catch (err) {
    return { error: `Model error: ${err.message}` };
  }
});

ipcMain.handle("ollama-agent", async (event, prompt) => {
  try {
    const result = await agentLoop(prompt, chatSessionHistory);
    // Save the Q&A to session so follow-up questions have context
    chatSessionHistory.push({ role: "user", content: prompt });
    chatSessionHistory.push({ role: "assistant", content: result.output || "" });
    if (chatSessionHistory.length > MAX_SESSION_MESSAGES) {
      chatSessionHistory = chatSessionHistory.slice(-MAX_SESSION_MESSAGES);
    }
    return result;
  } catch (err) {
    return { error: `Agent error: ${err.message}`, trace: [] };
  }
});

ipcMain.handle("clear-session", () => {
  chatSessionHistory = [];
  console.log("Chat session cleared.");
  return { output: "Session cleared." };
});

ipcMain.handle("switch-model", (event, model) => {
  const valid = ["ollama", "minimax"];
  if (!valid.includes(model)) {
    return { error: `Unknown model: "${model}". Available: ${valid.join(", ")}` };
  }
  currentModel = model;
  const label = model === "minimax" ? "MiniMax-M2.5" : "Ollama gemma3:4b";
  console.log(`Switched to model: ${label}`);
  return { output: `Switched to ${label}`, model: currentModel };
});

ipcMain.handle("get-current-model", () => {
  return currentModel;
});

ipcMain.handle("list-skills", () => {
  const skills = loadAllSkills();
  return skills.map(s => ({
    name: s.name,
    description: s.description,
    keywords: s.matchKeywords,
    file: path.basename(s.filePath),
  }));
});

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow();
  startTelegramBot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopTelegramBot();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
