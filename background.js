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
