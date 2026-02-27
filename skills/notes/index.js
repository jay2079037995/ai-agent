const { spawn } = require("child_process");

async function executeTool(toolName, args, context) {
  switch (toolName) {
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

    default:
      return `Error: Unknown tool "${toolName}" in notes skill.`;
  }
}

module.exports = { executeTool };
