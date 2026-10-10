const YahooFinance = require('yahoo-finance2').default;
const https = require('https');
const yahooFinance = new YahooFinance();

function getCurrentDateTimeParts() {
    const now = new Date();
    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        monthName: now.toLocaleString('en-US', { month: 'long' }),
        day: now.getDate(),
        hour: now.getHours(),
        minute: now.getMinutes(),
        second: now.getSeconds(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local Time',
        iso: now.toISOString(),
        local: now.toString()
    };
}

function formatCurrentDate() {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

const SEARCH_ENDPOINTS = [
    (process.env.SEARX_BASE_URL || 'https://priv.au').replace(/\/$/, ''),
    (process.env.SEARCH_FALLBACK_URL || 'https://search.ononoki.org').replace(/\/$/, '')
];
const SEARX_INSTANCES_URL = 'https://searx.space/data/instances.json';
const MAX_SEARCH_ATTEMPTS = Math.max(1, Math.min(8, Number.parseInt(process.env.SEARX_MAX_ATTEMPTS || '4', 10) || 4));
const SEARCH_TIMEOUT_MS = 5000;
const INSTANCE_CACHE_MS = 6 * 60 * 60 * 1000;
let discoveredSearchEndpoints = [];
let discoveredSearchEndpointsExpiresAt = 0;
let discoveryRequest;

function isPublicHttpsEndpoint(endpoint) {
    try {
        const url = new URL(endpoint);
        return url.protocol === 'https:' && !url.username && !url.password &&
            url.hostname.includes('.') && !url.hostname.endsWith('.onion') &&
            !/^localhost$/i.test(url.hostname) &&
            !/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
    } catch {
        return false;
    }
}

async function getDiscoveredSearchEndpoints() {
    if (Date.now() < discoveredSearchEndpointsExpiresAt) return discoveredSearchEndpoints;
    if (discoveryRequest) return discoveryRequest;

    discoveryRequest = (async () => {
        try {
            const response = await fetch(SEARX_INSTANCES_URL, {
                headers: { 'User-Agent': 'LocalAgent/1.0' },
                signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
            });
            if (!response.ok) throw new Error(`Instance directory returned HTTP ${response.status}`);

            const directory = await response.json();
            const candidates = Object.entries(directory?.instances || {}).flatMap(([endpoint, instance]) => {
                const search = instance?.timing?.search;
                const successRate = search?.success_percentage;
                const responseTime = search?.all?.median ?? search?.all?.mean;
                const uptime = instance?.uptime?.uptimeMonth;
                if (!isPublicHttpsEndpoint(endpoint) || instance?.network_type !== 'normal' ||
                    instance?.analytics === true || instance?.http?.status_code !== 200 ||
                    instance?.http?.error || instance?.error ||
                    typeof successRate !== 'number' || successRate < 50 ||
                    (typeof uptime === 'number' && uptime < 80)) return [];
                return [{ endpoint: endpoint.replace(/\/$/, ''), successRate, responseTime }];
            });

            candidates.sort((left, right) => {
                if (right.successRate !== left.successRate) return right.successRate - left.successRate;
                return (left.responseTime ?? Number.MAX_VALUE) - (right.responseTime ?? Number.MAX_VALUE);
            });
            discoveredSearchEndpoints = candidates.slice(0, 12).map(candidate => candidate.endpoint);
            discoveredSearchEndpointsExpiresAt = Date.now() + INSTANCE_CACHE_MS;
        } catch (error) {
            discoveredSearchEndpoints = [];
            discoveredSearchEndpointsExpiresAt = Date.now() + 5 * 60 * 1000;
            console.warn(`[SearXNG] Could not refresh the public instance pool: ${error.message}`);
        } finally {
            discoveryRequest = undefined;
        }
        return discoveredSearchEndpoints;
    })();

    return discoveryRequest;
}

function shuffleEndpoints(endpoints) {
    const shuffled = [...new Set(endpoints)];
    for (let index = shuffled.length - 1; index > 0; index--) {
        const otherIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[otherIndex]] = [shuffled[otherIndex], shuffled[index]];
    }
    return shuffled;
}

