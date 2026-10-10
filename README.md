# Local Agent Backend

This project is a lightweight local autonomous agent that connects a browser chat UI to LM Studio and gives the model access to tools for web search, stock quotes, and weather. It does not execute shell commands or modify local files.

## Overview

The backend in `server.js` starts an Express service on port `3000`, sends prompts to LM Studio using the OpenAI-compatible API, parses tool calls from the model, executes them, and feeds the results back into the conversation until the model produces a final answer.

## Included tools

- `model_identity(detail)` — reports the configured LM Studio model name (`detail: "model_name"`) or provider (`detail: "creator"`), parsed from `LM_STUDIO_MODEL` at its first `/`
- `searxng_search(query)` — tries the configured primary SearXNG endpoint, then a bounded pool of healthy public instances discovered from the [SearXNG instance directory](https://searx.space/); the UI labels this step as “Searching SearXNG...”
- `stock_search(symbols, fields)` — gets Yahoo Finance quote data for one or more symbols
- `weather_search(location)` — fetches the current weather for a given location from `wttr.in`

## Requirements

- macOS or another Unix-like system with `sh` and `lsof`
- Node.js 22 or newer, including npm ([download Node.js](https://nodejs.org/en/download/))
- LM Studio installed, with a chat model downloaded and loaded
- a modern browser

## Install On A Second Server

1. Copy the complete project folder to the second server, including both chat HTML files and `agent-backend`. Leave out `agent-backend/node_modules` if transferring an existing installation; npm will recreate it.
2. Install Node.js 22 or newer, then open a new terminal and confirm the installation:

```sh
node --version
npm --version
```

3. Install and open LM Studio. Download and load the model you want to use, then start LM Studio's local API server. By default the backend connects to `http://localhost:1234/v1`.
4. Find the exact model identifier in LM Studio. The backend sends `LM_STUDIO_MODEL` as the model identifier. Set it in the terminal where you will run the backend; for an identifier such as `provider/model-name`:

```sh
export LM_STUDIO_MODEL="provider/model-name"
```

If LM Studio is on another computer, set `LM_STUDIO_BASE_URL` to its reachable OpenAI-compatible API address instead of `http://localhost:1234/v1`. Keep the API accessible only on a trusted network.

5. Install backend dependencies and start the server:

```sh
cd agent-backend
npm install
npm start
```

The backend listens at `http://localhost:3000`. Keep the terminal open while the app is in use. Open `LM Studio Stream Chat.html` in a browser on the same computer as the backend; the browser client is configured to send requests to `http://localhost:3000/chat`.

## Start, Stop, Restart

Start the server from the `agent-backend` directory:

```sh
npm start
```

To stop cleanly, focus the terminal running the server and press `Ctrl+C`. Avoid `Ctrl+Z`, which suspends the process and leaves the port occupied.

To restart and automatically release an existing listener on the configured port:

```sh
sh restart.sh
```

This script stops the process listening on `PORT` (default `3000`) and starts the backend again. Press `Ctrl+C` in that terminal when finished.

## Environment variables

```bash
LM_STUDIO_MODEL="your-model-name"
LM_STUDIO_BASE_URL="http://localhost:1234/v1"
PORT=3000
SEARX_BASE_URL="https://priv.au"
SEARCH_FALLBACK_URL="https://search.ononoki.org"
SEARX_MAX_ATTEMPTS=4
```

Set an override in the same terminal before starting the server, for example:

```sh
export LM_STUDIO_MODEL="provider/model-name"
export PORT=3000
```

- `LM_STUDIO_MODEL` changes the model identifier sent to LM Studio.
- `model_identity(detail)` reports the portion after the first `/` as the model name and the portion before it as the provider.
- `model_identity` uses the portion after the first `/` as the model name and the portion before it as the provider.
- `LM_STUDIO_BASE_URL` changes the LM Studio API URL.
- `PORT` changes the backend listen port.
- `SEARX_BASE_URL` overrides the primary web search endpoint.
- `SEARCH_FALLBACK_URL` adds an endpoint to the fallback pool.
- `SEARX_MAX_ATTEMPTS` limits the total number of SearXNG endpoints tried per query, including the primary (default: `4`, maximum: `8`).

If the primary endpoint fails, the backend refreshes its public-instance list from `https://searx.space/data/instances.json` and caches it for six hours. It only considers HTTPS instances reporting HTTP 200, at least 50% recent search success, at least 80% monthly uptime when available, and no analytics. Fallback order is randomized; requests are sequential, stop at the first successful result, and time out after five seconds per endpoint. The directory is not fetched when the primary succeeds.

## Tool call format

The model is instructed to issue tool calls in this format:

```text
<tool_call name="TOOL_NAME" args='{"arg1":"val1"}' />
```

Examples:

```text
<tool_call name="searxng_search" args='{"query":"electric vehicle sales 2026"}' />
<tool_call name="model_identity" args='{"detail":"model_name"}' />
<tool_call name="model_identity" args='{"detail":"creator"}' />
<tool_call name="stock_search" args='{"symbols":["AAPL","MSFT"]}' />
<tool_call name="weather_search" args='{"location":"Seattle"}' />
```

## API route

```http
POST /chat
Content-Type: application/json
```

Example request:

```json
{
  "prompt": "What is the weather in Seattle?"
}
```

The response uses NDJSON events such as:

- `status`
- `final`
- `error`

## Project files

- `server.js` — Express app, model integration, agent loop, and `/chat` route
- `tools.js` — search, stock, and weather tool functions
- `package.json` — scripts and dependencies
- `LM Studio Stream Chat.html` — browser client that sends prompts and streams results
- `LM Studio Stream Chat-Base.html` — base UI version

## Validation

```bash
npm test
```

This runs Node syntax checks for the backend JavaScript files.

## Troubleshooting

### Backend not reachable

- make sure `npm start` is running
- confirm the app is listening on port `3000`
- check that LM Studio is active and serving the local API

### LM Studio not responding

- verify the local server is running at `http://localhost:1234`
- set `LM_STUDIO_BASE_URL` if the port or address differs
- set `LM_STUDIO_MODEL` if the loaded model name is not recognized

### Search endpoint rate-limiting

- the tool automatically tries a fallback source
- if this still fails, switch providers with `SEARX_BASE_URL` and `SEARCH_FALLBACK_URL`

## Example prompts

- "Search for recent electric vehicle sales reports"
- "What is the price of AAPL and MSFT?"
- "What is the weather in Seattle?"
- "Show AAPL's 52-week range and current day range"
