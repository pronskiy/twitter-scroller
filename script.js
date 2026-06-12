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
