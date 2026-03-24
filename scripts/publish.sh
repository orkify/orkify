#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACKAGES=("$ROOT/packages/cache" "$ROOT/packages/next" "$ROOT")

# ── Helpers ──────────────────────────────────────────────────────────────────

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
bold()  { printf '\033[1m%s\033[0m\n' "$*"; }

die() { red "Error: $*" >&2; exit 1; }

usage() {
  cat <<EOF
Usage: bash scripts/publish.sh [options]

Publish @orkify/cache, @orkify/next, and @orkify/cli to npm.

Options:
  --bump <type>   Bump version before publishing. Supported types:
                    prerelease  1.0.0-beta.6 → 1.0.0-beta.7 (default pre-id: beta)
                    prepatch    1.0.0-beta.6 → 1.0.1-beta.0
                    preminor    1.0.0-beta.6 → 1.1.0-beta.0
                    premajor    1.0.0-beta.6 → 2.0.0-beta.0
                    patch       1.0.0-beta.6 → 1.0.1
                    minor       1.0.0-beta.6 → 1.1.0
                    major       1.0.0-beta.6 → 2.0.0
  --preid <id>    Pre-release identifier (default: beta)
  --tag <tag>     npm dist-tag (default: latest)
  --dry-run       Show what would happen without publishing
  -h, --help      Show this help
EOF
  exit 0
}

get_version() {
  node -e "console.log(require('$1/package.json').version)"
}

get_name() {
  node -e "console.log(require('$1/package.json').name)"
}

npm_published_version() {
  npm view "$1@$2" version 2>/dev/null || echo ""
}

bump_version() {
  local pkg="$1" type="$2" preid="$3"
  local current new_ver
  current=$(get_version "$pkg")

  case "$type" in
    prerelease|prepatch|preminor|premajor)
      new_ver=$(node -e "
        const v = '$current'.split('-');
        const parts = v[0].split('.').map(Number);
        const pre = v[1] ? v[1].split('.') : ['$preid', '-1'];
        const id = '$preid';
        if ('$type' === 'prerelease') {
          const num = pre[0] === id ? (parseInt(pre[1] || '0') + 1) : 0;
          console.log(parts.join('.') + '-' + id + '.' + num);
        } else if ('$type' === 'prepatch') {
          parts[2]++; console.log(parts.join('.') + '-' + id + '.0');
        } else if ('$type' === 'preminor') {
          parts[1]++; parts[2]=0; console.log(parts.join('.') + '-' + id + '.0');
        } else if ('$type' === 'premajor') {
          parts[0]++; parts[1]=0; parts[2]=0; console.log(parts.join('.') + '-' + id + '.0');
        }
      ")
      ;;
    patch|minor|major)
      new_ver=$(node -e "
        const parts = '$current'.split('-')[0].split('.').map(Number);
        if ('$type' === 'patch') parts[2]++;
        if ('$type' === 'minor') { parts[1]++; parts[2]=0; }
        if ('$type' === 'major') { parts[0]++; parts[1]=0; parts[2]=0; }
        console.log(parts.join('.'));
      ")
      ;;
    *)
      die "Unknown bump type: $type"
      ;;
  esac

  echo "$new_ver"
}

set_version() {
  local pkg="$1" version="$2"
  node -e "
    const fs = require('fs');
    const path = '$pkg/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = '$version';
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
}

# ── Parse args ───────────────────────────────────────────────────────────────

BUMP=""
PREID="beta"
TAG="latest"
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bump)   BUMP="$2"; shift 2 ;;
    --preid)  PREID="$2"; shift 2 ;;
    --tag)    TAG="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    -h|--help) usage ;;
    *) die "Unknown option: $1" ;;
  esac
done

# ── Bump versions ────────────────────────────────────────────────────────────

CURRENT=$(get_version "$ROOT")

if [[ -n "$BUMP" ]]; then
  NEW_VERSION=$(bump_version "$ROOT" "$BUMP" "$PREID")
  bold "Bumping: $CURRENT → $NEW_VERSION"

  for pkg in "${PACKAGES[@]}"; do
    set_version "$pkg" "$NEW_VERSION"
  done

  # Update @orkify/next's dependency on @orkify/cache
  node -e "
    const fs = require('fs');
    const path = '$ROOT/packages/next/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (pkg.dependencies && pkg.dependencies['@orkify/cache']) {
      pkg.dependencies['@orkify/cache'] = '^$NEW_VERSION';
    }
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "
else
  NEW_VERSION="$CURRENT"
fi

# ── Check not already published ──────────────────────────────────────────────

bold "Version: $NEW_VERSION"
echo ""

PUBLISH_PACKAGES=()
for pkg in "${PACKAGES[@]}"; do
  name=$(get_name "$pkg")
  existing=$(npm_published_version "$name" "$NEW_VERSION")
  if [[ -n "$existing" ]]; then
    echo "  $name@$NEW_VERSION — already published, skipping"
  else
    green "$name@$NEW_VERSION — will publish"
    PUBLISH_PACKAGES+=("$pkg")
  fi
done

if [[ ${#PUBLISH_PACKAGES[@]} -eq 0 ]]; then
  green "All packages already published at $NEW_VERSION — nothing to do"
  exit 0
fi

echo ""

# ── Build ────────────────────────────────────────────────────────────────────

bold "Building..."
(cd "$ROOT" && npm run build) || die "Build failed"
echo ""

# ── Publish ──────────────────────────────────────────────────────────────────

if [[ "$DRY_RUN" == true ]]; then
  bold "Dry run — would publish:"
  for pkg in "${PUBLISH_PACKAGES[@]}"; do
    name=$(get_name "$pkg")
    echo "  $name@$NEW_VERSION (tag: $TAG)"
  done
  exit 0
fi

bold "Publishing to npm (tag: $TAG)..."
echo ""

for pkg in "${PUBLISH_PACKAGES[@]}"; do
  name=$(get_name "$pkg")
  echo -n "  $name@$NEW_VERSION ... "
  (cd "$pkg" && npm publish --access public --tag "$TAG") || die "Failed to publish $name"
  green "done"
done

echo ""
green "All packages published successfully!"
echo ""
bold "Verify:"
for pkg in "${PUBLISH_PACKAGES[@]}"; do
  name=$(get_name "$pkg")
  echo "  https://www.npmjs.com/package/$name"
done
