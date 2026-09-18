#!/usr/bin/env bash
# Delete every local build artifact except the current version's.
#
# ⚠️ release/ REACHED 70 GB. electron-builder writes a ~160 MB dmg and zip for
# every version and nothing ever removed them — 1,025 files back to the first
# release, all of them already on GitHub Releases, which is the only copy that
# matters (the app updates from there, the website downloads from there).
# Tony: "your radiant releases are eating up a lot of my disk space."
# Run after every release; AGENTS.md lists it as part of shipping.
set -euo pipefail
cd "$(dirname "$0")/.."
ver=$(node -p "require('./package.json').version")
kept=0; gone=0
for f in release/*; do
  b=$(basename "$f")
  case "$b" in
    *"$ver"*|mac-arm64|latest-mac.yml|builder-debug.yml) kept=$((kept+1)) ;;
    *) rm -rf "$f"; gone=$((gone+1)) ;;
  esac
done
# iOS archives: the two newest, so the one Apple holds can still be re-exported
arch=~/Library/Developer/Xcode/Archives
if [ -d "$arch" ]; then
  ls -dt "$arch"/*/*.xcarchive 2>/dev/null | tail -n +3 | xargs -I{} rm -rf {}
  find "$arch" -type d -empty -delete 2>/dev/null || true
fi
echo "release/: kept $kept for $ver, removed $gone · $(du -sh release | cut -f1)"
