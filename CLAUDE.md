# Pack — AI Agent Desktop App

## Project Overview

Pack is an Electron + React desktop application that lets users create and manage multiple AI agents. Each agent can be configured with different LLM providers, roles, and installable skills (tools/workflows). Agents collaborate via a shared kanban task board and inter-agent messaging.

## Tech Stack

- **Frontend**: React 19 (JSX, no TypeScript), Webpack 5, Babel
- **Backend**: Electron 40 (main process), Node.js CommonJS modules
- **LLM Providers**: MiniMax (default), DeepSeek (OpenAI SDK), Ollama (local)
- **Storage**: electron-store (JSON-based persistent storage)
- **No test framework** is configured

## Project Structure

```
electron/           # Electron main process
  main.js           # App entry, window creation, auto-start services
  preload.js        # Context bridge for renderer
  ipc-handlers.js   # All IPC handlers (agent CRUD, chat, skills, tasks, UI state)
  agent-loop.js     # Multi-step tool-calling loop with workflow matching
  providers.js      # Unified LLM provider interface (MiniMax, DeepSeek, Ollama)
  store.js          # electron-store schema, agent/task/message CRUD, roles, migrations
  skill-registry.js # Skill scanning, loading, manifest/code/workflow management
  collaboration.js  # Inter-agent messaging, task dispatch, kanban automation
  runtime.js        # Per-agent session history management

src/                # React renderer process
  index.jsx         # React entry point
  App.jsx           # Root component (theme, view mode, tab routing)
  AgentContext.jsx   # React context for agent state management
  components/
    TabBar.jsx       # Agent tab navigation
    AgentPanel.jsx   # Chat interface per agent
    AgentConfigModal.jsx  # Agent creation/editing modal
    KanbanBoard.jsx  # Task kanban board UI

skills/             # Pluggable skill modules (each is a folder with skill.json + index.js)
  basic-tools/      # Time, JS eval, URL opener, app launcher
  shell/            # Shell command execution
  browser/          # Puppeteer-based browser automation
  web-search/       # Web search via Brave API
  baidu-search/     # Baidu search
  email/            # Gmail send/receive via IMAP/SMTP
  telegram/         # Telegram bot service
  wecom/            # WeCom (企业微信) integration
  git-local/        # Local git operations
  github-operations/ # GitHub API operations
  notes/            # Note-taking
  webpage/          # HTML page generation and preview
  screen-control/   # Screen capture/control
  download-resource/ # File downloading
  csdn-publish-blog/ # CSDN blog publishing workflow
  weibo-post/       # Weibo posting workflow

dist/               # Webpack build output
dist-electron/      # Electron-builder output
```

## Commands

- `npm start` — Start webpack dev server on port 3000 (frontend only)
- `npm run build` — Production webpack build to `dist/`
- `npm run electron:dev` — Build + run Electron app
- `npm run electron:build` — Build + package with electron-builder (macOS DMG)

## Architecture

### Agent Loop (`electron/agent-loop.js`)

The core loop that drives agent behavior:
1. AI workflow matching — matches user prompt to installed workflow skills
2. Builds dynamic system prompt from installed skills' tool descriptions and prompt rules
3. Iterative tool-calling loop (up to `maxIterations`, default 30)
4. Tool calls are JSON objects: `{"tool_call":{"name":"...","args":{...}}}`
5. Special handling for email body and webpage HTML generation (pending states)

### Skill System

Skills are pluggable modules in `skills/`. Three types:
- **tool-provider**: Exposes tools the agent can call (e.g., shell, browser, web-search)
- **workflow**: Step-by-step automation triggered by keyword/AI matching (e.g., csdn-publish-blog)
- **service**: Long-running background services (e.g., telegram bot)

Each skill has:
- `skill.json` — Manifest with name, type, tools, configSchema, matchKeywords, promptRules
- `index.js` — Implementation with `executeTool(name, args, context)` function
- `workflow.md` — (workflow type only) Step-by-step instructions injected into system prompt

### Collaboration (`electron/collaboration.js`)

Built-in collaboration tools available to all agents:
- `send_message_to_agent` — Synchronous inter-agent messaging
- `create_task` / `update_task` / `list_tasks` — Kanban task management
- `list_agents` — Discover other agents

A background task scanner (30s interval) auto-dispatches backlog tasks to agents matching `assignedRole`.

### Agent Roles (`electron/store.js`)

Predefined roles with Chinese-language system prompts:
- `general` — Default, no special prompt
- `pm` — Project manager (task decomposition, delegation)
- `developer` — Programmer (code, implementation)
- `tester` — QA tester (testing, bug reporting)

### Provider Interface (`electron/providers.js`)

Unified `chatWithProvider(messages, providerConfig)` supporting:
- **MiniMax** — Native HTTP API (Anthropic Messages format)
- **DeepSeek** — OpenAI SDK compatible (supports reasoner models)
- **Ollama** — Local models via REST API

All providers support multimodal (vision) via `images` array on messages.

## Conventions

- All Electron main-process code uses CommonJS (`require`/`module.exports`)
- React code uses ESM imports with JSX
- No TypeScript — plain JavaScript throughout
- UI text is mixed Chinese/English; agent role prompts are in Chinese
- State persistence via electron-store with a defined schema
- IPC communication via `ipcMain.handle` / `ipcRenderer.invoke` pattern
- Skills are self-contained folders; adding a new skill requires no changes to core code
