#!/bin/bash
# gmail-mcp-local installer (macOS / Linux). Double-click in Finder, or run in Terminal.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$DIR/app"
DEST="$HOME/.gmail-mcp-local/app"

echo "============================================"
echo "  gmail-mcp-local  -  installer (macOS/Linux)"
echo "============================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required but was not found."
  echo "Install the LTS from https://nodejs.org , reopen Terminal, and run this again."
  read -r -p "Press Enter to close. "
  exit 1
fi

echo "Installing to $DEST ..."
mkdir -p "$DEST"
cp -R "$SRC/." "$DEST/"

cd "$DEST"
echo "Installing dependencies (keychain helper) ..."
npm install --omit=dev --no-audit --no-fund
echo "Wiring into your MCP client (Claude Desktop / Cursor) ..."
node "scripts/install-into-client.js"

echo
echo "Done!"
echo "  1) Fully quit and reopen Claude Desktop (or Cursor)."
echo "  2) In the chat:  connect_account({ ref: \"work\" })"
echo
echo "Your email and login token stay on THIS computer. Nothing is sent to any server."
echo
read -r -p "Press Enter to close. "
