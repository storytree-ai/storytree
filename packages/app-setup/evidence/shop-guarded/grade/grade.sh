#!/usr/bin/env bash
# Grades one commit of this build's shop (HuaMick/shop3) with the first build's grader, unchanged: Swag Labs'
# official suite (and, from part 5, wave 2's frozen suite), in this build's own grade folder.
# Usage: grade.sh <ref> <part> <out-prefix>. The grade folder's copy of the pinned suite came from the first build's.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
SHOP_REPO=HuaMick/shop3 SHOP_GRADE="$HOME/storytree-lanes/shop-guarded-grade" exec "$here/../../shop/grade/grade-shop.sh" "$@"
