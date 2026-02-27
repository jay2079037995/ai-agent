/**
 * Per-agent Telegram bot lifecycle.
 */

const TelegramBot = require("node-telegram-bot-api");
const runtime = require("./runtime");
const { getAgent } = require("./store");
const { agentLoop } = require("./agent-loop");

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

function startTelegramBot(agentId) {
  const agentConfig = getAgent(agentId);
  if (!agentConfig) return false;

  const token = agentConfig.telegram?.token;
  if (!token || token === "YOUR_BOT_TOKEN_HERE") {
    console.log(`Telegram bot for agent ${agentId}: missing or placeholder token.`);
    return false;
  }

  if (runtime.isTelegramRunning(agentId)) {
    console.log(`Telegram bot for agent ${agentId} already running.`);
    return true;
  }

  try {
    const bot = new TelegramBot(token, { polling: true });
    runtime.setTelegramBot(agentId, bot);
    runtime.setTelegramRunning(agentId, true);
    console.log(`Telegram bot started for agent ${agentId} (${agentConfig.name}).`);

    bot.on("message", async (msg) => {
      const chatId = msg.chat.id;
      const text = (msg.text || "").trim();
      if (!text) return;

      if (text === "/start") {
        await bot.sendMessage(
          chatId,
          `${agentConfig.name} AI Agent 已连接。\n\n直接发送消息即可提问，AI 可以调用搜索、浏览器、Shell 等工具帮你完成任务。\n\n命令：\n/clear — 清空对话历史\n/model — 查看当前模型\n/status — 查看状态`
        );
        return;
      }

      if (text === "/clear") {
        runtime.getTelegramSession(agentId, chatId).length = 0;
        await bot.sendMessage(chatId, "对话历史已清空。");
        return;
      }

      if (text === "/model") {
        const cfg = getAgent(agentId);
        const label = `${cfg.provider.type} — ${cfg.provider.model}`;
        await bot.sendMessage(chatId, `当前模型: ${label}`);
        return;
      }

      if (text === "/status") {
        const session = runtime.getTelegramSession(agentId, chatId);
        const cfg = getAgent(agentId);
        await bot.sendMessage(
          chatId,
          `状态: 运行中\n当前模型: ${cfg.provider.type} — ${cfg.provider.model}\n对话历史: ${session.length} 条消息`
        );
        return;
      }

      // Regular message → agent loop
      const session = runtime.getTelegramSession(agentId, chatId);
      await bot.sendChatAction(chatId, "typing");

      try {
        const cfg = getAgent(agentId);
        const result = await agentLoop(text, session, cfg, agentId);

        session.push({ role: "user", content: text });
        session.push({ role: "assistant", content: result.output || "" });
        runtime.trimTelegramSession(agentId, chatId);

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
    runtime.setTelegramRunning(agentId, false);
    runtime.setTelegramBot(agentId, null);
    return false;
  }
}

function stopTelegramBot(agentId) {
  const bot = runtime.getTelegramBot(agentId);
  if (bot) {
    bot.stopPolling();
    runtime.setTelegramBot(agentId, null);
  }
  runtime.setTelegramRunning(agentId, false);
  console.log(`Telegram bot stopped for agent ${agentId}.`);
}

function stopAllTelegramBots() {
  for (const [agentId] of runtime.getAll()) {
    if (runtime.isTelegramRunning(agentId)) {
      stopTelegramBot(agentId);
    }
  }
}

module.exports = { startTelegramBot, stopTelegramBot, stopAllTelegramBots };
