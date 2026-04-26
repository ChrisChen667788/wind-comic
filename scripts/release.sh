#!/usr/bin/env bash
# Wind Comic release helper.
#
# Usage:
#   npm run release -- patch         # 2.12.0 → 2.12.1
#   npm run release -- minor         # 2.12.0 → 2.13.0
#   npm run release -- major         # 2.12.0 → 3.0.0
#   npm run release -- 2.12.1        # explicit version
#
# What it does:
#   1. Verifies working tree is clean
#   2. Runs typecheck + tests (must pass)
#   3. Bumps package.json version
#   4. Commits the bump as `chore(release): vX.Y.Z`
#   5. Tags `vX.Y.Z`
#   6. Pushes commit + tag to origin/main
#
# Safe to abort with Ctrl-C at any prompt; nothing is pushed until the final step.

set -euo pipefail

BUMP=${1:?"usage: npm run release -- <patch|minor|major|x.y.z>"}

cd "$(dirname "$0")/.."

# 1. Working tree clean?
if ! git diff-index --quiet HEAD --; then
  echo "✗ working tree has uncommitted changes — commit or stash first."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "✗ not on main branch (currently on $CURRENT_BRANCH). Switch and try again."
  exit 1
fi

# 2. Test + typecheck gate
echo "→ running typecheck..."
npm run typecheck
echo "→ running tests..."
npm test

# 3. Bump version
echo "→ bumping version ($BUMP)..."
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version | tr -d 'v')
TAG="v$NEW_VERSION"

echo ""
echo "About to release: $TAG"
echo "  commit: chore(release): $TAG"
echo "  tag:    $TAG"
echo "  push:   origin main + $TAG"
echo ""
read -rp "Proceed? [y/N] " ans
case "$ans" in
  [Yy]*) ;;
  *) echo "aborted; reverting version bump."
     git checkout -- package.json package-lock.json 2>/dev/null || git checkout -- package.json
     exit 1 ;;
esac

# 4. Commit + tag
git add package.json package-lock.json 2>/dev/null || git add package.json
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "Wind Comic $TAG"

# 5. Push
git push origin main
git push origin "$TAG"

echo ""
echo "✓ released $TAG"
echo "  https://github.com/ChrisChen667788/wind-comic/releases/tag/$TAG"
