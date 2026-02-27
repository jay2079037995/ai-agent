/**
 * Tool implementations for the AI agent.
 * All tools that need a working directory accept it as a parameter.
 */

const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const vm = require("vm");
const { shell, net } = require("electron");
const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");
const Imap = require("imap");
const { simpleParser } = require("mailparser");

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SHELL_TIMEOUT_MS = 10000;
const JS_TIMEOUT_MS = 5000;

// --- Browser automation (shared singleton) ---

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
  browserPage = pages[0] || (await browserInstance.newPage());
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
    const selectors =
      "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
    const nodes = document.querySelectorAll(selectors);
    const results = [];
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top > window.innerHeight + 200) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
        continue;

      const tag = el.tagName.toLowerCase();
      let desc = "";
      if (tag === "input" || tag === "textarea") {
        const inputType = el.type || "text";
        const val = el.value ? ` value="${el.value.slice(0, 30)}"` : "";
        const ph = el.placeholder ? ` "${el.placeholder}"` : "";
        const label = el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : "";
        desc = `input(${inputType})${ph}${label}${val}`;
      } else if (tag === "select") {
        const opts = Array.from(el.options)
          .slice(0, 5)
          .map((o) => o.text.slice(0, 20))
          .join(", ");
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
        await new Promise((r) => setTimeout(r, 1000));
        return await getPageElements();
      }
      case "click": {
        if (!browserPage) return "Error: Browser is not open. Use navigate first.";
        const index = parseInt(args.index);
        if (isNaN(index)) return "Error: click requires an 'index' argument (number).";
        const clicked = await browserPage.evaluate((idx) => {
          const selectors =
            "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
          const nodes = document.querySelectorAll(selectors);
          const visible = [];
          for (const el of nodes) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.top > window.innerHeight + 200) continue;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
              continue;
            visible.push(el);
            if (visible.length > idx) break;
          }
          if (idx >= visible.length) return false;
          visible[idx].click();
          return true;
        }, index);
        if (!clicked) return `Error: Element [${index}] not found. Use read action to see current elements.`;
        await new Promise((r) => setTimeout(r, 1500));
        return `Clicked element [${index}].\n\n` + (await getPageElements());
      }
      case "type": {
        if (!browserPage) return "Error: Browser is not open. Use navigate first.";
        const idx = parseInt(args.index);
        const text = args.text || "";
        if (isNaN(idx)) return "Error: type requires an 'index' argument (number).";
        if (!text) return "Error: type requires a 'text' argument.";
        const typed = await browserPage.evaluate((i) => {
          const selectors =
            "a, button, input, textarea, select, [role='button'], [role='link'], [role='tab'], [onclick]";
          const nodes = document.querySelectorAll(selectors);
          const visible = [];
          for (const el of nodes) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) continue;
            if (rect.top > window.innerHeight + 200) continue;
            const style = window.getComputedStyle(el);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
              continue;
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
        return `Typed "${text}" into element [${idx}].\n\n` + (await getPageElements());
      }
      case "scroll": {
        if (!browserPage) return "Error: Browser is not open.";
        const dir = (args.direction || "down").toLowerCase();
        const delta = dir === "up" ? -500 : 500;
        await browserPage.evaluate((d) => window.scrollBy(0, d), delta);
        await new Promise((r) => setTimeout(r, 500));
        return `Scrolled ${dir}.\n\n` + (await getPageElements());
      }
      case "read":
        return await getPageElements();
      case "back": {
        if (!browserPage) return "Error: Browser is not open.";
        await browserPage.goBack({ waitUntil: "domcontentloaded", timeout: 15000 });
        await new Promise((r) => setTimeout(r, 1000));
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
          await new Promise((r) => setTimeout(r, interval * 1000));
          waited += interval;
          const newUrl = browserPage.url();
          const newTitle = await browserPage.title();
          if (newUrl !== oldUrl || newTitle !== oldTitle) {
            return (
              `Page changed after ${waited}s!\nOld: ${oldTitle} (${oldUrl})\nNew: ${newTitle} (${newUrl})\n\n` +
              (await getPageElements())
            );
          }
          const newElements = await getPageElements();
          if (newElements !== oldElements) {
            return `Page content changed after ${waited}s!\n\n${newElements}`;
          }
        }
        return `No page change detected after ${maxWait}s. Current page:\n\n` + (await getPageElements());
      }
      case "key_press": {
        if (!browserPage) return "Error: Browser is not open.";
        const key = args.key || "";
        if (!key) return "Error: key_press requires a 'key' argument.";
        await browserPage.keyboard.press(key);
        await new Promise((r) => setTimeout(r, 1000));
        return `Pressed "${key}".\n\n` + (await getPageElements());
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

// --- Gmail (shared, uses sharedKeys) ---

let _gmailTransporter = null;

function getGmailTransporter(gmailUser, gmailAppPassword) {
  if (!_gmailTransporter || _gmailTransporter._user !== gmailUser) {
    _gmailTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailAppPassword },
    });
    _gmailTransporter._user = gmailUser;
  }
  return _gmailTransporter;
}

