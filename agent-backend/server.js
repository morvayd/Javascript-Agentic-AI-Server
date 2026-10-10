const express = require('express');
const cors = require('cors');
const { execSync } = require('child_process');
const { OpenAI } = require('openai');
const tools = require('./tools');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const MODEL_NAME = process.env.LM_STUDIO_MODEL || 'google/gemma-4-26b-a4b-qat';
const LM_STUDIO_BASE_URL = process.env.LM_STUDIO_BASE_URL || 'http://localhost:1234/v1';
const MAX_TOOL_ROUNDS = 6;
const MODEL_NAME_SEPARATOR = MODEL_NAME.indexOf('/');
const MODEL_PROVIDER = MODEL_NAME_SEPARATOR >= 0 ? MODEL_NAME.slice(0, MODEL_NAME_SEPARATOR) : 'not specified';
const MODEL_DISPLAY_NAME = MODEL_NAME_SEPARATOR >= 0 ? MODEL_NAME.slice(MODEL_NAME_SEPARATOR + 1) : MODEL_NAME;

function getModelIdentity(detail) {
    if (detail === 'model_name') return `The configured LM Studio model name is ${MODEL_DISPLAY_NAME}.`;
    if (detail === 'creator') return `The configured LM Studio model provider is ${MODEL_PROVIDER}.`;
    return "Error: detail must be either 'model_name' or 'creator'.";
}

const openai = new OpenAI({
    baseURL: LM_STUDIO_BASE_URL,
    apiKey: 'not-needed', // LM Studio doesn't require an API key
});

const CURRENT_DATE_TIME_TEXT = () => {
    const now = new Date();
    const date = now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    const time = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    return `${date} at ${time} (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'})`;
};

const SYSTEM_PROMPT = `You are an autonomous agent with access to several tools. 
Your goal is to assist the user by executing tasks. 

Current system date and time: ${CURRENT_DATE_TIME_TEXT()}

Available Tools:
1. current_date(): Returns the current local calendar date.
2. current_time(): Returns the current local time.
3. current_datetime(): Returns the current local date and time.
4. model_identity(detail): Returns the configured LM Studio model name or its provider.
5. searxng_search(query): Searches the web using SearXNG.
6. stock_search(symbols, fields): Gets quotes for one or more stock symbols and requested quote fields.
7. weather_search(location): Gets current weather.

Rules:
- If you need to use a tool, you must respond with a tool call in this exact format:
  <tool_call name="TOOL_NAME" args='{"arg1": "val1", "arg2": "val2"}' />
- If a tool requires no arguments, send args='{}' exactly.
- Use no arguments for current_date, current_time, and current_datetime; use detail ('model_name' or 'creator') for model_identity; use query for searxng_search; use symbols (an array for multiple tickers) and optional fields for stock_search; use location for weather_search.
- When asked what model you are, call model_identity with detail='model_name'. When asked who made you or who created the model, call model_identity with detail='creator'. The configured identifier is split at its first slash: the text after it is the model name and the text before it is the provider.
- Supported stock fields: price, high, low, close, change, changePercent, previousClose, dayRange, volume, marketCap, pe, fiftyTwoWeekRange, fiftyTwoWeekHigh, fiftyTwoWeekLow, preMarketPrice, postMarketPrice, currency, marketState.
- Examples: <tool_call name="current_date" args='{}' /> and <tool_call name="current_time" args='{}' /> and <tool_call name="current_datetime" args='{}' /> and <tool_call name="searxng_search" args='{"query":"latest AI research"}' /> and <tool_call name="stock_search" args='{"symbols":["AAPL","MSFT"]}' /> and <tool_call name="stock_search" args='{"symbols":["AAPL"],"fields":["fiftyTwoWeekRange"]}' />
- Output tool calls without Markdown code fences.
- You can call multiple tools in one response by providing multiple <tool_call> tags.
- After receiving the result of a tool, you can decide to use more tools or provide the final answer to the user.
- Your final response should be a direct answer to the user's request, incorporating the information you've gathered from tools.
- If a tool returns an error, describe the error to the user or try to fix it if appropriate.
- Always treat the current system time above as the actual current date and time for the user context.

Always maintain a helpful and professional tone.`;

/**
 * Parses tool calls from a string.
 * @param {string} text 
 * @returns {Array<{name: string, args: object}>}
 */
function parseToolCalls(text) {
    const toolCallRegex = /<tool_call\s+name="([^"]+)"\s+args=(?:'({.*?})'|({.*?}))\s*\/?>/g;
    const calls = [];
    let match;
    while ((match = toolCallRegex.exec(text)) !== null) {
        try {
            const rawArgs = match[2] !== undefined ? match[2] : match[3];
            calls.push({
                name: match[1],
                args: rawArgs ? JSON.parse(rawArgs) : {}
            });
        } catch (e) {
            console.error("Failed to parse tool call arguments:", e);
        }
    }
    return calls;
}

/**
 * The core agentic loop.
 * @param {Array} messages 
 * @returns {Promise<string>} The final response string.
 */
