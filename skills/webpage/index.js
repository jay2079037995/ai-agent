const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

function saveAndOpenWebpage(title, html) {
  const dir = "/tmp/ai-agent-pages";
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

async function executeTool(toolName, args, context) {
  if (toolName !== "create_webpage") {
    return `Error: Unknown tool "${toolName}" in webpage skill.`;
  }
  return "__WEBPAGE_PENDING__";
}

module.exports = { executeTool, saveAndOpenWebpage };
