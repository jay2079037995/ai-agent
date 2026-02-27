const vm = require("vm");
const { spawn } = require("child_process");
const { shell } = require("electron");

const JS_TIMEOUT_MS = 5000;

async function executeTool(toolName, args, context) {
  switch (toolName) {
    case "get_current_time":
      return new Date().toLocaleString("zh-CN", {
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
        hour12: false, timeZoneName: "short",
      });

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

    default:
      return `Error: Unknown tool "${toolName}" in basic-tools skill.`;
  }
}

module.exports = { executeTool };
