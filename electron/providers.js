/**
 * Unified LLM provider interface.
 * Supports: MiniMax (Anthropic Messages API), DeepSeek (OpenAI-compatible), Ollama.
 */

const { net } = require("electron");

// --- MiniMax (Anthropic Messages format) ---

async function minimaxChat(messages, { endpoint, apiKey, model }) {
  const url = endpoint || "https://api.minimaxi.com/anthropic/v1/messages";
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
      messages,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`MiniMax error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  const textBlock = (data.content || []).find((b) => b.type === "text");
  return textBlock?.text || "";
}

// --- DeepSeek (OpenAI-compatible) ---

async function deepseekChat(messages, { endpoint, apiKey, model }) {
  const url = endpoint || "https://api.deepseek.com/v1/chat/completions";
  const response = await net.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "deepseek-chat",
      messages,
      max_tokens: 8192,
    }),
  });
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw new Error(`DeepSeek error: ${response.status} ${errText}`);
  }
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

// --- Ollama ---

async function ollamaChat(messages, { endpoint, model }) {
  const base = endpoint || "http://127.0.0.1:11434";
  const url = `${base}/api/chat`;
  const response = await net.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model || "gemma3:4b",
      messages,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama chat error: ${response.status}`);
  }
  const data = await response.json();
  return data.message?.content || "";
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
