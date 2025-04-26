#!/bin/bash

# Fail immediately if anything goes wrong
set -e

# Temporary working directory
TEMP_DIR=$(mktemp -d)

# Clone the repo fresh every time
echo "Cloning the Clover repo..."
git clone https://github.com/HyrumHendrickson/clover.git "$TEMP_DIR"

# Make sure necessary directories exist
echo "Preparing install directories..."
sudo mkdir -p /usr/local/bin
sudo mkdir -p /usr/local/lib/clover
sudo mkdir -p /usr/local/share/man/man1

# Install the 'clover' executable
echo "Installing 'clover' executable..."
sudo cp "$TEMP_DIR/backups/clover" /usr/local/bin/
sudo chmod +x /usr/local/bin/clover

# Fully replace the library directory
echo "Installing supporting files..."
sudo rm -rf /usr/local/lib/clover
sudo mkdir -p /usr/local/lib/clover
sudo cp -r "$TEMP_DIR/"* /usr/local/lib/clover/

# Install the man page from backups/clover.1
if [ -f "$TEMP_DIR/backups/clover.1" ]; then
    echo "Installing man page..."
    sudo cp "$TEMP_DIR/backups/clover.1" /usr/local/share/man/man1/
    sudo gzip -f /usr/local/share/man/man1/clover.1
else
    echo "⚠️ Warning: Man page 'clover.1' not found in backups/"
fi

# Update man database (optional but recommended)
sudo mandb

# Clean up temporary files
rm -rf "$TEMP_DIR"

echo "✅ Clover installed or updated successfully!"
echo "You can now run it by typing 'clover' and read the manual with 'man clover'"
