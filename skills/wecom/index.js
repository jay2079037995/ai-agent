const https = require("https");

/**
 * Send a request to the WeCom Webhook API.
 * @param {string} webhookUrl - Full webhook URL
 * @param {object} body - Request payload
 * @returns {Promise<object>} - API response
 */
function sendWebhook(webhookUrl, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(webhookUrl);
    const data = JSON.stringify(body);

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (chunk) => (chunks += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(chunks));
          } catch {
            resolve({ errcode: -1, errmsg: chunks });
          }
        });
      }
    );

    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

/**
 * Execute a wecom tool.
 * @param {string} toolName
 * @param {object} args
 * @param {object} context - { agentId, agentSkills }
 */
async function executeTool(toolName, args, context) {
  const webhookUrl =
    context.agentSkills?.wecom?.config?.webhookUrl || "";

  if (!webhookUrl) {
    return "Error: 企业微信 Webhook URL 未配置。请在 skill 设置中填入 Webhook 地址。";
  }

  if (toolName === "wecom_send_text") {
    const content = args.content || "";
    if (!content) return "Error: content is required.";

    const payload = {
      msgtype: "text",
      text: { content },
    };
    if (args.mentioned_list) {
      payload.text.mentioned_list = args.mentioned_list;
    }
    if (args.mentioned_mobile_list) {
      payload.text.mentioned_mobile_list = args.mentioned_mobile_list;
    }

    try {
      const res = await sendWebhook(webhookUrl, payload);
      if (res.errcode === 0) return "Text message sent successfully.";
      return `Error sending text: ${res.errmsg} (code: ${res.errcode})`;
    } catch (err) {
      return `Error sending text: ${err.message}`;
    }
  }

  if (toolName === "wecom_send_markdown") {
    const content = args.content || "";
    if (!content) return "Error: content is required.";

    const payload = {
      msgtype: "markdown",
      markdown: { content },
    };

    try {
      const res = await sendWebhook(webhookUrl, payload);
      if (res.errcode === 0) return "Markdown message sent successfully.";
      return `Error sending markdown: ${res.errmsg} (code: ${res.errcode})`;
    } catch (err) {
      return `Error sending markdown: ${err.message}`;
    }
  }

  if (toolName === "wecom_send_news") {
    const title = args.title || "";
    if (!title) return "Error: title is required.";
    if (!args.url) return "Error: url is required.";

    const article = {
      title,
      url: args.url,
    };
    if (args.description) article.description = args.description;
    if (args.picurl) article.picurl = args.picurl;

    const payload = {
      msgtype: "news",
      news: { articles: [article] },
    };

    try {
      const res = await sendWebhook(webhookUrl, payload);
      if (res.errcode === 0) return "News card sent successfully.";
      return `Error sending news: ${res.errmsg} (code: ${res.errcode})`;
    } catch (err) {
      return `Error sending news: ${err.message}`;
    }
  }

  return `Error: Unknown tool "${toolName}" in wecom skill.`;
}

module.exports = { executeTool };
