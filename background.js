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
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== 'classify') return;
    classify(message.tweets).then(sendResponse);
    return true; // keep the channel open for the async response
});

function parseRubrics(text) {
    return text.split('\n')
        .map(function (line) { return line.trim(); })
        .filter(Boolean)
        .map(function (line) {
            const i = line.indexOf(':');
            return i > 0
                ? { label: line.slice(0, i).trim(), description: line.slice(i + 1).trim() }
                : { label: line, description: line };
        });
}

async function classify(tweets) {
    const sync = await chrome.storage.sync.get({ model: '', rubrics: '' });
    const local = await chrome.storage.local.get({ openrouter_key: '' });
    const rubrics = parseRubrics(sync.rubrics);
    if (!sync.model || !rubrics.length || !local.openrouter_key) {
        return { disabled: true };
    }

    const system = [
        "You filter noise out of the user's X/Twitter feed.",
        'Filter rules (label: what to filter):',
        rubrics.map(function (r) { return '- ' + r.label + ': ' + r.description; }).join('\n'),
        'The user message is a JSON array of {id, text}.',
        'Reply with ONLY a JSON array, no prose, no code fences:',
        '[{"id": "<id>", "label": "<label of the matching rule>" | null}]',
        'Include every input id exactly once. Use null when no rule clearly matches; when unsure, use null.',
    ].join('\n');

    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + local.openrouter_key,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/pronskiy/twitter-scroller',
                'X-Title': 'Twitter Scroller',
            },
            body: JSON.stringify({
                model: sync.model,
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
                verdicts[item.id] = labels.has(item.label) ? item.label : null;
            }
        }
        return { verdicts: verdicts };
    } catch (err) {
        console.warn('[Skrl] classify failed:', err.message);
        return { error: err.message };
    }
}
