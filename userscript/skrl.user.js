// ==UserScript==
// @name         Twitter Scroller (Skrl)
// @namespace    https://github.com/pronskiy/twitter-scroller
// @description  Auto-scroll the X/Twitter feed to your newest bookmark, and filter noise. Memory-safe for iOS Safari.
// @match        https://x.com/*
// @run-at       document-end
// @grant        GM.xmlHttpRequest
// @connect      openrouter.ai
// @version      1.1.0
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
        compiledFilters = [];
        (patterns || []).forEach(function (pattern) {
            try {
                compiledFilters.push(new RegExp(pattern, 'i'));
            } catch (err) {
                console.warn('[Skrl] Skipping invalid filter pattern:', pattern, err.message);
            }
        });
    }

    compileFilters(CONFIG.filters);
    const linksOnly = Boolean(CONFIG.links_only);
    const llmEnabled = Boolean(CONFIG.model && (CONFIG.rubrics || '').trim() && CONFIG.key);

    // Universal allow-list — tweets matching any of these are exempt from every
    // filter pass (checked against tweet text + anchor hrefs).
    const keepFilters = (CONFIG.keep || []).map(function (p) {
        try { return new RegExp(p, 'i'); }
        catch (err) { console.warn('[Skrl] Skipping invalid keep pattern:', p, err.message); return null; }
    }).filter(Boolean);

    // Drop cached verdicts when model/rubrics change (signature check on load).
    (function () {
        var sig = (CONFIG.model || '') + '\n' + (CONFIG.rubrics || '');
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
            if (compiledFilters[i].test(text)) return compiledFilters[i];
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

    function getVerdicts() {
        return JSON.parse(localStorage.getItem(verdict_cache_key)) || {};
    }

    function cacheVerdict(id, label) {
        var verdicts = getVerdicts();
        verdicts[id] = label;
        var keys = Object.keys(verdicts);
        if (keys.length > 1000) {
            keys.slice(0, keys.length - 1000).forEach(function (k) { delete verdicts[k]; });
        }
        localStorage.setItem(verdict_cache_key, JSON.stringify(verdicts));
    }

    function collapseArticle(article, matched) {
        var stub = document.createElement('a');
        stub.setAttribute('href', '#');
        stub.setAttribute('class', 'skrl-filter-stub');
        stub.setAttribute('style', 'display: block; padding: 6px 16px; color: rgb(113, 118, 123); font-size: 13px; text-decoration: none;');
        stub.textContent = 'filtered: ' + matched + ' — show';
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

    function parseRubrics(text) {
        return text.split('\n')
            .map(function (line) { return line.trim(); })
            .filter(Boolean)
            .map(function (line) {
                var i = line.indexOf(':');
                return i > 0
                    ? { label: line.slice(0, i).trim(), description: line.slice(i + 1).trim() }
                    : { label: line, description: line };
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
                    if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                    else reject(new Error('OpenRouter HTTP ' + res.status));
                },
                onerror: function () { reject(new Error('network error')); },
                ontimeout: function () { reject(new Error('timeout')); },
            });
        });
    }

    async function classify(tweets) {
        var rubrics = parseRubrics(CONFIG.rubrics || '');
        if (!CONFIG.model || !rubrics.length || !CONFIG.key) {
            return { disabled: true };
        }

        var system = [
            "You filter noise out of the user's X/Twitter feed.",
            'Filter rules (label: what to filter):',
            rubrics.map(function (r) { return '- ' + r.label + ': ' + r.description; }).join('\n'),
            'The user message is a JSON array of {id, text}.',
            'Reply with ONLY a JSON array, no prose, no code fences:',
            '[{"id": "<id>", "label": "<label of the matching rule>" | null}]',
            'Include every input id exactly once. Use null when no rule clearly matches; when unsure, use null.',
        ].join('\n');

        try {
            var text = await gmPost('https://openrouter.ai/api/v1/chat/completions', {
                'Authorization': 'Bearer ' + CONFIG.key,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://github.com/pronskiy/twitter-scroller',
                'X-Title': 'Twitter Scroller',
            }, JSON.stringify({
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
                    verdicts[item.id] = labels.has(item.label) ? item.label : null;
                }
            });
            return { verdicts: verdicts };
        } catch (err) {
            console.warn('[Skrl] classify failed:', err.message);
            return { error: err.message };
        }
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
                var label = response.verdicts[t.id] || null;
                cacheVerdict(t.id, label);
                if (label) {
                    var anchor = document.querySelector('a[href="' + t.id + '"]');
                    var article = anchor && anchor.closest('article');
                    if (article && article.style.display !== 'none') {
                        collapseArticle(article, label);
                    }
                }
            });
        });
    }

    // Tweets virtualize in/out of the DOM while scrolling — poll for ones not
    // yet checked. Once a stub is clicked open, the mark keeps the tweet from
    // re-collapsing until it leaves the DOM.
    setInterval(function () {
        if (!compiledFilters.length && !llmEnabled && !linksOnly) return;
        var verdicts = llmEnabled ? getVerdicts() : {};
        document.querySelectorAll('article:not([data-skrl-checked])').forEach(function (article) {
            article.setAttribute('data-skrl-checked', '1');
            // Never hide the reading-position marker the scroll loop stops at.
            if (article.querySelector('button[data-testid="removeBookmark"]')) return;
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
                if (verdicts[id]) collapseArticle(article, verdicts[id]);
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
