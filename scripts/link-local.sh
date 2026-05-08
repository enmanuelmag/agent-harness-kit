#!/usr/bin/env bash
# scripts/link-local.sh -- Link the local build into another project for testing.
#
# Usage:
#   ./scripts/link-local.sh [target-project-path]
#
# If no target path is given, the script only builds and globally registers the
# package with `npm link` so you can run `npm link @cardor/agent-harness-kit`
# manually in any project afterward.
#
# With a target path, it does everything in one shot:
#   1. Build the package
#   2. Register it globally via npm link
#   3. Link it into the target project
#   4. Verify the `ahk` binary is reachable from the target project

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TARGET_DIR="${1:-}"

# -- 1. Build -----------------------------------------------------------------
echo "==> Building package..."
cd "$PACKAGE_DIR"
npm run build

# -- 2. Register globally -----------------------------------------------------
echo "==> Registering with npm link..."
npm link

if [[ -z "$TARGET_DIR" ]]; then
  echo ""
  echo "OK: Package registered globally."
  echo ""
  echo "  To link into a project, run inside that project:"
  echo "    npm link @cardor/agent-harness-kit"
  echo ""
  echo "  Or pass the project path directly:"
  echo "    ./scripts/link-local.sh /path/to/your-project"
  exit 0
fi

# -- 3. Link into target project ----------------------------------------------
ABS_TARGET="$(cd "${TARGET_DIR}" && pwd)"
echo "==> Linking into ${ABS_TARGET}..."
cd "${ABS_TARGET}"
npm link @cardor/agent-harness-kit

# -- 4. Smoke-test the binary -------------------------------------------------
echo "==> Verifying ahk binary..."
if npx ahk --version 2>/dev/null; then
  echo ""
  echo "OK: 'ahk' is linked and working in ${ABS_TARGET}"
  echo ""
  echo "  Try it:"
  echo "    cd ${ABS_TARGET}"
  echo "    npx ahk init"
else
  echo ""
  echo "WARN: 'ahk' did not respond to --version."
  echo "  The link was created but something may be wrong with the build."
  exit 1
fi
