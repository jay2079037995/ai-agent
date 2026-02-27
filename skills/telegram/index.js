const TelegramBot = require("node-telegram-bot-api");

// Per-agent bot instances
const bots = new Map(); // agentId -> { bot, sessions: Map<chatId, history[]> }

async function sendTelegramLong(bot, chatId, text) {
  const MAX_LEN = 4000;
  if (text.length <= MAX_LEN) {
    await bot.sendMessage(chatId, text);
    return;
  }
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LEN) {
      await bot.sendMessage(chatId, remaining);
      break;
    }
    let cutIndex = remaining.lastIndexOf("\n", MAX_LEN);
    if (cutIndex < MAX_LEN * 0.3) cutIndex = MAX_LEN;
    const chunk = remaining.slice(0, cutIndex);
    remaining = remaining.slice(cutIndex).trimStart();
    await bot.sendMessage(chatId, chunk);
  }
}

/**
 * Start a Telegram bot for an agent.
 * @param {string} agentId
 * @param {object} config - { token, autoStart }
 * @param {object} deps - { getAgentConfig, agentLoop }
 */
function startService(agentId, config, deps) {
  const token = config.token || "";
  if (!token || token === "YOUR_BOT_TOKEN_HERE") {
    console.log(`Telegram bot for agent ${agentId}: missing or placeholder token.`);
    return false;
  }

  if (bots.has(agentId)) {
    console.log(`Telegram bot for agent ${agentId} already running.`);
    return true;
  }

  try {
    const bot = new TelegramBot(token, { polling: true });
    const sessions = new Map();
    bots.set(agentId, { bot, sessions });
    console.log(`Telegram bot started for agent ${agentId}.`);

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      if (!text) return;

      if (text === "/start") {
        const agentConfig = deps.getAgentConfig(agentId);
        await bot.sendMessage(
          chatId,
          `${agentConfig.name} AI Agent 已连接。\n\n直接发送消息即可提问，AI 可以调用已安装的 skill 工具帮你完成任务。\n\n命令：\n/clear — 清空对话历史\n/model — 查看当前模型\n/status — 查看状态`
        );
        return;
      }

      if (text === "/clear") {
        sessions.set(chatId, []);
        await bot.sendMessage(chatId, "对话历史已清空。");
        return;
      }

      if (text === "/model") {
        const agentConfig = deps.getAgentConfig(agentId);
        const label = `${agentConfig.provider.type} — ${agentConfig.provider.model}`;
        await bot.sendMessage(chatId, `当前模型: ${label}`);
        return;
      }

      if (text === "/status") {
        const session = sessions.get(chatId) || [];
        const agentConfig = deps.getAgentConfig(agentId);
        await bot.sendMessage(
          chatId,
          `状态: 运行中\n当前模型: ${agentConfig.provider.type} — ${agentConfig.provider.model}\n对话历史: ${session.length} 条消息`
        );
        return;
      }

      // Regular message → agent loop
      if (!sessions.has(chatId)) sessions.set(chatId, []);
      const session = sessions.get(chatId);
      await bot.sendChatAction(chatId, "typing");

      try {
        const agentConfig = deps.getAgentConfig(agentId);
        const result = await deps.agentLoop(text, session, agentConfig, agentId);

        session.push({ role: "user", content: text });
        session.push({ role: "assistant", content: result.output || "" });
        // Trim session to last 20 entries
        while (session.length > 20) session.shift();

        const reply = result.output || "（AI 无回复）";
        await sendTelegramLong(bot, chatId, reply);
      } catch (err) {
        console.log(`Telegram agent error for agent ${agentId}, chat ${chatId}: ${err.message}`);
        await bot.sendMessage(chatId, `出错了: ${err.message}`);
      }
    });

    bot.on("polling_error", (err) => {
      console.log(`Telegram polling error (agent ${agentId}): ${err.message}`);
    });

    return true;
  } catch (err) {
    console.log(`Failed to start Telegram bot for agent ${agentId}: ${err.message}`);
    bots.delete(agentId);
    return false;
  }
}

function stopService(agentId) {
  const entry = bots.get(agentId);
  if (entry) {
    entry.bot.stopPolling();
    bots.delete(agentId);
  }
  console.log(`Telegram bot stopped for agent ${agentId}.`);
}

function isRunning(agentId) {
  return bots.has(agentId);
}

function stopAll() {
  for (const [agentId] of bots) {
    stopService(agentId);
  }
}

module.exports = { startService, stopService, isRunning, stopAll };
