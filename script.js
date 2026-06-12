(function() {
    'use strict';

    const COMPOSE_SELECTORS = [
        'a[aria-label="Post"]',
        'a[aria-label="Compose a post"]'
    ];

    const MAX_SCROLL_ITERATIONS = 60

    // --- #1: Shared state at module scope — SPA re-init must not create a second copy ---
    let intervalId = null
    let scrollIterations = 0
    let skrl = null // current Skrl button; recreated on SPA re-init

    // --- #2: Wait for compose button instead of fixed 2s delay ---
    function waitForElement(selectors, timeout) {
        return new Promise(function(resolve, reject) {
            var elapsed = 0;
            var interval = 200;
            var check = setInterval(function() {
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

    // --- #5: Visual feedback helper ---
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

    function scrollTwitterTimeline(){
        scrollIterations = 0 // reset on each start
        setScrollingState(true); // --- #5: visual feedback ---
        intervalId = setInterval(() => {
            scrollIterations++
            console.log('scrolling (' + scrollIterations + '/' + MAX_SCROLL_ITERATIONS + ')')

            // --- #4: Auto-stop after limit ---
            if (scrollIterations >= MAX_SCROLL_ITERATIONS) {
                console.warn('[Skrl] Max scroll iterations reached (' + MAX_SCROLL_ITERATIONS + '). Stopping.');
                stopScrolling();
                return;
            }

            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth',
            });

            // Bookmarks are the reading-position markers: the first bookmarked
            // tweet found while scrolling down is the newest one.
            let bookmarked = document.querySelector('button[data-testid="removeBookmark"]');
            if (bookmarked) {
                stopScrolling();
                let article = bookmarked.closest('article');
                (article || bookmarked).scrollIntoView({behavior: 'smooth'})
                setTimeout(function () {
                    window.scrollBy({
                        top: -300,
                        behavior: "smooth",
                    })
                }, 1000)
            }
        }, 1000 + Math.floor(Math.random() * 200))
    }

    // --- #1: Document-level listeners registered once; SPA re-init only re-creates the button ---
    document.addEventListener('keyup', function (event) {
        if (event.ctrlKey && event.shiftKey && (event.key === 'Y' || event.key === 'Н')) {
            toggleScrolling();
        }
    });

    // --- #8: chrome.commands shortcut (Cmd+Shift+Y on Mac) relayed from background.js ---
    chrome.runtime.onMessage.addListener(function (message) {
        if (message === 'toggle-scroll') {
            toggleScrolling();
        }
    });

    // --- #9: Regexp noise filter — patterns from chrome.storage.sync (edited via options page) ---
    let compiledFilters = []

    function compileFilters(patterns) {
        compiledFilters = [];
        (patterns ?? []).forEach(function (pattern) {
            try {
                compiledFilters.push(new RegExp(pattern, 'i'));
            } catch (err) {
                console.warn('[Skrl] Skipping invalid filter pattern:', pattern, err.message);
            }
        });
    }

    chrome.storage.sync.get({ filters: [] }, function (items) {
        compileFilters(items.filters);
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'sync' || !changes.filters) return;
        compileFilters(changes.filters.newValue);
        // Re-evaluate the whole feed: release collapsed tweets, clear scan marks.
        document.querySelectorAll('.skrl-filter-stub').forEach(restoreFiltered);
        document.querySelectorAll('article[data-skrl-checked]').forEach(function (article) {
            article.removeAttribute('data-skrl-checked');
        });
    });

    // Single decision point for "is this tweet noise" — future filter types
    // (beyond the regexp list) extend this function. Returns the matched
    // pattern, or null to keep the tweet.
    function matchFilters(article) {
        let texts = article.querySelectorAll('div[data-testid="tweetText"]');
        if (!texts.length) return null;
        let text = Array.prototype.map.call(texts, function (el) {
            return el.innerText;
        }).join('\n');
        for (const re of compiledFilters) {
            if (re.test(text)) return re;
        }
        return null;
    }

    function collapseArticle(article, matched) {
        const stub = document.createElement('a')
        stub.setAttribute('href', '#')
        stub.setAttribute('class', 'skrl-filter-stub')
        stub.setAttribute('style', 'display: block; padding: 6px 16px; color: rgb(113, 118, 123); font-size: 13px; text-decoration: none;')
        stub.textContent = 'filtered: ' + matched + ' — show'
        article.style.display = 'none';
        article.before(stub)
    }

    function restoreFiltered(stub) {
        let article = stub.nextElementSibling;
        if (article && article.tagName === 'ARTICLE') {
            article.style.display = '';
        }
        stub.remove();
    }

    document.addEventListener('click', function (e) {
        let stub = e.target.closest('.skrl-filter-stub');
        if (stub) {
            e.preventDefault();
            restoreFiltered(stub);
        }
    });

    // Tweets virtualize in/out of the DOM while scrolling — poll for ones
    // not yet checked. Once a stub is clicked open, the mark keeps the
    // tweet from re-collapsing until it leaves the DOM or filters change.
    setInterval(function () {
        if (!compiledFilters.length) return;
        document.querySelectorAll('article:not([data-skrl-checked])').forEach(function (article) {
            article.setAttribute('data-skrl-checked', '1');
            // Never hide the reading-position marker the scroll loop stops at.
            if (article.querySelector('button[data-testid="removeBookmark"]')) return;
            let matched = matchFilters(article);
            if (matched) {
                collapseArticle(article, matched);
            }
        });
    }, 1500);

    function run_twitter_scroller()
    {
        console.log('script.js')

        let compose_button = document.querySelector(`a[aria-label="Post"]`);
        let compose_button_m = document.querySelector(`a[aria-label="Compose a post"]`);

        skrl = document.createElement("a")
        skrl.textContent = 'Skrl'
        skrl.setAttribute('href', '#')
        skrl.setAttribute('class', 'skrl')

        skrl.addEventListener('click', function (event) {
            console.log('skrl click')
            toggleScrolling();
            event.preventDefault();
        });

        // --- #3: Guard against missing compose button ---
        if (compose_button_m) {
            skrl.setAttribute('style', 'width: 30px; margin-top: 20px; border-radius: 50px; display: inline-block; background-color: rgb(29, 155, 240); color: white; padding: 10px;')
            compose_button_m.parentNode.after(skrl)
            compose_button_m.setAttribute('style', 'display: none;')
        } else if (compose_button) {
            skrl.setAttribute('style', 'margin-top: 20px; border-radius: 50px; display: inline-block; background-color: rgb(29, 155, 240); color: white; padding: 10px;')
            compose_button.parentNode.after(skrl)
        } else {
            console.warn('[Skrl] Could not find compose button — skrl button not injected.');
            return;
        }

        // Re-created button must reflect a scroll that is still running.
        setScrollingState(intervalId !== null);
    }

    waitForElement(COMPOSE_SELECTORS, 10000).then(run_twitter_scroller).catch(function(err) {
        console.warn('[Skrl]', err.message);
    });

    // --- #6: Handle SPA navigation ---
    var lastPathname = location.pathname;
    setInterval(function() {
        if (location.pathname !== lastPathname) {
            lastPathname = location.pathname;
            if (location.pathname === '/home' && !document.querySelector('.skrl')) {
                console.log('[Skrl] SPA navigation detected, re-initializing.');
                waitForElement(COMPOSE_SELECTORS, 10000).then(run_twitter_scroller).catch(function(err) {
                    console.warn('[Skrl]', err.message);
                });
            }
        }
    }, 2000);

})();
