console.log('script.js')

const addToSkip = document.createElement("a")
addToSkip.textContent = 'Skip'
addToSkip.setAttribute('href', '#')
addToSkip.setAttribute('class', 'ts_add-to-skip')

let intervalId = null
function scrollTwitterTimeline(){
    intervalId = setInterval(() => {
        console.log('scrolling')
        window.scrollTo({
            top: document.body.scrollHeight,
            behavior: 'smooth',
        });

        let liked = document.querySelector('div[aria-label$="Liked"]');
        if (liked) {
            // let skipId = liked.getAttribute('id');
            let skipId = liked.closest('article').querySelector('a:has(time)').getAttribute('href');  
            if (!isSkipped(skipId)) {
                clearInterval(intervalId);
                intervalId = null;
                liked.scrollIntoView({behavior: 'smooth'})
                let cloneNode = addToSkip.cloneNode(true);
                cloneNode.setAttribute('data-id', skipId)
                liked.appendChild(cloneNode)
            }
        }
    }, 1000);  // Scroll every 1000 milliseconds
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
