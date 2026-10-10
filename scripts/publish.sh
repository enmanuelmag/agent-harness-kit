#!/usr/bin/env bash
# scripts/publish.sh -- Build, publish to npm, and create a GitHub release.
#
# Usage:
#   ./scripts/publish.sh [--dry-run] [--skip-tests]
#
# Requires:
#   - pnpm installed
#   - gh CLI installed and authenticated (gh auth login)
#   - GITHUB_TOKEN or gh login for release creation

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DRY_RUN=false
SKIP_TESTS=false

# -- Parse args ---------------------------------------------------------------
for arg in "$@"; do
  case $arg in
    --dry-run)    DRY_RUN=true ;;
    --skip-tests) SKIP_TESTS=true ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--dry-run] [--skip-tests]"
      exit 1
      ;;
  esac
done

cd "$PACKAGE_DIR"

# -- Helpers ------------------------------------------------------------------
info()    { echo ""; echo "==> $*"; }
success() { echo ""; echo "✓  $*"; }
warn()    { echo ""; echo "!  $*"; }
die()     { echo ""; echo "✗  ERROR: $*" >&2; exit 1; }

if $DRY_RUN; then
  warn "DRY RUN — no publish or release will be created."
fi

# -- 1. Read package metadata -------------------------------------------------
info "Reading package metadata..."
# The manifest is authoritative; shared guards enforce branch/channel/tag safety.
PACKAGE_NAME=$(node scripts/release-metadata.mjs name)
VERSION=$(node scripts/release-metadata.mjs version)
TAG=$(node scripts/release-metadata.mjs tag)
CHANNEL=$(node scripts/release-metadata.mjs channel)
PRERELEASE=$(node scripts/release-metadata.mjs prerelease)
PREPARED_TAG=$(node scripts/release-metadata.mjs preparedTag)

echo "  Package : $PACKAGE_NAME"
echo "  Version : $VERSION"
echo "  Tag     : $TAG"

# -- 2. Ensure git state is clean ---------------------------------------------
info "Checking git state..."
if [[ -n "$(git status --porcelain)" ]]; then
  die "Working tree is dirty. Commit or stash your changes before publishing."
fi
success "Working tree is clean."

# -- 3. Shared metadata already checked immutable existing tags ---------------
if [[ "$PREPARED_TAG" == true ]]; then
  success "Prepared tag $TAG points at HEAD; it will be reused."
else
  success "Tag $TAG is available."
fi

# -- 4. Check gh CLI only for an actual publication ---------------------------
if ! $DRY_RUN; then
  info "Checking GitHub CLI..."
  command -v gh &>/dev/null || die "'gh' CLI not found. Install it: https://cli.github.com"
  gh auth status &>/dev/null || die "Not authenticated with gh. Run: gh auth login"
  success "gh CLI is ready."
fi

# -- 5. Run tests -------------------------------------------------------------
if $SKIP_TESTS; then
  warn "Skipping tests (--skip-tests passed)."
else
  info "Running tests..."
  pnpm test || die "Tests failed. Fix them before publishing."
  success "Tests passed."
fi

# -- 6. Build -----------------------------------------------------------------
info "Building package..."
pnpm run build || die "Build failed."
success "Build complete."

# -- 7. Publish to npm --------------------------------------------------------
info "Publishing $PACKAGE_NAME@$VERSION to npm..."
TARBALL=$(pnpm pack 2>/dev/null | tail -1)
trap 'rm -f "$TARBALL"' EXIT
if $DRY_RUN; then
  npm publish "$TARBALL" --access public --tag "$CHANNEL" --dry-run
  warn "Dry run complete — nothing was published to npm."
else
  npm publish "$TARBALL" --access public --tag "$CHANNEL"
  success "Published $PACKAGE_NAME@$VERSION to npm."
fi
rm -f "$TARBALL"
trap - EXIT

# -- 8. Create git tag --------------------------------------------------------
info "Creating git tag $TAG..."
if $DRY_RUN; then
  warn "Dry run — skipping tag creation."
else
  if [[ "$PREPARED_TAG" != true ]]; then
    git tag -a "$TAG" -m "Release $TAG"
  fi
  git push origin "$TAG"
  success "Tag $TAG pushed to origin."
fi

# -- 9. Build release notes from recent commits -------------------------------
info "Building release notes..."
# awk avoids the grep|head SIGPIPE that breaks pipefail
PREV_TAG=$(git tag --sort=-version:refname | awk "/^${TAG}$/{next} {print; exit}")

if [[ -n "$PREV_TAG" ]]; then
  RELEASE_NOTES=$(git log "${PREV_TAG}..HEAD" --pretty=format:"- %s" --no-merges)
  RANGE_LABEL="Changes since $PREV_TAG"
else
  RELEASE_NOTES=$(git log --pretty=format:"- %s" --no-merges | awk 'NR<=20')
  RANGE_LABEL="Initial release commits"
fi

RELEASE_BODY="## $RANGE_LABEL

${RELEASE_NOTES}

---
Published to npm: \`pnpm add ${PACKAGE_NAME}@${VERSION}\`"

echo ""
echo "$RELEASE_BODY"

# -- 10. Create GitHub release ------------------------------------------------
info "Creating GitHub release $TAG..."
if $DRY_RUN; then
  warn "Dry run — skipping GitHub release creation."
else
  RELEASE_FLAGS=(--latest)
  if [[ "$PRERELEASE" == true ]]; then
    RELEASE_FLAGS=(--prerelease --latest=false)
  elif [[ "$CHANNEL" == v2 ]]; then
    RELEASE_FLAGS=(--latest=false)
  fi
  gh release create "$TAG" \
    --title "$TAG" \
    --notes "$RELEASE_BODY" \
    "${RELEASE_FLAGS[@]}"
  success "GitHub release $TAG created."
fi

# -- Done ---------------------------------------------------------------------
echo ""
echo "=============================================="
if $DRY_RUN; then
  echo "  Dry run complete — no changes were made."
else
  echo "  Published: $PACKAGE_NAME@$VERSION"
  echo "  npm:       https://www.npmjs.com/package/${PACKAGE_NAME}/v/${VERSION}"
  echo "  GitHub:    $(gh repo view --json url -q .url)/releases/tag/${TAG}"
fi
echo "=============================================="
