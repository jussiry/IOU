#!/usr/bin/env bash
set -euo pipefail

version_file="client/data/version.json"

if [[ ! -f "$version_file" ]]; then
  echo "0.0.1"
  cat > "$version_file" <<EOF
{
  "version": "0.0.1"
}
EOF
  exit 0
fi

current_version=$(grep -o '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$version_file" \
  | sed -E 's/.*"([^"]*)".*/\1/')

IFS='.' read -r major minor patch <<< "${current_version:-0.0.0}"
major=${major:-0}
minor=${minor:-0}
patch=${patch:-0}
patch=$((patch + 1))
next_version="${major}.${minor}.${patch}"

tmp_file="$(mktemp)"
sed -E "s/\"version\"[[:space:]]*:[[:space:]]*\"[^\"]*\"/\"version\": \"${next_version}\"/" "$version_file" > "$tmp_file"
mv "$tmp_file" "$version_file"

echo "$next_version"
