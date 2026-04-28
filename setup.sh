#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "📦  Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

# Make the CLI executable
chmod +x "$SCRIPT_DIR/src/index.js"

echo ""
echo "✅  Setup complete!"
echo ""
echo "Usage:"
echo "  node $SCRIPT_DIR/src/index.js"
echo ""
echo "Or link globally with:"
echo "  npm link"
echo "  pnpm-git-changes"

