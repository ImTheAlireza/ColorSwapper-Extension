#!/bin/bash
clear

echo ""
echo "  ========================================"
echo "   Color Swapper - Installer"
echo "  ========================================"
echo ""

BASE_URL="https://raw.githubusercontent.com/ImTheAlireza/ColorSwapper-Extension/main"
EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/ColorSwapper"

echo "  Install path:"
echo "  $EXT_DIR"
echo ""

echo "  [1/4] Creating folders..."

mkdir -p "$EXT_DIR/client"
mkdir -p "$EXT_DIR/host"
mkdir -p "$EXT_DIR/CSXS"

echo "        Done."
echo ""

echo "  [2/4] Downloading files..."

FAIL=0

download() {
    local REMOTE="$1"
    local LOCAL="$2"
    echo "        Downloading $REMOTE..."
    
    HTTP_CODE=$(curl -sL -w "%{http_code}" -o "$LOCAL" "$BASE_URL/$REMOTE")
    
    if [ "$HTTP_CODE" != "200" ]; then
        echo "        [FAILED] $REMOTE (HTTP $HTTP_CODE)"
        FAIL=$((FAIL + 1))
        return
    fi
    
    if [ ! -s "$LOCAL" ]; then
        echo "        [FAILED] $REMOTE (empty file)"
        FAIL=$((FAIL + 1))
        return
    fi
}

download "client/index.html"       "$EXT_DIR/client/index.html"
download "client/app.js"           "$EXT_DIR/client/app.js"
download "client/style.css"        "$EXT_DIR/client/style.css"
download "client/CSInterface.js"   "$EXT_DIR/client/CSInterface.js"
download "host/hostScript.jsx"     "$EXT_DIR/host/hostScript.jsx"
download "CSXS/manifest.xml"       "$EXT_DIR/CSXS/manifest.xml"
download ".debug"                  "$EXT_DIR/.debug"
download "version.json"            "$EXT_DIR/version.json"

echo ""

if [ $FAIL -gt 0 ]; then
    echo "  [!] $FAIL file(s) failed to download."
    echo "      Check your internet connection and try again."
    echo ""
    exit 1
fi

echo "        All files downloaded."
echo ""

echo "  [3/4] Enabling unsigned extensions..."

for v in 8 9 10 11 12; do
    defaults write com.adobe.CSXS.$v PlayerDebugMode 1 2>/dev/null
done

echo "        Done."
echo ""

echo "  [4/4] Installation complete!"
echo ""
echo "  ========================================"
echo "   Next steps:"
echo "   1. Close After Effects completely"
echo "   2. Reopen After Effects"
echo "   3. Go to Window > Extensions > Color Swapper"
echo "  ========================================"
echo ""
