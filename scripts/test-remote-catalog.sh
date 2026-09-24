#!/usr/bin/env bash
# The published model list, read by the REAL Swift readers — the one in this
# build, and the frozen one every phone before build 28 runs.
#
# ⚠️ THE OLD TEST COPIED THE LOGIC AND NEVER RAN THE FILE, so it could not see
# that Swift's synthesized decoder requires every key: the shipped reader threw
# on the first row without `vision`, and no phone ever used the published list.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
cp scripts/remote-catalog-test/shipped.swift "$T/main.swift"
swiftc -o "$T/shipped" scripts/fixtures/RemoteCatalog-shipped.swift "$T/main.swift"
echo "  the reader on phones today (App Store 1.1 → build 27):"; "$T/shipped"
cp scripts/remote-catalog-test/current.swift "$T/main.swift"
swiftc -o "$T/current" apps/ios/ios/App/App/plugins/RemoteCatalog.swift "$T/main.swift"
echo "  the reader in this build:"; "$T/current"
echo; echo "  the published list reads correctly on every build, old and new"
