const path = require("path");
const fs = require("fs");
const puppeteer = require("puppeteer-core");

let browserInstance = null;
let browserPage = null;

async function launchBrowser(chromePath) {
  if (browserInstance && browserPage) return;
  browserInstance = await puppeteer.launch({
    executablePath: chromePath,
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

async function executeBrowserAction(action, args, chromePath) {
  try {
    switch (action) {
      case "navigate": {
        const url = args.url || "";
        if (!url) return "Error: navigate requires a 'url' argument.";
        await launchBrowser(chromePath);
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
        const dir = "/tmp/ai-agent-screenshots";
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

async function executeTool(toolName, args, context) {
  if (toolName !== "browser_action") {
    return `Error: Unknown tool "${toolName}" in browser skill.`;
  }

  const action = args.action || "";
  if (!action) return "Error: browser_action requires an 'action' argument.";

  const chromePath = (context.config && context.config.chromePath) ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

  return await executeBrowserAction(action, args, chromePath);
}

module.exports = { executeTool };
