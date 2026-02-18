(function() {
    'use strict';

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

    waitForElement([
        'a[aria-label="Post"]',
        'a[aria-label="Compose a post"]'
    ], 10000).then(run_twitter_scroller).catch(function(err) {
        console.warn('[Skrl]', err.message);
    });

    // --- #1: run_twitter_scroller moved inside IIFE ---
    function run_twitter_scroller()
    {
        console.log('script.js')

        const last_read_tweet = '/exakat/status/1669236975218442240'

        const addToSkip = document.createElement("a")
        addToSkip.textContent = 'Skip'
        addToSkip.setAttribute('href', '#')
        addToSkip.setAttribute('class', 'ts_add-to-skip')

        let compose_button = document.querySelector(`a[aria-label="Post"]`);
        let compose_button_m = document.querySelector(`a[aria-label="Compose a post"]`);

        const skrl = document.createElement("a")
        skrl.textContent = 'Skrl'
        skrl.setAttribute('href', '#')
        skrl.setAttribute('class', 'skrl')

        // --- #5: Visual feedback helper ---
        function setScrollingState(active) {
            if (active) {
                skrl.textContent = 'Stop';
                skrl.style.backgroundColor = 'rgb(244, 33, 46)';
            } else {
                skrl.textContent = 'Skrl';
                skrl.style.backgroundColor = 'rgb(29, 155, 240)';
            }
        }

        skrl.addEventListener('click', function (event) {
            console.log('skrl click')

            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
                setScrollingState(false);
            }
            else {
                scrollTwitterTimeline();
            }
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


        let intervalId = null
        let scrollIterations = 0 // --- #4: scroll safety counter ---
        const MAX_SCROLL_ITERATIONS = 60

        function scrollTwitterTimeline(){
            scrollIterations = 0 // reset on each start
            setScrollingState(true); // --- #5: visual feedback ---
            intervalId = setInterval(() => {
                scrollIterations++
                console.log('scrolling (' + scrollIterations + '/' + MAX_SCROLL_ITERATIONS + ')')

                // --- #4: Auto-stop after limit ---
                if (scrollIterations >= MAX_SCROLL_ITERATIONS) {
                    console.warn('[Skrl] Max scroll iterations reached (' + MAX_SCROLL_ITERATIONS + '). Stopping.');
                    clearInterval(intervalId);
                    intervalId = null;
                    setScrollingState(false);
                    return;
                }

                window.scrollTo({
                    top: document.body.scrollHeight,
                    behavior: 'smooth',
                });

                let read = document.querySelector(`a[href="${last_read_tweet}"]`);
                if (read) {
                    clearInterval(intervalId);
                    intervalId = null;
                    setScrollingState(false);
                    read.scrollIntoView({behavior: 'smooth'})
                    return;
                }

                let liked = document.querySelector('div[aria-label~="Liked,"]');
                if (liked) {
                    let skipId = liked.closest('article').querySelector('a:has(time)').getAttribute('href');
                    if (!isSkipped(skipId)) {
                        clearInterval(intervalId);
                        intervalId = null;
                        setScrollingState(false);
                        liked.scrollIntoView({behavior: 'smooth'})
                        let cloneNode = addToSkip.cloneNode(true);
                        cloneNode.setAttribute('data-id', skipId)
                        liked.closest('[role="group"]').appendChild(cloneNode)
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

        document.addEventListener('keyup', function (event) {
            console.log('keyup')
            if (event.ctrlKey && event.shiftKey && (event.key === 'Y' || event.key === 'Н')) {
                if (intervalId !== null) {
                    clearInterval(intervalId);
                    intervalId = null;
                    setScrollingState(false);
                }
                else {
                    scrollTwitterTimeline();
                }
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

        const storage_key = 'ts_skipped'

        // --- #7: Cap skip list at 200 entries ---
        function addToSkipped(id) {
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

    }

    // --- #6: Handle SPA navigation ---
    var lastPathname = location.pathname;
    setInterval(function() {
        if (location.pathname !== lastPathname) {
            lastPathname = location.pathname;
            if (location.pathname === '/home' && !document.querySelector('.skrl')) {
                console.log('[Skrl] SPA navigation detected, re-initializing.');
                waitForElement([
                    'a[aria-label="Post"]',
                    'a[aria-label="Compose a post"]'
                ], 10000).then(run_twitter_scroller).catch(function(err) {
                    console.warn('[Skrl]', err.message);
                });
            }
        }
    }, 2000);

})();