async function agentLoop(messages, onStatus, toolRounds = 0) {
    // We'll use non-streaming for the reasoning phase to simplify tool-calling logic
    const response = await openai.chat.completions.create({
        model: MODEL_NAME,
        messages: messages,
        temperature: 0.1, // Low temperature for more stable tool calls
    });

    const content = response.choices?.[0]?.message?.content || "";
    console.log(`[Agent] Model response: ${content}`);

    const toolCalls = parseToolCalls(content);

    if (toolCalls.length > 0) {
        if (toolRounds >= MAX_TOOL_ROUNDS) {
            throw new Error(`Agent reached the ${MAX_TOOL_ROUNDS}-round tool limit.`);
        }
        // 1. Add the model's tool call message to the history
        messages.push({ role: 'assistant', content: content });

        // 2. Execute each tool
        for (const call of toolCalls) {
            console.log(`[Agent] Executing tool: ${call.name} with args:`, call.args);
            const toolStatus = {
                current_date: 'Checking current date...',
                current_time: 'Checking current time...',
                current_datetime: 'Checking current date and time...',
                model_identity: 'Checking the configured model...',
                searxng_search: 'Searching SearXNG...',
                stock_search: 'Checking stock price...',
                weather_search: 'Checking weather...'
            }[call.name] || 'Running requested tool...';
            onStatus({ type: 'status', message: toolStatus });
            let result;
            try {
                if (call.name === 'model_identity' || typeof tools[call.name] === 'function') {
                    if (call.name === 'current_date' || call.name === 'current_time' || call.name === 'current_datetime') {
                        result = await tools[call.name]();
                    } else if (call.name === 'model_identity') {
                        const detail = call.args?.detail;
                        result = typeof detail === 'string' ? getModelIdentity(detail.trim()) : "Error: detail must be either 'model_name' or 'creator'.";
                    } else if (call.name === 'stock_search') {
                        const symbols = call.args?.symbols ?? call.args?.symbol;
                        const validSymbols = typeof symbols === 'string'
                            ? Boolean(symbols.trim())
                            : Array.isArray(symbols) && symbols.length > 0 && symbols.every(symbol => typeof symbol === 'string' && symbol.trim());
                        if (!validSymbols || (call.args.fields !== undefined && !Array.isArray(call.args.fields))) {
                            result = `Error: Invalid arguments for tool '${call.name}'.`;
                        } else {
                            result = await tools.stock_search(symbols, call.args.fields);
                        }
                    } else {
                        const argumentName = {
                            searxng_search: 'query',
                            weather_search: 'location'
                        }[call.name];
                        if (!argumentName || typeof call.args?.[argumentName] !== 'string' || !call.args[argumentName].trim()) {
                            result = `Error: Invalid arguments for tool '${call.name}'.`;
                        } else {
                            result = await tools[call.name](call.args[argumentName].trim());
                        }
                    }
                } else {
                    result = `Error: Tool '${call.name}' not found.`;
                }
            } catch (error) {
                result = `Error executing tool: ${error.message}`;
            }

            onStatus({ type: 'status', message: 'Working...' });

            // 3. Add tool result to messages
            // Using 'user' role for the result is a simple way to feed it back to the LLM
            messages.push({ role: 'user', content: `Tool Result (${call.name}): ${result}` });
        }

        // 4. Recursively continue the loop
        return agentLoop(messages, onStatus, toolRounds + 1);
    }

    // No more tool calls, this is the final response
    return content;
}

app.post('/chat', async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).send('A non-empty prompt is required.');
        return;
    }
    console.log(`[Server] Received prompt: ${prompt}`);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt }
    ];

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    const sendEvent = event => res.write(`${JSON.stringify(event)}\n`);
    sendEvent({ type: 'status', message: 'Thinking...' });

    try {
        const finalAnswer = await agentLoop(messages, sendEvent);
        sendEvent({ type: 'final', content: finalAnswer });
        res.end();
    } catch (error) {
        console.error("[Server] Error in agent loop:", error);
        sendEvent({ type: 'error', message: `Agent Error: ${error.message}` });
        res.end();
    }
});

function releasePortIfOccupied(port) {
    try {
        const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null || true`, { stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
        if (!output) return;

        const pids = [...new Set(output.split(/\s+/).filter(Boolean))];
        if (!pids.length) return;

        console.log(`[Server] Port ${port} is occupied by PID(s): ${pids.join(', ')}. Releasing it...`);

        for (const pid of pids) {
            try {
                execSync(`kill -TERM ${pid} 2>/dev/null || true`, { stdio: 'inherit' });
            } catch (error) {
                // ignore; best effort cleanup
            }
        }

        // Give the process a moment to exit before reopening the port.
        const waitForRelease = 2000;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitForRelease);
    } catch (error) {
        console.warn('[Server] Unable to auto-release port:', error.message);
    }
}

const PORT = Number(process.env.PORT) || 3000;
releasePortIfOccupied(PORT);

const server = app.listen(PORT, () => {
    console.log(`[Server] Agent Backend running on http://localhost:${PORT}`);
    console.log(`[Server] Using LM Studio model: ${MODEL_NAME}`);
});

function shutdown(signal) {
    console.log(`\n[Server] Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
        console.log('[Server] Server closed. Exiting.');
        process.exit(0);
    });

    setTimeout(() => {
        console.error('[Server] Forced shutdown after timeout.');
        process.exit(1);
    }, 5000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGHUP', () => shutdown('SIGHUP'));
