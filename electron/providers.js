/**
 * Unified LLM provider interface.
 * Supports: MiniMax (Anthropic Messages API), DeepSeek (OpenAI SDK), Ollama.
 *
 * Messages may include an optional `images` array for vision/multimodal:
 *   { role: "user", content: "text", images: [{ base64: "...", mediaType: "image/png" }] }
 * Each provider transforms this to its native format automatically.
 */

const { net } = require("electron");
const OpenAI = require("openai");

// --- Image-aware message transformers ---

/** Anthropic Messages format: content becomes array of text + image blocks */
function toAnthropicMessages(messages) {
  return messages.map((msg) => {
    if (!msg.images || msg.images.length === 0) {
      return { role: msg.role, content: msg.content };
    }
    const content = [{ type: "text", text: msg.content }];
    for (const img of msg.images) {
      content.push({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      });
    }
    return { role: msg.role, content };
  });
}

/** OpenAI format: content becomes array of text + image_url blocks */
function toOpenAIMessages(messages) {
  return messages.map((msg) => {
    if (!msg.images || msg.images.length === 0) {
      return { role: msg.role, content: msg.content };
    }
    const content = [{ type: "text", text: msg.content }];
    for (const img of msg.images) {
      content.push({
        type: "image_url",
        image_url: { url: `data:${img.mediaType};base64,${img.base64}` },
      });
    }
    return { role: msg.role, content };
  });
}

/** Ollama format: images as separate base64 array */
function toOllamaMessages(messages) {
  return messages.map((msg) => {
    if (!msg.images || msg.images.length === 0) {
      return { role: msg.role, content: msg.content };
    }
    return {
      role: msg.role,
      content: msg.content,
      images: msg.images.map((img) => img.base64),
    };
  });
}

// --- MiniMax (Anthropic Messages format) ---

async function minimaxChat(messages, { endpoint, apiKey, model }) {
  const url = endpoint || "https://api.minimaxi.com/anthropic/v1/messages";
  const prepared = toAnthropicMessages(messages);
  const response = await net.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2024-06-20",
    },
    body: JSON.stringify({
      model: model || "MiniMax-M2.5",
      max_tokens: 8192,
      messages: prepared,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`MiniMax error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return { content: textBlock?.text || "", reasoning: null };
}

// --- DeepSeek (OpenAI SDK) ---

async function deepseekChat(messages, { endpoint, apiKey, model }) {
  const baseURL = endpoint || "https://api.deepseek.com";
  const client = new OpenAI({ baseURL, apiKey });
  const isReasoner = (model || "").includes("reasoner");
  const prepared = toOpenAIMessages(messages);

  const params = {
    model: model || "deepseek-chat",
    messages: prepared,
  };
  if (!isReasoner) {
    params.max_tokens = 8192;
  }

  const completion = await client.chat.completions.create(params);
  const msg = completion.choices?.[0]?.message || {};
  const content = msg.content || "";
  const reasoning = msg.reasoning_content || null;
  return { content, reasoning };
}

// --- Ollama ---

async function ollamaChat(messages, { endpoint, model }) {
  const base = endpoint || "http://127.0.0.1:11434";
  const url = `${base}/api/chat`;
  const prepared = toOllamaMessages(messages);
  const response = await net.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "gemma3:4b",
      messages: prepared,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat error: ${response.status}`);
  }
  const data = await response.json();
  return { content: data.message?.content || "", reasoning: null };
}

async function ollamaGenerate(prompt, { endpoint, model } = {}) {
  const base = endpoint || "http://127.0.0.1:11434";
  const url = `${base}/api/generate`;
  const response = await net.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "gemma3:4b",
      prompt,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }
  const data = await response.json();
  return data.response || "";
}

// --- Unified entry point ---

/**
 * Unified chat entry point.
 * Returns { content: string, reasoning: string | null }.
 */
async function chatWithProvider(messages, providerConfig) {
  const { type, apiKey, model, endpoint } = providerConfig;
  switch (type) {
    case "minimax":
      return minimaxChat(messages, { endpoint, apiKey, model });
    case "deepseek":
      return deepseekChat(messages, { endpoint, apiKey, model });
    case "ollama":
      return ollamaChat(messages, { endpoint, model });
    default:
      throw new Error(`Unknown provider type: ${type}`);
  }
}

module.exports = {
  minimaxChat,
  deepseekChat,
  ollamaChat,
  ollamaGenerate,
  chatWithProvider,
};
