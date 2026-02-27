/**
 * Skill system — loading, parsing, matching skills from markdown files.
 */

const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { chatWithProvider } = require("./providers");

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
      if (m) matchKeywords = m[1].split(",").map((k) => k.trim().toLowerCase());
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
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      try {
        return parseSkillFile(path.join(dir, f));
      } catch (e) {
        console.log(`Failed to load skill ${f}: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

function matchSkill(userPrompt) {
  const skills = loadAllSkills();
  const lower = userPrompt.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const skill of skills) {
    const hits = skill.matchKeywords.filter((k) => lower.includes(k)).length;
    if (hits >= 2 && hits > bestScore) {
      bestScore = hits;
      best = skill;
    }
  }
  return best;
}

function getSkillSummaries() {
  const skills = loadAllSkills();
  if (skills.length === 0) return { text: "", skills: [] };
  const lines = skills.map(
    (s, i) => `[${i}] ${s.name} — ${s.description} (file: ${path.basename(s.filePath)})`
  );
  return { text: lines.join("\n"), skills };
}

async function aiMatchSkill(userPrompt, providerConfig) {
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
    const response = await chatWithProvider([{ role: "user", content: matchPrompt }], providerConfig);
    const answer = response.trim().toLowerCase();
    console.log(`AI skill matching response: "${answer}"`);

    if (answer === "none" || answer.includes("none")) return null;

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

module.exports = {
  loadAllSkills,
  matchSkill,
  aiMatchSkill,
  getSkillSummaries,
};
