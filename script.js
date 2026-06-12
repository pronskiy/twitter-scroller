(function() {
    'use strict';

    const COMPOSE_SELECTORS = [
        'a[aria-label="Post"]',
        'a[aria-label="Compose a post"]'
    ];

    const last_read_tweet = '/exakat/status/1669236975218442240'
    const storage_key = 'ts_skipped'
    const MAX_SCROLL_ITERATIONS = 60

    // --- #1: Shared state at module scope — SPA re-init must not create a second copy ---
    let intervalId = null
    let scrollIterations = 0
    let skrl = null // current Skrl button; recreated on SPA re-init

    const addToSkip = document.createElement("a")
    addToSkip.textContent = 'Skip'
    addToSkip.setAttribute('href', '#')
    addToSkip.setAttribute('class', 'ts_add-to-skip')

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

            let read = document.querySelector(`a[href="${last_read_tweet}"]`);
            if (read) {
                stopScrolling();
                read.scrollIntoView({behavior: 'smooth'})
                return;
            }

            let liked = document.querySelector('div[aria-label~="Liked,"]');
            if (liked) {
                // Permalink lookup can fail when Twitter changes markup — stop anyway,
                // just without offering Skip.
                let article = liked.closest('article');
                let permalink = article && article.querySelector('a:has(time)');
                let skipId = permalink && permalink.getAttribute('href');
                if (!skipId || !isSkipped(skipId)) {
                    stopScrolling();
                    liked.scrollIntoView({behavior: 'smooth'})
                    let group = liked.closest('[role="group"]');
                    if (skipId && group) {
                        let cloneNode = addToSkip.cloneNode(true);
                        cloneNode.setAttribute('data-id', skipId)
                        group.appendChild(cloneNode)
                    }
                    setTimeout(function () {
                        window.scrollBy({
                            top: -300,
                            behavior: "smooth",
                        })
                    }, 1000)

                }
            }
        }, 1000 + Math.floor(Math.random() * 200))
    }

    // --- #7: Cap skip list at 200 entries ---
    function addToSkipped(id) {
        if (!id) return;
        let skipped = JSON.parse(localStorage.getItem(storage_key)) ?? [];
        skipped.push(id)
        if (skipped.length > 200) {
            skipped = skipped.slice(-200);
        }
        localStorage.setItem(storage_key, JSON.stringify(skipped))
    }

    function isSkipped(id) {
        let skipped = JSON.parse(localStorage.getItem(storage_key)) ?? [];

        return skipped.includes(id);
    }

    // --- #1: Document-level listeners registered once; SPA re-init only re-creates the button ---
    document.addEventListener('keyup', function (event) {
        console.log('keyup')
        if (event.ctrlKey && event.shiftKey && (event.key === 'Y' || event.key === 'Н')) {
            toggleScrolling();
        }
    });

    document.addEventListener('click', e => {
        console.log('click')
        if (e.target.closest('.ts_add-to-skip')) {
            e.preventDefault();
            let skipId = e.target.getAttribute('data-id')
            addToSkipped(skipId)
        }
    })

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
