(function() {
    'use strict';

    setTimeout(function(){
        run_twitter_scroller();
    }, 2000);
})();

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
    skrl.addEventListener('click', function (event) {
        console.log('skrl click')

        if (intervalId !== null) {
            clearInterval(intervalId);
            intervalId = null;
        }
        else {
            scrollTwitterTimeline();
        }
        event.preventDefault();
    });

    if (compose_button_m) {
        skrl.setAttribute('style', 'width: 30px; margin-top: 20px; border-radius: 50px; display: inline-block; background-color: rgb(29, 155, 240); color: white; padding: 10px;')
        compose_button_m.parentNode.after(skrl)
        compose_button_m.setAttribute('style', 'display: none;')
    } else {
        skrl.setAttribute('style', 'margin-top: 20px; border-radius: 50px; display: inline-block; background-color: rgb(29, 155, 240); color: white; padding: 10px;')
        compose_button.parentNode.after(skrl)
    }


    let intervalId = null
    function scrollTwitterTimeline(){
        intervalId = setInterval(() => {
            console.log('scrolling')

            window.scrollTo({
                top: document.body.scrollHeight,
                behavior: 'smooth',
            });

            let read = document.querySelector(`a[href="${last_read_tweet}"]`);
            if (read) {
                clearInterval(intervalId);
                intervalId = null;
                read.scrollIntoView({behavior: 'smooth'})
                return;
            }

            let liked = document.querySelector('div[aria-label~="Liked,"]');
            if (liked) {
                // let skipId = liked.getAttribute('id');
                let skipId = liked.closest('article').querySelector('a:has(time)').getAttribute('href');
                if (!isSkipped(skipId)) {
                    clearInterval(intervalId);
                    intervalId = null;
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
        }, 1000 + Math.floor(Math.random() * 200)) // Scroll every 1000 milliseconds
    }

    document.addEventListener('keyup', function (event) {
        console.log('keyup')
        if (event.ctrlKey && event.shiftKey && (event.key === 'Y' || event.key === 'Н')) {
            if (intervalId !== null) {
                clearInterval(intervalId);
                intervalId = null;
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

    function addToSkipped(id) {
        let skipped = JSON.parse(localStorage.getItem(storage_key)) ?? [];
        skipped.push(id)
        localStorage.setItem(storage_key, JSON.stringify(skipped))
    }

    function isSkipped(id) {
        let skipped = JSON.parse(localStorage.getItem(storage_key)) ?? [];

        return skipped.includes(id);
    }

}
