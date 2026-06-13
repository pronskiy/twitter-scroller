// ==UserScript==
// @name         Twitter Scroller (Skrl)
// @namespace    https://github.com/pronskiy/twitter-scroller
// @description  Auto-scroll the X/Twitter feed to your newest bookmark. Memory-safe for iOS Safari.
// @match        https://x.com/*
// @run-at       document-end
// @grant        none
// @version      1.0.0
// ==/UserScript==

(function () {
    'use strict';

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