function gmailReadEmails(gmailUser, gmailAppPassword, count = 5) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: gmailUser,
      password: gmailAppPassword,
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
              resolve(
                results
                  .map(
                    (r, i) =>
                      `--- Email ${i + 1} ---\nFrom: ${r.from}\nSubject: ${r.subject}\nDate: ${r.date}\n${r.text}`
                  )
                  .join("\n\n")
              );
            }, 1000);
          });
        });
      });
    });

    imap.once("error", (err) => reject(err));
    imap.connect();
  });
}

async function gmailSendEmail(gmailUser, gmailAppPassword, to, subject, body) {
  const transporter = getGmailTransporter(gmailUser, gmailAppPassword);
  const info = await transporter.sendMail({ from: gmailUser, to, subject, text: body });
  return `Email sent successfully. Message ID: ${info.messageId}`;
}

// --- Brave Search (shared, uses sharedKeys) ---

async function braveSearch(apiKey, query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
  const response = await net.fetch(url, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
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

// --- Webpage save & open ---

function saveAndOpenWebpage(title, html) {
  const dir = "/tmp/pack-pages";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const safeName = title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 50);
  const filePath = path.join(dir, `${safeName}_${Date.now()}.html`);
  const cleanHtml = html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/, "").trim();
  fs.writeFileSync(filePath, cleanHtml, "utf-8");
  return new Promise((resolve) => {
    const child = spawn("open", [filePath]);
    child.on("close", (code) => {
      resolve(
        code === 0
          ? `Webpage created and opened in browser.\nFile: ${filePath}`
          : `Webpage saved but failed to open.\nFile: ${filePath}`
      );
    });
    child.on("error", () => {
      resolve(`Webpage saved but failed to open.\nFile: ${filePath}`);
    });
  });
}

// --- Main tool executor ---
// workDir: agent's working directory
// sharedKeys: { braveApiKey, gmailUser, gmailAppPassword }

async function executeTool(name, args, { workDir, sharedKeys }) {
  const cwd = workDir || process.env.HOME;

  switch (name) {
    case "get_current_time":
      return new Date().toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false, timeZoneName: "short",
      });

    case "web_search": {
      const query = args.query || args.q || "";
      if (!query) return "Error: web_search requires a 'query' argument.";
      const apiKey = sharedKeys.braveApiKey;
      if (!apiKey) return "Error: Brave API key not configured.";
      try {
        const results = await braveSearch(apiKey, query);
        if (results.length === 0) return "No results found.";
        return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`).join("\n\n");
      } catch (e) {
        return `Search error: ${e.message}`;
      }
    }

    case "run_shell_command": {
      const command = args.command || "";
      if (!command) return "Error: run_shell_command requires a 'command' argument.";
      return new Promise((resolve) => {
        const sh = process.platform === "win32" ? "cmd" : "/bin/bash";
        const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
        const child = spawn(sh, shellArgs, { cwd, env: process.env });
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
      const appName = args.name || args.app || "";
      if (!appName) return "Error: open_application requires a 'name' argument.";
      return new Promise((resolve) => {
        const child = spawn("open", ["-a", appName]);
        child.on("close", (code) => {
          resolve(code === 0 ? `Opened ${appName}.` : `Failed to open ${appName}.`);
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

    case "create_webpage":
      return "__WEBPAGE_PENDING__";

    case "read_emails": {
      const count = parseInt(args.count) || 5;
      const { gmailUser, gmailAppPassword } = sharedKeys;
      if (!gmailUser || !gmailAppPassword) return "Error: Gmail credentials not configured.";
      try {
        return await gmailReadEmails(gmailUser, gmailAppPassword, count);
      } catch (e) {
        return `Gmail read error: ${e.message}`;
      }
    }

    case "send_email": {
      const to = args.to || args.recipient || "";
      if (!to) return "Error: send_email requires a 'to' argument.";
      return "__EMAIL_PENDING__";
    }

    case "browser_action": {
      const action = args.action || "";
      if (!action) return "Error: browser_action requires an 'action' argument.";
      return await executeBrowserAction(action, args);
    }

    case "list_skills": {
      // Delegated to skills.js — caller should handle this
      return "Error: list_skills should be handled by agent-loop.";
    }

    default:
      return `Error: Unknown tool "${name}".`;
  }
}

module.exports = {
  executeTool,
  braveSearch,
  gmailSendEmail,
  saveAndOpenWebpage,
};
