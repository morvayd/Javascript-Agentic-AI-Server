# ADR 0001: Project Architecture and Agent Design

## Status
Accepted

## Context
The project requires a lightweight, autonomous backend that can bridge a browser-based chat interface with a local Large Language Model (LLM) via LM Studio. The goal is to provide the model with specific capabilities (web search, stock quotes, and weather) while maintaining security by restricting access to shell commands or local file modifications.

## Decision

### 1. Backend Framework
We will use **Node.js** with the **Express** framework. This provides a lightweight, non-blocking, and asynchronous environment suitable for handling multiple concurrent streaming requests and I/O-bound tasks (like API calls to LLMs and search engines).

### 2. Agentic Interaction Model
We will implement an **Agentic Loop** (the `agentLoop` function). Instead of a simple request-response pattern, the backend will support multiple turns of tool execution per user prompt (up to 6 rounds). This allows the agent to:
- Analyze a user request.
- Decide to use a tool.
- Receive the tool result.
- Analyze the result and potentially use another tool or provide a final answer.

### 3. Tool Calling Protocol
The interaction between the LLM and the backend for tool invocation will use a **custom XML-like tag format**:
`<tool_call name="TOOL_NAME" args='{"arg1": "val1"}' />`

This format was chosen because:
- It is highly predictable and easily parsed using regular expressions.
- It is a common pattern for LLM tool-calling capabilities.
- It clearly separates tool calls from regular conversational text.

### 4. Communication Protocol (Streaming)
To provide a responsive user experience, the backend will communicate with the frontend using **NDJSON (Newline Delimited JSON)** over a single HTTP connection. This allows the server to stream different types of events:
- `status`: Information about the current state (e.g., "Thinking...", "Working...").
- `final`: The final answer from the LLM.
- `error`: Error messages if a tool or the LLM fails.

### 5. External Tooling and Services
- **Web Search**: We will use **SearXNG**. To ensure high availability, we implement a fallback mechanism. If the primary configured SearXNG instance fails, the agent will attempt to use healthy, public, HTTPS-only instances discovered dynamically from the `searx.space` instance directory.
- **Finance Data**: We will use the `yahoo-finance2` library to fetch reliable and comprehensive stock market data.
- **Weather Data**: We will use the `wttr.in` service for its lightweight and simple API.

### 6. LLM Integration
We will use the **OpenAI Node.js SDK** to interact with the LLM. To support local models, the `baseURL` will be configurable (defaulting to LM Studio's local server at `http://localhost:1234/v1`).

## Consequences

### Pros
- **Extensibility**: Adding a new tool is a simple two-step process: implementing the function in `tools.js` and adding its definition to the system prompt.
- **Robustness**: The dynamic search fallback mechanism makes the search capability resilient to individual service outages.
- **User Experience**: Streaming via NDJSON provides real-time feedback, making the agent's "thought process" visible to the user.
- **Security**: The agent is intentionally sandboxed, with no access to the underlying operating system's shell or filesystem.

### Cons
- **Loop Limit**: To prevent infinite execution loops (which could consume excessive resources), the agent loop is capped at 6 iterations.
- **Parsing Dependency**: The system's reliability depends on the LLM's ability to strictly adhere to the XML-like tool calling format.
