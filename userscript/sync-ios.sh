#!/usr/bin/env bash
# Build the iOS userscript by baking the repo's config.js into it, then copy it
# into the iCloud Drive folder the Userscripts app reads (which syncs it to the
# iPhone). Also removes the old crashing script / leftover zip.
#
# Usage: ./userscript/sync-ios.sh
# Override the destination with: USERSCRIPTS_DIR=/path ./userscript/sync-ios.sh
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SRC_DIR/.." && pwd)"
CONFIG="$REPO_DIR/config.js"
TEMPLATE="$SRC_DIR/skrl.user.js"
DEST="${USERSCRIPTS_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Userscripts}"

if [ ! -f "$CONFIG" ]; then
    echo "Missing $CONFIG" >&2
    echo "Create it first:  cp config.example.js config.js  (then fill in your settings)" >&2
    exit 1
fi
if [ ! -d "$DEST" ]; then
    echo "Destination not found: $DEST" >&2
    echo "Set USERSCRIPTS_DIR to your Userscripts folder and retry." >&2
    exit 1
fi

# Remove the previous (crashing) version and the stale package, if present.
rm -f "$DEST/Twitter Scroller.user.js" "$DEST/twitter-scroller.zip"

# Bake config.js into the userscript at the /* __CONFIG__ */ marker line.
awk -v cfg="$CONFIG" '
    /\/\* __CONFIG__ \*\// {
        while ((getline line < cfg) > 0) print line
        close(cfg)
        next
    }
    { print }
' "$TEMPLATE" > "$DEST/skrl.user.js"

echo "Built skrl.user.js (config baked in) -> $DEST"
