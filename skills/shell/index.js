const { spawn } = require("child_process");

async function executeTool(toolName, args, context) {
  if (toolName !== "run_shell_command") {
    return `Error: Unknown tool "${toolName}" in shell skill.`;
  }

  const command = args.command || "";
  if (!command) return "Error: run_shell_command requires a 'command' argument.";

  const cwd = context.workDir || process.env.HOME;
  const timeout = (context.config && context.config.timeout) || 10000;

  return new Promise((resolve) => {
    const sh = process.platform === "win32" ? "cmd" : "/bin/bash";
    const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];
    const child = spawn(sh, shellArgs, { cwd, env: process.env });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve(`Error: command timed out after ${timeout / 1000}s`);
    }, timeout);
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

module.exports = { executeTool };
