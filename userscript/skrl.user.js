// ==UserScript==
// @name         Twitter Scroller (Skrl)
// @namespace    https://github.com/pronskiy/twitter-scroller
// @description  Auto-scroll the X/Twitter feed to your newest bookmark, and filter noise. Memory-safe for iOS Safari.
// @match        https://x.com/*
// @run-at       document-end
// @grant        GM.xmlHttpRequest
// @connect      openrouter.ai
// @version      1.3.1
// ==/UserScript==

(function () {
    'use strict';

    // Settings are baked in here by userscript/sync-ios.sh, which replaces the
    // marker below with the contents of the repo's config.js. Un-built (marker
    // intact) the script runs scroll-only with no filters.
    /* __CONFIG__ */
    const CONFIG = globalThis.SKRL_CONFIG || {};

    const COMPOSE_SELECTORS = [
        'a[aria-label="Post"]',
        'a[aria-label="Compose a post"]'
    ];

    // Mobile-tuned: slower than the desktop extension so Twitter's list
    // virtualizer can recycle off-screen tweets before the next step.
    const MAX_SCROLL_ITERATIONS = 80;
    const CHECK_INTERVAL = 500; // poll for the bookmark this often
    const SCROLL_EVERY = 4;     // ...and advance the feed every 4th poll (~2s)

    // Shared state at module scope — SPA re-init must not create a second copy.
    let intervalId = null;
    let scrollIterations = 0;
    let skrl = null; // current Skrl button; recreated on SPA re-init

    function waitForElement(selectors, timeout) {
        return new Promise(function (resolve, reject) {
            var elapsed = 0;
            var interval = 200;
            var check = setInterval(function () {
                for (var i = 0; i < selectors.length; i++) {
                    var el = document.querySelector(selectors[i]);
                    if (el) {
                        clearInterval(check);
                        resolve(el);
                        return;
                    }
                }
                elapsed += interval;
                if (elapsed >= timeout) {
                    clearInterval(check);
                    reject(new Error('Timeout waiting for element: ' + selectors.join(', ')));
                }
            }, interval);
        });
    }

    function setScrollingState(active) {
        if (!skrl) return;
        if (active) {
            skrl.textContent = 'Stop';
            skrl.style.backgroundColor = 'rgb(244, 33, 46)';
        } else {
            skrl.textContent = 'Skrl';
            skrl.style.backgroundColor = 'rgb(29, 155, 240)';
        }
    }

    // --- Memory mechanism: pause and unload every video so iOS Safari can
    // reclaim decode buffers (the dominant cause of the tab being killed). ---
    function killVideos() {
        document.querySelectorAll('video').forEach(function (v) {
            // Don't disturb the bookmarked tweet — it's the stop target.
            var article = v.closest('article');
            if (article && article.querySelector('button[data-testid="removeBookmark"]')) return;
            try {
                v.pause();
                v.autoplay = false;
                v.removeAttribute('src');
                v.querySelectorAll('source').forEach(function (s) { s.removeAttribute('src'); });
                v.load();
            } catch (err) {
                // Best-effort; never let a stray video break the loop.
            }
        });
    }

    function stopScrolling() {
        clearInterval(intervalId);
        intervalId = null;
        setScrollingState(false);
    }

    function toggleScrolling() {
        if (intervalId !== null) {
            stopScrolling();
        } else {
            scrollTwitterTimeline();
        }
    }

    function scrollTwitterTimeline() {
        scrollIterations = 0;
        var tick = 0;
        setScrollingState(true);
        killVideos(); // catch the initial autoplaying tweet immediately

        intervalId = setInterval(function () {
            // Check first, and often: between scroll steps the bookmarked tweet
            // is rendered and sitting still — that's when we reliably catch it.
            // Mobile virtualization can evict it fast, so we poll faster than we
            // scroll instead of checking once per (slow) scroll step.
            var bookmarked = document.querySelector('button[data-testid="removeBookmark"]');
            if (bookmarked) {
                stopScrolling();
                var article = bookmarked.closest('article');
                (article || bookmarked).scrollIntoView({ behavior: 'smooth' });
                setTimeout(function () {
                    window.scrollBy({ top: -300, behavior: 'smooth' });
                }, 1000);
                return;
            }

            // Advance the feed only every SCROLL_EVERY polls.
            if (++tick % SCROLL_EVERY !== 0) return;

            scrollIterations++;
            console.log('scrolling (' + scrollIterations + '/' + MAX_SCROLL_ITERATIONS + ')');
            if (scrollIterations >= MAX_SCROLL_ITERATIONS) {
                console.warn('[Skrl] Max scroll iterations reached (' + MAX_SCROLL_ITERATIONS + '). Stopping.');
                stopScrolling();
                return;
            }

            killVideos();
            // Gentle, instant step of ~one viewport so the bookmarked tweet
            // passes through the rendered window where a poll can land on it.
            window.scrollBy({
                top: Math.round(window.innerHeight * 0.85),
                behavior: 'auto',
            });
            killVideos();
        }, CHECK_INTERVAL);
    }

    // Primary trigger is the button (tap). Keyboard listener kept for desktop
    // smoke-testing; iPhones have no Ctrl key so it's a no-op there.
    document.addEventListener('keyup', function (event) {
        if (event.ctrlKey && event.shiftKey && (event.key === 'Y' || event.key === 'Н')) {
            toggleScrolling();
        }
    });

    // ----------------------------------------------------------------------
    // Noise filter — ported from the desktop extension's script.js/background.js.
    // Settings come from CONFIG; the LLM pass calls OpenRouter directly via
    // GM.xmlHttpRequest (no background relay).
    // ----------------------------------------------------------------------
    const verdict_cache_key = 'ts_llm_verdicts';
    const verdict_sig_key = 'ts_llm_sig';
    let compiledFilters = [];
    let pendingBatch = [];   // [{id, text}] awaiting classification
    let pendingById = {};     // ids already queued or in flight

    function compileFilters(patterns) {
        compiledFilters = []; // [{ label, re }]
        var obj = patterns || {};
        Object.keys(obj).forEach(function (label) {
            try {
                compiledFilters.push({ label: label, re: new RegExp(obj[label], 'i') });
            } catch (err) {
                console.warn('[Skrl] Skipping invalid filter "' + label + '":', obj[label], err.message);
            }
        });
    }

    compileFilters(CONFIG.filters);
    const linksOnly = Boolean(CONFIG.links_only);
    const llmEnabled = Boolean(CONFIG.model && CONFIG.rubrics && Object.keys(CONFIG.rubrics).length && CONFIG.key);

    // Universal allow-list — tweets matching any of these are exempt from every
    // filter pass (checked against tweet text + anchor hrefs).
    const keepFilters = (CONFIG.keep || []).map(function (p) {
        try { return new RegExp(p, 'i'); }
        catch (err) { console.warn('[Skrl] Skipping invalid keep pattern:', p, err.message); return null; }
    }).filter(Boolean);

    // Structural filters — the kind of post, regardless of topic: "reposts",
    // "replies", "duplicates" (a link card already seen this session).
    var hideKinds = new Set(CONFIG.hide || []);
    var seenCards = {};    // card text -> permalink of the first tweet showing it

    // Drop cached verdicts when model/rubrics/threshold change (signature check
    // on load). v2: verdicts are {label, p} objects instead of label strings.
    (function () {
        var sig = 'v2\n' + (CONFIG.model || '') + '\n' + JSON.stringify(CONFIG.rubrics || {})
            + '\n' + (CONFIG.threshold != null ? CONFIG.threshold : '');
        if (localStorage.getItem(verdict_sig_key) !== sig) {
            localStorage.removeItem(verdict_cache_key);
            localStorage.setItem(verdict_sig_key, sig);
        }
    })();

    function tweetText(article) {
        var texts = article.querySelectorAll('div[data-testid="tweetText"]');
        if (!texts.length) return null;
        return Array.prototype.map.call(texts, function (el) {
            return el.innerText;
        }).join('\n');
    }

    function tweetPermalink(article) {
        var permalink = article.querySelector('a:has(time)');
        return permalink && permalink.getAttribute('href');
    }

    function matchFilters(text) {
        for (var i = 0; i < compiledFilters.length; i++) {
            if (compiledFilters[i].re.test(text)) return compiledFilters[i].label;
        }
        return null;
    }

    // Universal allow-list: never hide tweets matching `keep` (text + hrefs).
    function isKept(article, text) {
        if (!keepFilters.length) return false;
        var hrefs = Array.prototype.map.call(
            article.querySelectorAll('a[href]'),
            function (a) { return a.getAttribute('href') || ''; }
        ).join(' ');
        var hay = (text || '') + ' ' + hrefs;
        for (var i = 0; i < keepFilters.length; i++) {
            if (keepFilters[i].test(hay)) return true;
        }
        return false;
    }

    // Returns the stub label for a structurally filtered tweet, or null.
    function structuralMatch(article) {
        if (hideKinds.has('reposts')) {
            var context = article.querySelector('[data-testid="socialContext"]');
            if (context && /reposted$/.test(context.innerText.trim())) return 'repost';
        }
        if (hideKinds.has('replies') && isReply(article)) return 'reply';
        if (hideKinds.has('duplicates')) {
            var card = article.querySelector('[data-testid="card.wrapper"]');
            var key = card && card.innerText.replace(/\s+/g, ' ').trim().toLowerCase();
            var id = tweetPermalink(article);
            if (key && id) {
                // The first tweet with this card stays visible, even when re-rendered.
                if (seenCards[key] && seenCards[key] !== id) return 'duplicate';
                seenCards[key] = id;
            }
        }
        return null;
    }

    // The "Replying to @user" line X shows above a reply's text.
    function isReply(article) {
        return Array.prototype.some.call(article.querySelectorAll('div'), function (d) {
            // Skip the tweet text and wrappers around it (text can start with "Replying to").
            return /^\s*Replying to\b/.test(d.textContent) && !d.closest('[data-testid="tweetText"]')
                && !d.querySelector('[data-testid="tweetText"]');
        });
    }

    function getVerdicts() {
        return JSON.parse(localStorage.getItem(verdict_cache_key)) || {};
    }

    function cacheVerdict(id, verdict) {
        var verdicts = getVerdicts();
        verdicts[id] = verdict;
        var keys = Object.keys(verdicts);
        if (keys.length > 1000) {
            keys.slice(0, keys.length - 1000).forEach(function (k) { delete verdicts[k]; });
        }
        localStorage.setItem(verdict_cache_key, JSON.stringify(verdicts));
    }

    // p is the classifier's probability (Jev only) — shown as a percentage.
    function collapseArticle(article, matched, p) {
        var stub = document.createElement('a');
        stub.setAttribute('href', '#');
        stub.setAttribute('class', 'skrl-filter-stub');
        stub.setAttribute('style', 'display: block; padding: 6px 16px; color: rgb(113, 118, 123); font-size: 13px; text-decoration: none;');
        var pct = typeof p === 'number' ? ' ' + Math.round(p * 100) + '%' : '';
        stub.textContent = 'filtered: ' + matched + pct + ' — show';
        article.style.display = 'none';
        article.before(stub);
    }

    function restoreFiltered(stub) {
        var article = stub.nextElementSibling;
        if (article && article.tagName === 'ARTICLE') {
            article.style.display = '';
        }
        stub.remove();
    }

    document.addEventListener('click', function (e) {
        var stub = e.target.closest('.skrl-filter-stub');
        if (stub) {
            e.preventDefault();
            restoreFiltered(stub);
        }
    });

    function rubricsList(obj) {
        return Object.keys(obj || {}).map(function (label) {
            return { label: label, description: obj[label] };
        });
    }

    // GM.xmlHttpRequest wrapped as a promise (bypasses CORS via @connect).
    function gmPost(url, headers, body) {
        return new Promise(function (resolve, reject) {
            GM.xmlHttpRequest({
                method: 'POST',
                url: url,
                headers: headers,
                data: body,
                timeout: 30000,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) return resolve(res.responseText);
                    var err = new Error('OpenRouter HTTP ' + res.status);
                    err.status = res.status;
                    reject(err);
                },
                onerror: function () { reject(new Error('network error')); },
                ontimeout: function () { reject(new Error('timeout')); },
            });
        });
    }

    var JEV_NONE = '_none'; // reserved "no rule matches" option for Jev

    function openRouterHeaders() {
        return {
            'Authorization': 'Bearer ' + CONFIG.key,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/pronskiy/twitter-scroller',
            'X-Title': 'Twitter Scroller',
        };
    }

    // Jev decision models (not typesafe/jev-router, which is a chat router).
    function isDecisionsModel(model) {
        return /^~?typesafe\/jev-(latest|\d)/.test(model || '');
    }

    // Verdicts are {label, p} (p = Jev's probability, null for chat models) or null.
    async function classify(tweets) {
        var rubrics = rubricsList(CONFIG.rubrics);
        if (!CONFIG.model || !rubrics.length || !CONFIG.key) {
            return { disabled: true };
        }
        try {
            return isDecisionsModel(CONFIG.model)
                ? await classifyJev(tweets)
                : await classifyChat(rubrics, tweets);
        } catch (err) {
            console.warn('[Skrl] classify failed:', err.message);
            return { error: err.message };
        }
    }

    // Chat models: one request per batch, the model replies with a JSON array.
    async function classifyChat(rubrics, tweets) {
        var system = [
            "You filter noise out of the user's X/Twitter feed.",
            'Filter rules (label: what to filter):',
            rubrics.map(function (r) { return '- ' + r.label + ': ' + r.description; }).join('\n'),
            'The user message is a JSON array of {id, text}.',
            'Reply with ONLY a JSON array, no prose, no code fences:',
            '[{"id": "<id>", "label": "<label of the matching rule>" | null}]',
            'Include every input id exactly once. Use null when no rule clearly matches; when unsure, use null.',
        ].join('\n');

        var text = await gmPost('https://openrouter.ai/api/v1/chat/completions', openRouterHeaders(), JSON.stringify({
            model: CONFIG.model,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: JSON.stringify(tweets) },
            ],
        }));
        var data = JSON.parse(text);
        var content = (data.choices && data.choices[0] && data.choices[0].message
            && data.choices[0].message.content) || '';
        content = content.trim().replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '');
        var labels = new Set(rubrics.map(function (r) { return r.label; }));
        var verdicts = {};
        JSON.parse(content).forEach(function (item) {
            if (item && typeof item.id === 'string') {
                // Only trust labels we actually defined — anything else fails open.
                verdicts[item.id] = labels.has(item.label) ? { label: item.label, p: null } : null;
            }
        });
        return { verdicts: verdicts };
    }

    // Jev (Decisions API): one typed `choice` question per tweet, answered with
    // calibrated probabilities. Tweets whose request failed are left out of the
    // verdicts so they're retried later.
    async function classifyJev(tweets) {
        var threshold = typeof CONFIG.threshold === 'number' ? CONFIG.threshold : 0.7;
        var criteria = Object.assign({}, CONFIG.rubrics);
        criteria[JEV_NONE] = 'No rule clearly matches.';
        var results = await Promise.allSettled(tweets.map(async function (t) {
            var text = await jevPost(JSON.stringify({
                model: CONFIG.model,
                state: t.text,
                questions: {
                    noise: {
                        type: 'choice',
                        instructions: 'Which filter rule does this X/Twitter post clearly match? When unsure, pick ' + JEV_NONE + '.',
                        criteria: criteria,
                    },
                },
            }));
            var data = JSON.parse(text);
            return jevVerdict(data.answers && data.answers.noise, threshold);
        }));

        var verdicts = {};
        var failure = null;
        results.forEach(function (r, i) {
            if (r.status === 'fulfilled') verdicts[tweets[i].id] = r.value;
            else failure = r.reason;
        });
        if (failure && !Object.keys(verdicts).length) throw failure;
        if (failure) console.warn('[Skrl] some Jev calls failed, will retry:', failure.message);
        return { verdicts: verdicts };
    }

    // Jev is often overloaded (503/504/529), so retry 429s, 5xx, network errors
    // and timeouts with backoff before giving up on a tweet.
    var JEV_RETRY_DELAYS = [1000, 3000];

    async function jevPost(body) {
        for (var attempt = 0; ; attempt++) {
            try {
                return await gmPost('https://openrouter.ai/api/alpha/decisions', openRouterHeaders(), body);
            } catch (err) {
                var retryable = !err.status || err.status === 429 || err.status >= 500;
                if (!retryable || attempt >= JEV_RETRY_DELAYS.length) throw err;
            }
            await new Promise(function (r) { setTimeout(r, JEV_RETRY_DELAYS[attempt]); });
        }
    }

    function jevVerdict(answer, threshold) {
        if (!answer) throw new Error('Jev response has no answer');
        // _none and labels we didn't define both mean "keep the tweet".
        if (!Object.prototype.hasOwnProperty.call(CONFIG.rubrics, answer.choice)) return null;
        var p = (answer.probabilities || {})[answer.choice];
        return typeof p === 'number' && p >= threshold ? { label: answer.choice, p: p } : null;
    }

    function flushPendingBatch() {
        if (!pendingBatch.length) return;
        var batch = pendingBatch.splice(0, 20);
        classify(batch).then(function (response) {
            // Fail open on any error: unqueue so recreated tweets can retry.
            if (!response || !response.verdicts) {
                batch.forEach(function (t) { delete pendingById[t.id]; });
                return;
            }
            batch.forEach(function (t) {
                delete pendingById[t.id];
                // Missing ids failed upstream — leave them uncached so they retry.
                if (!(t.id in response.verdicts)) return;
                var verdict = response.verdicts[t.id];
                cacheVerdict(t.id, verdict);
                // The verdict can arrive after navigating away from the feed.
                if (verdict && location.pathname === '/home') {
                    var anchor = document.querySelector('a[href="' + t.id + '"]');
                    var article = anchor && anchor.closest('article');
                    if (article && article.style.display !== 'none') {
                        collapseArticle(article, verdict.label, verdict.p);
                    }
                }
            });
        });
    }

    // Tweets virtualize in/out of the DOM while scrolling — poll for ones not
    // yet checked. Once a stub is clicked open, the mark keeps the tweet from
    // re-collapsing until it leaves the DOM.
    setInterval(function () {
        // Only the home feed — notifications, threads, profiles, search, etc.
        // are pages you open on purpose.
        if (location.pathname !== '/home') return;
        if (!compiledFilters.length && !llmEnabled && !linksOnly && !hideKinds.size) return;
        var verdicts = llmEnabled ? getVerdicts() : {};
        document.querySelectorAll('article:not([data-skrl-checked])').forEach(function (article) {
            article.setAttribute('data-skrl-checked', '1');
            // Never hide the reading-position marker the scroll loop stops at.
            if (article.querySelector('button[data-testid="removeBookmark"]')) return;
            // Structural filters run before `keep`: they're about the kind of
            // post (repost, reply, duplicate link), not its topic.
            var kind = hideKinds.size ? structuralMatch(article) : null;
            if (kind) {
                collapseArticle(article, kind);
                return;
            }
            var text = tweetText(article);
            // Universal allow-list (e.g. php, github links) — exempt from all passes.
            if (isKept(article, text)) return;
            // External links and link cards have absolute hrefs; everything
            // internal (mentions, hashtags, permalinks, media) is relative.
            if (linksOnly && !article.querySelector('a[href^="http"]')) {
                collapseArticle(article, 'no link');
                return;
            }
            if (!text) return;
            var matched = matchFilters(text);
            if (matched) {
                collapseArticle(article, matched);
                return;
            }
            if (!llmEnabled) return;
            var id = tweetPermalink(article);
            if (!id) return;
            if (id in verdicts) {
                if (verdicts[id]) collapseArticle(article, verdicts[id].label, verdicts[id].p);
            } else if (!pendingById[id]) {
                pendingById[id] = true;
                pendingBatch.push({ id: id, text: text });
            }
        });
        flushPendingBatch();
    }, 1500);

    // ----------------------------------------------------------------------
    // Button injection + SPA handling
    // ----------------------------------------------------------------------
    function styleComposeButton(el) {
        el.setAttribute('style', 'margin-top: 20px; border-radius: 50px; display: inline-block; background-color: rgb(29, 155, 240); color: white; padding: 10px;');
    }

    function styleFloatingButton(el) {
        el.setAttribute('style', 'position: fixed; right: 16px; bottom: 88px; z-index: 9999; border-radius: 50px; background-color: rgb(29, 155, 240); color: white; padding: 12px 18px; font-weight: bold; text-decoration: none; box-shadow: 0 2px 8px rgba(0,0,0,0.3);');
    }

    function makeButton() {
        var btn = document.createElement('a');
        btn.textContent = 'Skrl';
        btn.setAttribute('href', '#');
        btn.setAttribute('class', 'skrl');
        btn.addEventListener('click', function (event) {
            event.preventDefault();
            toggleScrolling();
        });
        return btn;
    }

    function run_twitter_scroller() {
        console.log('[Skrl] init');

        var compose_button = document.querySelector('a[aria-label="Post"]');
        var compose_button_m = document.querySelector('a[aria-label="Compose a post"]');

        skrl = makeButton();

        if (compose_button_m) {
            styleComposeButton(skrl);
            skrl.style.width = '30px';
            compose_button_m.parentNode.after(skrl);
            compose_button_m.setAttribute('style', 'display: none;');
        } else if (compose_button) {
            styleComposeButton(skrl);
            compose_button.parentNode.after(skrl);
        } else {
            // Mobile layout may not expose a compose anchor — guarantee a tap
            // target with a floating button.
            console.warn('[Skrl] Compose button not found — using floating button.');
            styleFloatingButton(skrl);
            document.body.appendChild(skrl);
        }

        // Re-created button must reflect a scroll that is still running.
        setScrollingState(intervalId !== null);
    }

    function init() {
        waitForElement(COMPOSE_SELECTORS, 10000)
            .then(run_twitter_scroller)
            .catch(function () {
                // No compose button within timeout — still give a tap target.
                if (!document.querySelector('.skrl')) {
                    skrl = makeButton();
                    styleFloatingButton(skrl);
                    document.body.appendChild(skrl);
                    setScrollingState(intervalId !== null);
                }
            });
    }

    init();

    // Handle SPA navigation: re-inject the button on return to /home.
    var lastPathname = location.pathname;
    setInterval(function () {
        if (location.pathname !== lastPathname) {
            lastPathname = location.pathname;
            if (location.pathname === '/home' && !document.querySelector('.skrl')) {
                console.log('[Skrl] SPA navigation detected, re-initializing.');
                init();
            }
        }
    }, 2000);

})();