async function searchSearxngEndpoint(baseUrl, query, errors) {
    try {
        const url = buildSearchUrl(baseUrl, query);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LocalAgent/1.0; +https://localhost)'
            },
            signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS)
        });

        if (!response.ok) {
            errors.push(`${baseUrl}: HTTP ${response.status}`);
            return null;
        }

        const data = await response.json();
        const results = Array.isArray(data?.results) ? data.results.slice(0, 5) : [];
        if (results.length === 0) {
            errors.push(`${baseUrl}: no results returned`);
            return null;
        }

        return results
            .map(result => {
                const title = result.title || 'Result';
                const resultUrl = result.url || result.href || 'No URL';
                const snippet = result.content || result.snippet || result.description || '';
                return `${title}: ${resultUrl}\n${snippet}`.trim();
            })
            .join('\n\n');
    } catch (error) {
        errors.push(`${baseUrl}: ${error.message || 'Unknown error'}`);
        return null;
    }
}

function buildSearchUrl(baseUrl, query) {
    const normalized = baseUrl.replace(/\/$/, '');
    return `${normalized}/search?q=${encodeURIComponent(query)}&format=json&language=en`;
}

const stockFieldAliases = {
    name: 'shortName',
    price: 'regularMarketPrice',
    high: 'regularMarketDayHigh',
    low: 'regularMarketDayLow',
    close: 'regularMarketPreviousClose',
    change: 'regularMarketChange',
    changePercent: 'regularMarketChangePercent',
    previousClose: 'regularMarketPreviousClose',
    dayRange: 'regularMarketDayRange',
    volume: 'regularMarketVolume',
    marketCap: 'marketCap',
    pe: 'trailingPE',
    fiftyTwoWeekRange: 'fiftyTwoWeekRange',
    '52-week range': 'fiftyTwoWeekRange',
    fiftyTwoWeekHigh: 'fiftyTwoWeekHigh',
    fiftyTwoWeekLow: 'fiftyTwoWeekLow',
    preMarketPrice: 'preMarketPrice',
    postMarketPrice: 'postMarketPrice',
    currency: 'currency',
    marketState: 'marketState'
};

const stockFieldLabels = {
    shortName: 'Name',
    regularMarketPrice: 'Price',
    regularMarketDayHigh: 'Day high',
    regularMarketDayLow: 'Day low',
    regularMarketChange: 'Change',
    regularMarketChangePercent: 'Change percent',
    regularMarketPreviousClose: 'Previous close',
    regularMarketDayRange: 'Day range',
    regularMarketVolume: 'Volume',
    marketCap: 'Market cap',
    trailingPE: 'P/E ratio',
    fiftyTwoWeekRange: '52-week range',
    fiftyTwoWeekHigh: '52-week high',
    fiftyTwoWeekLow: '52-week low',
    preMarketPrice: 'Pre-market price',
    postMarketPrice: 'Post-market price',
    currency: 'Currency',
    marketState: 'Market state'
};

const defaultStockFields = [
    'regularMarketPrice',
    'regularMarketDayHigh',
    'regularMarketDayLow',
    'regularMarketPreviousClose',
    'regularMarketVolume',
    'currency'
];

function normalizeStockSymbols(input) {
    const symbols = Array.isArray(input) ? input : typeof input === 'string' ? input.split(',') : [];
    return symbols.map(symbol => typeof symbol === 'string' ? symbol.trim().toUpperCase() : '')
        .filter(Boolean);
}

function normalizeStockFields(input) {
    if (input === undefined) return defaultStockFields;
    if (!Array.isArray(input) || input.some(field => typeof field !== 'string')) {
        throw new Error('Stock fields must be an array of supported field names.');
    }

    const fields = input.map(field => stockFieldAliases[field] || field);
    const unsupportedFields = fields.filter(field => !stockFieldLabels[field]);
    if (unsupportedFields.length) {
        throw new Error(`Unsupported stock field(s): ${unsupportedFields.join(', ')}`);
    }
    return [...new Set(fields)];
}

