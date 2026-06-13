#!/usr/bin/env bash
# Copy the iOS userscript into the iCloud Drive folder the Userscripts app reads,
# so it syncs to the iPhone. Also removes the old crashing script / leftover zip.
#
# Usage: ./userscript/sync-ios.sh
# Override the destination with: USERSCRIPTS_DIR=/path ./userscript/sync-ios.sh
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${USERSCRIPTS_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/Userscripts}"

if [ ! -d "$DEST" ]; then
    echo "Destination not found: $DEST" >&2
    echo "Set USERSCRIPTS_DIR to your Userscripts folder and retry." >&2
    exit 1
fi

# Remove the previous (crashing) version and the stale package, if present.
rm -f "$DEST/Twitter Scroller.user.js" "$DEST/twitter-scroller.zip"

cp "$SRC_DIR/skrl.user.js" "$DEST/skrl.user.js"
echo "Synced skrl.user.js -> $DEST"
