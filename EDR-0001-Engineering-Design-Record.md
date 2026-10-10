# EDR 0001: Engineering Design Record - Local Agent Backend Implementation

## 1. Introduction
This document provides a detailed technical specification of the implementation of the Local Agent Backend. While the ADR (Architecture Decision Record) focuses on high-level architectural choices, this Engineering Design Record (EDR) describes the low-level component design, data flow, and implementation details.

## 2. System Architecture Overview
The backend is a Node.js application built with Express. It functions as an intermediary between a client-side UI and a local LLM server (LM Studio). It implements an autonomous agent loop that can iteratively call external tools to fulfill user requests.

### 2.1 Component Diagram (Logic Flow)
1.  **API Layer (`server.js`)**: Handles HTTP requests, manages the agent lifecycle, and streams responses via NDJSON.
2.  **Agent Orchestrator (`server.js`)**: Implements the recursive `agentLoop` which manages the conversation history and decision-making process.
3.  **Tool Execution Module (`tools.js`)**: A collection of asynchronous functions that interface with external APIs (SearXNG, Yahoo Finance, wttr.in).
4.  **External Services**:
    *   **LLM Server (LM Studio)**: The intelligence provider.
    *   **SearXNG**: The web search engine.
    *   **Yahoo Finance**: The market data provider.
    *   **wttr.in**: The weather data provider.

## 3. Detailed Component Design

### 3.1 Agent Orchestrator (`server.js`)
The core logic resides in the `agentLoop(messages, onStatus, toolRounds)` function.

*   **Input**: `messages` (array of message objects), `onStatus` (callback for streaming updates), `toolRounds` (current iteration count).
*   **State Management**: The `messages` array is updated in-place to maintain conversation context, including tool results.
*   **Recursive Loop**:
    1.  Send current `messages` to the LLM via the OpenAI SDK.
    2.  Parse the LLM response for the `<tool_call>` pattern.
    3.  If a tool call is found:
        *   Execute the corresponding function from `tools.js`.
        *   Append the result to `messages` with the `user` role.
        *   Recursively call `agentLoop`, incrementing `toolRounds`.
        *   Stop if `toolRounds >= MAX_TOOL_ROUNDS` (6).
    4.  If no tool call is found, return the content as the final answer.

### 3.2 Tool Execution Module (`tools.js`)
Each tool is implemented as an asynchronous function within the `tools` object.

#### 3.2.1 `searxng_search(query)`
Implements a resilient search mechanism.
*   **Primary Endpoint**: Uses `SEARX_BASE_URL` or a default.
*   **Dynamic Discovery**: If the primary fails, it fetches the latest instance directory from `https://searx.space/data/instances.json`.
*   **Filtering Logic**: Only includes endpoints that meet specific criteria:
    *   Protocol is `https`.
    *   Public/Normal network type.
    *   No analytics enabled.
    *   HTTP status code is 200.
    *   Success rate $\ge$ 50%.
    *   Uptime $\ge$ 80%.
*   **Retry Logic**: Attempts up to `MAX_SEARCH_ATTEMPTS` (default 4) using a shuffled list of available endpoints.

#### 3.2.2 `stock_search(symbols, fields)`
*   Uses the `yahoo-finance2` library for data retrieval.
*   **Normalization**: Normalizes symbols (handling arrays/strings) and requested fields to ensure all required metadata (`symbol`, `currency`, etc.) is retrieved.
*   **Formatting**: Converts complex finance objects into human-readable string summaries.

#### 3.2.3 `weather_search(location)`
*   Performs an asynchronous HTTP GET request to `wttr.in/${location}?2`.
*   The `?2` parameter is used to request a more detailed/formatted response.

#### 3.2.4 `model_identity(detail)`
*   Parses the `LM_STUDIO_MODEL` environment variable.
*   Uses string splitting at the first `/` to distinguish between `provider` and `model_name`.

### 3.3 Communication Layer
The server uses **Server-Sent Events (SSE)** principles via **NDJSON** (Newline Delimited JSON).

*   **Endpoint**: `POST /chat`
*   **Response Headers**:
    *   `Content-Type: application/x-ndjson; charset=utf-8`
    *   `Cache-Control: no-cache, no-transform`
    *   `X-Accel-Buffering: no` (Crucial for preventing buffering in proxy environments).
*   **Event Types**:
    *   `{"type": "status", "message": "..."}`: Provides real-time updates to the UI.
    *   `{"type": "final", "content": "..."}`: The terminal message containing the agent's response.
    *   `{"type": "error", "message": "..."}`: Captures failures in the agent loop or tool execution.

## 4. Resiliency and Error Handling

### 4.1 Process Management
*   **Port Collision Prevention**: The `releasePortIfOccupied(port)` function uses `lsof` via `execSync` to identify and `kill -TERM` processes currently listening on the configured port. This ensures the server can restart cleanly.
*   **Graceful Shutdown**: Listens for `SIGINT`, `SIGTERM`, and `SIGHUP` to close the Express server and perform cleanup before exiting.

## 5. Configuration and Environment
The system is highly configurable via environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `LM_STUDIO_MODEL` | `google/gemma-4-26b-a4b-qat` | Model identifier sent to the LLM. |
| `LM_STUDIO_BASE_URL` | `http://localhost:1234/v1` | API endpoint for the LLM. |
| `PORT` | `3000` | Port the backend listens on. |
| `SEARX_BASE_URL` | `https://priv.au` | Primary SearXNG instance. |
| `SEARCH_FALLBACK_URL`| `https://search.ononoki.org` | Secondary SearXNG instance. |
| `SEARX_MAX_ATTEMPTS` | `4` | Max search attempts (range 1-8). |

## 6. Conclusion
The implementation follows a modular design where the agent's intelligence is decoupled from the tool execution logic. The use of streaming NDJSON and a recursive agent loop provides a modern, responsive, and capable interface for interacting with local LLMs.