function formatStockQuote(quote, fields) {
    const name = quote.shortName || quote.longName;
    const header = [quote.symbol, name].filter(Boolean).join(' - ');
    const details = fields.map(field => {
        const value = quote[field];
        if (value === undefined || value === null) return null;
        if (field === 'fiftyTwoWeekRange' || field === 'regularMarketDayRange') {
            return `${stockFieldLabels[field]}: ${value.low} - ${value.high}`;
        }
        if (field === 'regularMarketChangePercent') {
            return `${stockFieldLabels[field]}: ${value}%`;
        }
        return `${stockFieldLabels[field]}: ${value}`;
    }).filter(Boolean);
    return [header, ...details].filter(Boolean).join('\n');
}

/**
 * Tool set for the autonomous agent.
 */
const tools = {
    /**
     * Returns the current local date and time.
     * @returns {Promise<string>} A human-readable current date/time string.
     */
    current_date: async () => {
        const value = formatCurrentDate();
        return `Today is ${value}.`;
    },

    current_time: async () => {
        const value = formatCurrentTime();
        return `The current local time is ${value} (${Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'}).`;
    },

    current_datetime: async () => {
        const now = getCurrentDateTimeParts();
        return `Current date/time: ${now.monthName} ${now.day}, ${now.year} at ${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}:${String(now.second).padStart(2, '0')} ${now.timeZone}.`;
    },

    /**
     * Performs a SearXNG search.
     * @param {string} query The search query.
     * @returns {Promise<string>} The search results.
     */
    searxng_search: async (query) => {
        const errors = [];

        const primaryEndpoint = SEARCH_ENDPOINTS[0];
        const primaryResult = await searchSearxngEndpoint(primaryEndpoint, query, errors);
        if (primaryResult) return primaryResult;

        const dynamicEndpoints = await getDiscoveredSearchEndpoints();
        const fallbackEndpoints = shuffleEndpoints([
            ...SEARCH_ENDPOINTS.slice(1).filter(endpoint => endpoint !== primaryEndpoint),
            ...dynamicEndpoints.filter(endpoint => !SEARCH_ENDPOINTS.includes(endpoint))
        ]).slice(0, MAX_SEARCH_ATTEMPTS - 1);

        for (const baseUrl of fallbackEndpoints) {
            const result = await searchSearxngEndpoint(baseUrl, query, errors);
            if (result) return result;
        }

        return `Search failed for "${query}". Tried: ${errors.join('; ') || 'no providers available'}.`;
    },

    /**
     * Searches for one or more stock quotes and selected quote fields.
     * @param {string|string[]} symbols Stock symbol or symbols.
     * @param {string[]} fields Optional quote fields to return.
     * @returns {Promise<string>} The requested stock information.
     */
    stock_search: async (symbols, fields) => {
        try {
            const normalizedSymbols = normalizeStockSymbols(symbols);
            if (!normalizedSymbols.length) {
                return 'Error: Provide one or more valid stock symbols.';
            }

            const selectedFields = normalizeStockFields(fields);
            const requestedFields = [...new Set([
                'symbol', 'shortName', 'longName', 'currency', ...selectedFields
            ])];
            const quotes = await yahooFinance.quote(normalizedSymbols, { fields: requestedFields });
            const quoteList = Array.isArray(quotes) ? quotes : quotes ? [quotes] : [];
            if (!quoteList.length) {
                return `No stock information found for ${normalizedSymbols.join(', ')}.`;
            }
            return quoteList.map(quote => formatStockQuote(quote, selectedFields)).join('\n\n');
        } catch (error) {
            return `Error searching for stock quote: ${error.message}`;
        }
    },

    /**
     * Gets the weather for a given location.
     * @param {string} location The location name.
     * @returns {Promise<string>} The weather information.
     */
    weather_search: async (location) => {
        return new Promise((resolve, reject) => {
            const url = `https://wttr.in/${encodeURIComponent(location)}?2`;
            const request = https.get(url, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    if (res.statusCode < 200 || res.statusCode >= 300) {
                        resolve(`Weather service returned HTTP ${res.statusCode}: ${data.trim()}`);
                        return;
                    }
                    resolve(data.trim() || 'Weather service returned no data.');
                });
            });
            request.setTimeout(10000, () => request.destroy(new Error('Weather request timed out.')));
            request.on('error', (error) => {
                resolve(`Error fetching weather: ${error.message}`);
            });
        });
    }
};

module.exports = tools;
