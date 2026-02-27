/**
 * Skill registry — scanning, loading, and managing skills.
 * Replaces the old skills.js module.
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");

// Cache loaded skill code modules
const _codeCache = new Map();

function getSkillsDir() {
  const devPath = path.join(__dirname, "..", "skills");
  if (fs.existsSync(devPath)) return devPath;
  const prodPath = path.join(path.dirname(app.getPath("exe")), "skills");
  if (fs.existsSync(prodPath)) return prodPath;
  return devPath;
}

/**
 * Scan all skill directories and return their manifests.
 * Each skill must be a folder containing a skill.json file.
 */
function scanSkills() {
  const dir = getSkillsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(dir, entry.name, "skill.json");
    if (!fs.existsSync(manifestPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      manifest._dir = path.join(dir, entry.name);
      skills.push(manifest);
    } catch (e) {
      console.log(`Failed to load skill manifest ${entry.name}: ${e.message}`);
    }
  }

  return skills;
}

/**
 * Get the manifest for a specific skill by name.
 */
function getSkillManifest(skillName) {
  const dir = getSkillsDir();
  const manifestPath = path.join(dir, skillName, "skill.json");
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    manifest._dir = path.join(dir, skillName);
    return manifest;
  } catch (e) {
    console.log(`Failed to read skill manifest ${skillName}: ${e.message}`);
    return null;
  }
}

/**
 * Load and cache the code module (index.js) for a skill.
 * Returns the module exports or null if not found.
 */
function loadSkillCode(skillName) {
  if (_codeCache.has(skillName)) return _codeCache.get(skillName);

  const dir = getSkillsDir();
  const codePath = path.join(dir, skillName, "index.js");
  if (!fs.existsSync(codePath)) return null;

  try {
    const mod = require(codePath);
    _codeCache.set(skillName, mod);
    return mod;
  } catch (e) {
    console.log(`Failed to load skill code ${skillName}: ${e.message}`);
    return null;
  }
}

/**
 * Load the workflow markdown for a workflow-type skill.
 * Returns the markdown string or null.
 */
function loadWorkflow(skillName) {
  const dir = getSkillsDir();
  const workflowPath = path.join(dir, skillName, "workflow.md");
  if (!fs.existsSync(workflowPath)) return null;

  try {
    return fs.readFileSync(workflowPath, "utf-8");
  } catch (e) {
    console.log(`Failed to load workflow ${skillName}: ${e.message}`);
    return null;
  }
}

/**
 * Get available skills formatted for the frontend.
 * Returns array of { name, displayName, description, type, configSchema, tools, dependencies }.
 */
function getAvailableSkills() {
  return scanSkills().map((s) => ({
    name: s.name,
    displayName: s.displayName,
    description: s.description,
    type: s.type,
    configSchema: s.configSchema || {},
    tools: s.tools || [],
    dependencies: s.dependencies || [],
    matchKeywords: s.matchKeywords || [],
  }));
}

/**
 * Download and install a skill from a URL.
 * Expects the URL to point to a .tar.gz or .zip archive containing a skill folder.
 * Returns { success, skillName, error }.
 */
async function downloadSkill(url) {
  const { net } = require("electron");
  const os = require("os");

  try {
    const response = await net.fetch(url);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const tmpDir = path.join(os.tmpdir(), `skill-download-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const archivePath = path.join(tmpDir, "skill-archive");
    fs.writeFileSync(archivePath, buffer);

    // Try to extract (support .tar.gz and .zip)
    const { execSync } = require("child_process");
    const extractDir = path.join(tmpDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    if (url.endsWith(".zip")) {
      execSync(`unzip -o "${archivePath}" -d "${extractDir}"`, { timeout: 30000 });
    } else {
      execSync(`tar -xzf "${archivePath}" -C "${extractDir}"`, { timeout: 30000 });
    }

    // Find the skill.json in extracted content
    const entries = fs.readdirSync(extractDir, { withFileTypes: true });
    let skillDir = extractDir;

    // If extracted into a single subdirectory, use that
    const dirs = entries.filter((e) => e.isDirectory());
    if (dirs.length === 1 && !fs.existsSync(path.join(extractDir, "skill.json"))) {
      skillDir = path.join(extractDir, dirs[0].name);
    }

    const manifestPath = path.join(skillDir, "skill.json");
    if (!fs.existsSync(manifestPath)) {
      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { success: false, error: "No skill.json found in archive" };
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const targetDir = path.join(getSkillsDir(), manifest.name);

    // Copy to skills directory
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true });
    }
    execSync(`cp -r "${skillDir}" "${targetDir}"`, { timeout: 10000 });

    // Cleanup temp
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Clear cache for this skill
    _codeCache.delete(manifest.name);

    return { success: true, skillName: manifest.name };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = {
  scanSkills,
  getSkillManifest,
  loadSkillCode,
  loadWorkflow,
  getAvailableSkills,
  downloadSkill,
  getSkillsDir,
};
