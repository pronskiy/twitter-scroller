// Settings live in config.js (globalThis.SKRL_CONFIG); the build copies it into
// the extension folder. Missing config just disables the LLM filter.
try {
    importScripts('config.js');
} catch (e) {
    console.warn('[Skrl] config.js missing or invalid:', e && e.message);
}

chrome.commands.onCommand.addListener(function (command) {
    if (command !== 'scroll') return;
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (!tabs[0] || tabs[0].id === undefined) return;
        chrome.tabs.sendMessage(tabs[0].id, 'toggle-scroll', function () {
            // No content script on non-x.com tabs — swallow the error.
            void chrome.runtime.lastError;
        });
    });
});

// LLM noise classifier — the content script sends batches of {id, text},
// we ask the configured OpenRouter model which rubric (if any) each matches.
// Verdicts are {label, p} (p = Jev's probability, null for chat models) or null.
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== 'classify') return;
    classify(message.tweets).then(sendResponse);
    return true; // keep the channel open for the async response
});

const JEV_NONE = '_none'; // reserved "no rule matches" option for Jev

function rubricsList(obj) {
    return Object.keys(obj || {}).map(function (label) {
        return { label: label, description: obj[label] };
    });
}

function openRouterHeaders(key) {
    return {
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/pronskiy/twitter-scroller',
        'X-Title': 'Twitter Scroller',
    };
}

// Jev decision models (not typesafe/jev-router, which is a chat router).
function isDecisionsModel(model) {
    return /^~?typesafe\/jev-(latest|\d)/.test(model || '');
}

async function classify(tweets) {
    const cfg = globalThis.SKRL_CONFIG || {};
    const rubrics = rubricsList(cfg.rubrics);
    if (!cfg.model || !rubrics.length || !cfg.key) {
        return { disabled: true };
    }
    try {
        return isDecisionsModel(cfg.model)
            ? await classifyJev(cfg, tweets)
            : await classifyChat(cfg, rubrics, tweets);
    } catch (err) {
        console.warn('[Skrl] classify failed:', err.message);
        return { error: err.message };
    }
}

// Chat models: one request per batch, the model replies with a JSON array.
async function classifyChat(cfg, rubrics, tweets) {
    const system = [
        "You filter noise out of the user's X/Twitter feed.",
        'Filter rules (label: what to filter):',
        rubrics.map(function (r) { return '- ' + r.label + ': ' + r.description; }).join('\n'),
        'The user message is a JSON array of {id, text}.',
        'Reply with ONLY a JSON array, no prose, no code fences:',
        '[{"id": "<id>", "label": "<label of the matching rule>" | null}]',
        'Include every input id exactly once. Use null when no rule clearly matches; when unsure, use null.',
    ].join('\n');

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: openRouterHeaders(cfg.key),
        body: JSON.stringify({
            model: cfg.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(tweets) },
            ],
        }),
    });
    if (!res.ok) {
        throw new Error('OpenRouter HTTP ' + res.status);
    }
    const data = await res.json();
    let content = (data.choices && data.choices[0] && data.choices[0].message
        && data.choices[0].message.content) || '';
    content = content.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
    const labels = new Set(rubrics.map(function (r) { return r.label; }));
    const verdicts = {};
    for (const item of JSON.parse(content)) {
        if (item && typeof item.id === 'string') {
            // Only trust labels we actually defined — anything else fails open.
            verdicts[item.id] = labels.has(item.label) ? { label: item.label, p: null } : null;
        }
    }
    return { verdicts: verdicts };
}

// Jev (Decisions API): one typed `choice` question per tweet, answered with
// calibrated probabilities. Tweets whose request failed are left out of the
// verdicts so the content script retries them later.
async function classifyJev(cfg, tweets) {
    const threshold = typeof cfg.threshold === 'number' ? cfg.threshold : 0.7;
    const criteria = Object.assign({}, cfg.rubrics, { [JEV_NONE]: 'No rule clearly matches.' });
    const results = await Promise.allSettled(tweets.map(async function (t) {
        const data = await jevPost(cfg.key, JSON.stringify({
            model: cfg.model,
            state: t.text,
            questions: {
                noise: {
                    type: 'choice',
                    instructions: 'Which filter rule does this X/Twitter post clearly match? When unsure, pick ' + JEV_NONE + '.',
                    criteria: criteria,
                },
            },
        }));
        return jevVerdict(data.answers && data.answers.noise, cfg.rubrics, threshold);
    }));

    const verdicts = {};
    let failure = null;
    results.forEach(function (r, i) {
        if (r.status === 'fulfilled') verdicts[tweets[i].id] = r.value;
        else failure = r.reason;
    });
    if (failure && !Object.keys(verdicts).length) throw failure;
    if (failure) console.warn('[Skrl] some Jev calls failed, will retry:', failure.message);
    return { verdicts: verdicts };
}

// Jev is often overloaded (503/504/529), so retry 429s, 5xx, and network errors
// with backoff before giving up on a tweet.
const JEV_RETRY_DELAYS = [1000, 3000];

async function jevPost(key, body) {
    for (let attempt = 0; ; attempt++) {
        let res = null;
        try {
            res = await fetch('https://openrouter.ai/api/alpha/decisions', {
                method: 'POST',
                headers: openRouterHeaders(key),
                body: body,
            });
        } catch (err) {
            // network error — retryable
        }
        if (res && res.ok) return res.json();
        const retryable = !res || res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= JEV_RETRY_DELAYS.length) {
            throw new Error(res ? 'OpenRouter HTTP ' + res.status : 'network error');
        }
        await new Promise(function (r) { setTimeout(r, JEV_RETRY_DELAYS[attempt]); });
    }
}

function jevVerdict(answer, rubrics, threshold) {
    if (!answer) throw new Error('Jev response has no answer');
    // _none and labels we didn't define both mean "keep the tweet".
    if (!Object.prototype.hasOwnProperty.call(rubrics, answer.choice)) return null;
    const p = (answer.probabilities || {})[answer.choice];
    return typeof p === 'number' && p >= threshold ? { label: answer.choice, p: p } : null;
}
