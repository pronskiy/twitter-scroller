(function () {
    'use strict';

    const textarea = document.getElementById('filters');
    const status = document.getElementById('status');

    chrome.storage.sync.get({ filters: [] }, function (items) {
        textarea.value = items.filters.join('\n');
    });

    document.getElementById('save').addEventListener('click', function () {
        const lines = textarea.value
            .split('\n')
            .map(function (line) { return line.trim(); })
            .filter(function (line) { return line !== ''; });

        for (const line of lines) {
            try {
                new RegExp(line, 'i');
            } catch (err) {
                status.textContent = 'Invalid pattern "' + line + '": ' + err.message;
                status.className = 'error';
                return;
            }
        }

        chrome.storage.sync.set({ filters: lines }, function () {
            status.textContent = 'Saved (' + lines.length + ' pattern' + (lines.length === 1 ? '' : 's') + ')';
            status.className = 'ok';
            setTimeout(function () {
                status.textContent = '';
                status.className = '';
            }, 2000);
        });
    });
})();
