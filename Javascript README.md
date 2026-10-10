# Autonomous Local Agent

This workspace contains a lightweight local AI agent that connects a browser UI to LM Studio and gives the model access to web search, stock lookup, and weather tools. The model decides when to use those tools and then returns a final answer based on the results.

## Project structure

- `LM Studio Stream Chat.html` — browser chat interface
- `LM Studio Stream Chat-Base.html` — base/browser version of the same UI
- `agent-backend/server.js` — Express backend and tool-calling loop
- `agent-backend/tools.js` — search, stock, and weather tool implementations
- `agent-backend/package.json` — Node scripts and dependencies
- `agent-backend/README.md` — backend-specific setup and usage details

## Main features

- local LM Studio model integration via OpenAI-compatible API
- streaming status and final answer updates in the browser
- autonomous tool calling through `<tool_call ... />` syntax
- web search through a public Searx endpoint with fallback handling
- Yahoo Finance stock quotes
- weather lookup via `wttr.in`
- no shell execution and no local file modification

## Requirements

- macOS or another Unix-like system with `sh` and `lsof`
- Node.js 22 or newer, including npm ([download Node.js](https://nodejs.org/en/download/))
- LM Studio installed with a model downloaded
- a modern browser

## Install On A Second Server

1. Copy the complete project folder to the second server. Include both HTML files and the entire `agent-backend` folder. Do not copy `agent-backend/node_modules`; it will be recreated there.
2. Install Node.js 22 or newer on the second server. Open a new terminal and confirm both commands work:

```sh
node --version
npm --version
```

3. Install LM Studio on the second server, download a chat model, load it, and start LM Studio's local API server. The default API address is `http://localhost:1234/v1`.
4. In LM Studio's API server/model list, note the exact model identifier. Set it in the terminal before starting the backend. The configured identifier is sent to LM Studio as the model name:

```sh
export LM_STUDIO_MODEL="provider/model-name"
```

For a model identifier without a provider prefix, set the exact identifier LM Studio displays. Optional settings are described in [agent-backend/README.md](agent-backend/README.md).

5. Install the backend dependencies and start the server:

```sh
cd agent-backend
npm install
npm start
```

The backend listens on port `3000`. Keep this terminal open while using the app. Open `LM Studio Stream Chat.html` in a browser on the same computer as the backend; the HTML client sends requests to `http://localhost:3000/chat`.

## Start, Stop, Restart

Start the backend from the project folder:

```sh
cd agent-backend
npm start
```

Stop it cleanly by focusing the terminal running it and pressing `Ctrl+C`. Do not use `Ctrl+Z`; that suspends the process without freeing its port.

To restart the backend and automatically clear an existing listener on the configured port:

```sh
cd agent-backend
sh restart.sh
```

The restart script stops the listener on `PORT` (default `3000`) and starts the backend again. Press `Ctrl+C` in that terminal to stop the restarted server.

## Environment variables

```bash
LM_STUDIO_MODEL="your-model-name"
LM_STUDIO_BASE_URL="http://localhost:1234/v1"
PORT=3000
SEARX_BASE_URL="https://priv.au"
SEARCH_FALLBACK_URL="https://search.ononoki.org"
SEARX_MAX_ATTEMPTS=4
```

Set optional values in the same terminal before running `npm start` or `sh restart.sh`. For example:

```sh
export LM_STUDIO_MODEL="provider/model-name"
export PORT=3000
```

## Supported agent tools

- `model_identity(detail)` — reports the configured model name or provider from `LM_STUDIO_MODEL`
- `searxng_search(query)` — searches the web via the configured SearXNG endpoint and fallback SearXNG route, shown in the UI as “Searching SearXNG...”
- `stock_search(symbols, fields)` — returns stock quote information for one or more symbols
- `weather_search(location)` — returns the current weather for a location

## Example prompts

- "What is the weather in Seattle?"
- "What is the price of AAPL and MSFT?"
- "Search for recent updates on electric vehicles"

## Notes

- The backend talks directly to LM Studio, so browser CORS is not required there.
- The search provider may rate-limit requests when used heavily.
- The project is a prototype local agent, not a full production-grade app framework.

## Validation

```bash
cd "agent-backend"
npm test
```

This runs the project syntax check to confirm the code is valid.
