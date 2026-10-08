// Twitter Scroller settings — copy this file to config.js and fill it in.
//
//   cp config.example.js config.js
//
// config.js is gitignored (it holds your API key) and is the single source of
// truth for BOTH the Chrome extension (loaded as a content script + imported by
// the background worker) and the iOS userscript (baked in by userscript/sync-ios.sh).
// Edit config.js and reload the extension / re-run sync-ios.sh to apply changes.
globalThis.SKRL_CONFIG = {
    // label: regexp source (case-insensitive). Matched against tweet text;
    // the label is shown on the "filtered: <label>" stub. Invalid patterns are
    // skipped with a console warning. e.g. { "crypto": "crypto ?bro" }
    filters: {},

    // Universal allow-list, case-insensitive regexp sources. A tweet matching
    // any of these — against its text AND its link hrefs — is never hidden by
    // any filter pass (links_only, regexp, or LLM). E.g. ["php", "github"].
    keep: [],

    // Hide every tweet that has no external link (runs before the other passes).
    links_only: false,

    // Structural filters, by kind of post rather than topic. Any of:
    //   "reposts"    — tweets shown because someone you follow reposted them
    //   "replies"    — replies ("Replying to @…") that show up in the feed
    //   "duplicates" — a link card already seen earlier this session
    // They run first (only the bookmarked tweet is exempt, `keep` doesn't apply).
    hide: [],

    // OpenRouter model id. Empty disables the LLM filter.
    //   - Jev ("~typesafe/jev-latest" or a pinned "typesafe/jev-1.13") goes
    //     through the Decisions API: one call per tweet, calibrated probabilities.
    //   - Any other id (e.g. "x-ai/grok-4.3") goes through chat completions.
    model: "",

    // Jev only: hide a tweet when the matched rule's probability is at least
    // this (0..1). The stub shows it, e.g. "filtered: politics 86%".
    threshold: 0.7,

    // LLM rubrics as label: description. The label is the verdict the model
    // returns and is shown on the "filtered: <label>" stub. Empty disables the
    // LLM filter. e.g. { "politics": "elections, politicians, geopolitics" }
    rubrics: {},

    // OpenRouter API key. Empty disables the LLM filter.
    key: ""
};
