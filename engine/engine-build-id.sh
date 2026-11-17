#!/usr/bin/env bash
# The engine build id: what the engine is made of, not what its image is called. A short hash over the two pinned
# commits (engine/build-images.sh) and our two patches, carriage returns removed (a Windows checkout gives the same id).
# engine/build-images.sh bakes it into the node image (SELF_HOSTED_NODE_ENGINE_BUILD); tools/deploy.js records the same
# id (tools/engine-build-id.js, the same recipe) as stack/deployed.json engineBuild; an own-server companion compares
# the server's with the table's. Two builds from the same patches have the same id whatever their tag.
#   bash engine/engine-build-id.sh [engine folder]      prints eb-<12 hex>
set -euo pipefail
dir="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
mb="$(sed -n 's/^MANABREW_COMMIT=//p' "$dir/build-images.sh")"
fg="$(sed -n 's/^FORGE_COMMIT=//p' "$dir/build-images.sh")"
hash="$( { printf 'manabrew %s\nforge %s\n' "$mb" "$fg"; tr -d '\r' < "$dir/manabrew.patch"; printf '\0'; tr -d '\r' < "$dir/forge.patch"; } | sha256sum | cut -c1-12)"
echo "eb-$hash"
