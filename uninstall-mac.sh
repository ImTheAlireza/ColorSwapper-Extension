#!/bin/bash

clear

echo ""
echo "  ========================================"
echo "   Color Swapper - Uninstaller"
echo "  ========================================"
echo ""

EXT_DIR="$HOME/Library/Application Support/Adobe/CEP/extensions/ColorSwapper"

if [ ! -d "$EXT_DIR" ]; then
    echo "  Color Swapper is not installed."
    echo ""
    exit 0
fi

echo "  This will remove Color Swapper from:"
echo "  $EXT_DIR"
echo ""
read -p "  Are you sure? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "  Cancelled."
    exit 0
fi

echo ""
echo "  Removing files..."
rm -rf "$EXT_DIR"

echo "  Done. Restart After Effects."
echo ""
