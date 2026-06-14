// Twitter Scroller settings — copy this file to config.js and fill it in.
//
//   cp config.example.js config.js
//
// config.js is gitignored (it holds your API key) and is the single source of
// truth for BOTH the Chrome extension (loaded as a content script + imported by
// the background worker) and the iOS userscript (baked in by userscript/sync-ios.sh).
// Edit config.js and reload the extension / re-run sync-ios.sh to apply changes.
globalThis.SKRL_CONFIG = {
    // Regexp sources, case-insensitive, one string per entry. Matched against
    // tweet text. Invalid patterns are skipped with a console warning.
    filters: [],

    // Universal allow-list, case-insensitive regexp sources. A tweet matching
    // any of these — against its text AND its link hrefs — is never hidden by
    // any filter pass (links_only, regexp, or LLM). E.g. ["php", "github"].
    keep: [],

    // Hide every tweet that has no external link (runs before the other passes).
    links_only: false,

    // OpenRouter model id, e.g. "openai/gpt-4o-mini". Empty disables the LLM filter.
    model: "",

    // LLM rubrics, one "label: description" per line. Empty disables the LLM filter.
    // e.g. "politics: elections, politicians, geopolitics"
    rubrics: "",

    // OpenRouter API key. Empty disables the LLM filter.
    key: ""
};
