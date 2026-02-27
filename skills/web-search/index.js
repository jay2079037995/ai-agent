const { net } = require("electron");

async function braveSearch(apiKey, query) {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`;
  const response = await net.fetch(url, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Brave Search API error: ${response.status}`);
  }
  const data = await response.json();
  return (data.web?.results || []).slice(0, 8).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description || "",
  }));
}

async function executeTool(toolName, args, context) {
  if (toolName !== "web_search") {
    return `Error: Unknown tool "${toolName}" in web-search skill.`;
  }

  const query = args.query || args.q || "";
  if (!query) return "Error: web_search requires a 'query' argument.";

  const config = context.config || {};
  const apiKey = config.braveApiKey || "";
  if (!apiKey) return "Error: Brave API key not configured. Please configure the Web Search skill.";

  try {
    const results = await braveSearch(apiKey, query);
    if (results.length === 0) return "No results found.";
    return results.map((r, i) => `[${i + 1}] ${r.title}\n${r.description}`).join("\n\n");
  } catch (e) {
    return `Search error: ${e.message}`;
  }
}

module.exports = { executeTool, braveSearch };
