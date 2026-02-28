const { execSync, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const SKILL_DIR = __dirname;
const HELPER_SRC = path.join(SKILL_DIR, "helper.swift");
const HELPER_BIN = path.join(SKILL_DIR, "helper");

/**
 * Compile the Swift helper binary if it doesn't exist or source is newer.
 */
function ensureHelper() {
  let needsBuild = false;

  if (!fs.existsSync(HELPER_BIN)) {
    needsBuild = true;
  } else {
    const srcStat = fs.statSync(HELPER_SRC);
    const binStat = fs.statSync(HELPER_BIN);
    if (srcStat.mtimeMs > binStat.mtimeMs) {
      needsBuild = true;
    }
  }

  if (needsBuild) {
    console.log("screen-control: Compiling Swift helper (one-time)...");
    try {
      execSync(
        `swiftc "${HELPER_SRC}" -framework Cocoa -framework Vision -o "${HELPER_BIN}"`,
        { timeout: 60_000 }
      );
      console.log("screen-control: Helper compiled successfully.");
    } catch (err) {
      throw new Error(
        `Failed to compile helper.swift. Make sure Xcode Command Line Tools are installed (xcode-select --install). Error: ${err.message}`
      );
    }
  }
}

/**
 * Run the helper binary with arguments and return stdout.
 */
function runHelper(...args) {
  ensureHelper();
  try {
    const result = execFileSync(HELPER_BIN, args, {
      timeout: 10_000,
      encoding: "utf-8",
    });
    return result.trim();
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    throw new Error(stderr || err.message);
  }
}

/**
 * Execute a screen-control tool.
 * @param {string} toolName
 * @param {object} args
 * @param {object} context
 */
async function executeTool(toolName, args, context) {
  try {
    if (toolName === "screen_capture") {
      return screenCapture();
    }

    if (toolName === "screen_info") {
      return runHelper("info");
    }

    if (toolName === "mouse_move") {
      const x = Number(args.x);
      const y = Number(args.y);
      if (isNaN(x) || isNaN(y)) return "Error: x and y must be numbers.";
      return runHelper("move", String(x), String(y));
    }

    if (toolName === "mouse_click") {
      const x = Number(args.x);
      const y = Number(args.y);
      if (isNaN(x) || isNaN(y)) return "Error: x and y must be numbers.";
      const button = args.button || "left";
      return runHelper("click", String(x), String(y), button);
    }

    if (toolName === "mouse_drag") {
      const fromX = Number(args.fromX);
      const fromY = Number(args.fromY);
      const toX = Number(args.toX);
      const toY = Number(args.toY);
      if ([fromX, fromY, toX, toY].some(isNaN))
        return "Error: fromX, fromY, toX, toY must all be numbers.";
      return runHelper(
        "drag",
        String(fromX),
        String(fromY),
        String(toX),
        String(toY)
      );
    }

    if (toolName === "keyboard_type") {
      const text = args.text || "";
      if (!text) return "Error: text is required.";
      return keyboardType(text);
    }

    if (toolName === "scroll") {
      const x = Number(args.x);
      const y = Number(args.y);
      if (isNaN(x) || isNaN(y)) return "Error: x and y must be numbers.";
      const direction = args.direction || "down";
      const amount = Number(args.amount) || 3;

      let deltaY = 0;
      let deltaX = 0;
      switch (direction) {
        case "up":
          deltaY = amount;
          break;
        case "down":
          deltaY = -amount;
          break;
        case "left":
          deltaX = amount;
          break;
        case "right":
          deltaX = -amount;
          break;
        default:
          return `Error: direction must be 'up', 'down', 'left', or 'right'.`;
      }
      return runHelper(
        "scroll",
        String(x),
        String(y),
        String(deltaY),
        String(deltaX)
      );
    }

    return `Error: Unknown tool "${toolName}" in screen-control skill.`;
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

/**
 * Take a screenshot, run OCR, and return combined results.
 * Returns { text, images } so agent-loop can attach the image for vision models.
 */
function screenCapture() {
  const timestamp = Date.now();
  const screenshotPath = `/tmp/screenshot-${timestamp}.jpg`;

  // Take screenshot as JPEG (smaller file size for vision models), silent
  try {
    execSync(`screencapture -x -t jpg "${screenshotPath}"`, { timeout: 10_000 });
  } catch (err) {
    return `Error taking screenshot: ${err.message}`;
  }

  if (!fs.existsSync(screenshotPath)) {
    return "Error: Screenshot file was not created. Check screen recording permissions in System Settings → Privacy & Security → Screen Recording.";
  }

  // Resize to max 1280px width so base64 stays small for LLM APIs
  try {
    execSync(
      `sips --resampleWidth 1280 "${screenshotPath}" --out "${screenshotPath}"`,
      { timeout: 10_000, stdio: "ignore" }
    );
  } catch {
    // Non-critical — send original size if resize fails
  }

  // Get screen info
  let info = {};
  try {
    const infoJson = runHelper("info");
    info = JSON.parse(infoJson);
  } catch {
    // Non-critical, continue without info
  }

  // Run OCR
  let ocrText = "";
  try {
    ocrText = runHelper("ocr", screenshotPath);
  } catch {
    ocrText = "(OCR failed)";
  }

  const result = {
    screenshotPath,
    screenWidth: info.screenWidth || "unknown",
    screenHeight: info.screenHeight || "unknown",
    mouseX: info.mouseX || "unknown",
    mouseY: info.mouseY || "unknown",
    ocrText: ocrText || "(no text detected)",
  };

  // Return object with images array — agent-loop will read the file
  // and attach it to the LLM message for vision-capable models
  return {
    text: JSON.stringify(result, null, 2),
    images: [{ path: screenshotPath }],
  };
}

/**
 * Type text using AppleScript (handles Unicode/CJK well).
 */
function keyboardType(text) {
  // Escape backslashes and double quotes for AppleScript string
  const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const script = `tell application "System Events" to keystroke "${escaped}"`;
  try {
    execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      timeout: 10_000,
    });
    return "OK";
  } catch (err) {
    return `Error typing text: ${err.message}. Make sure the app has Accessibility permission in System Settings → Privacy & Security → Accessibility.`;
  }
}

module.exports = { executeTool };
