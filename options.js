(function () {
    'use strict';

    const filtersEl = document.getElementById('filters');
    const keyEl = document.getElementById('openrouter-key');
    const modelEl = document.getElementById('model');
    const rubricsEl = document.getElementById('rubrics');
    const status = document.getElementById('status');

    const linksOnlyEl = document.getElementById('links-only');

    chrome.storage.sync.get({ filters: [], model: '', rubrics: '', links_only: false }, function (items) {
        filtersEl.value = items.filters.join('\n');
        modelEl.value = items.model;
        rubricsEl.value = items.rubrics;
        linksOnlyEl.checked = items.links_only;
    });

    chrome.storage.local.get({ openrouter_key: '' }, function (items) {
        keyEl.value = items.openrouter_key;
    });

    // Populate the model picker from OpenRouter's public model list.
    fetch('https://openrouter.ai/api/v1/models')
        .then(function (res) { return res.json(); })
        .then(function (data) {
            const list = document.getElementById('model-list');
            (data.data ?? []).forEach(function (m) {
                const option = document.createElement('option');
                option.value = m.id;
                list.appendChild(option);
            });
        })
        .catch(function () {
            document.getElementById('model-hint').textContent =
                'Could not load the model list — paste any model ID from openrouter.ai/models.';
        });

    document.getElementById('save').addEventListener('click', function () {
        const lines = filtersEl.value
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

        chrome.storage.local.set({ openrouter_key: keyEl.value.trim() }, function () {
            chrome.storage.sync.set({
                filters: lines,
                model: modelEl.value.trim(),
                rubrics: rubricsEl.value.trim(),
                links_only: linksOnlyEl.checked,
            }, function () {
                status.textContent = 'Saved';
                status.className = 'ok';
                setTimeout(function () {
                    status.textContent = '';
                    status.className = '';
                }, 2000);
            });
        });
    });
})();
