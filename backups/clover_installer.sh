#!/bin/bash
set -e

# Temporary working directory
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

# Download and extract the Clover repo
echo "Downloading Clover archive..."
curl -L -o clover.tar.gz https://github.com/HyrumHendrickson/Clover/archive/refs/heads/master.tar.gz
tar -xzf clover.tar.gz

# Move into the extracted repo (GitHub creates folder as "Clover-master")
cd Clover-master

# Prepare install directories
echo "Preparing install directories..."
sudo mkdir -p /usr/local/bin
sudo mkdir -p /usr/local/lib/clover
sudo mkdir -p /usr/local/share/man/man1

# Install the 'clover' executable
echo "Installing 'clover' executable..."
sudo cp backups/clover /usr/local/bin/
sudo chmod +x /usr/local/bin/clover

# Fully replace the library directory
echo "Installing supporting files..."
sudo rm -rf /usr/local/lib/clover
sudo mkdir -p /usr/local/lib/clover
sudo cp -r ./* /usr/local/lib/clover/

# Install the man page from backups/clover.1
if [ -f backups/clover.1 ]; then
    echo "Installing man page..."
    sudo cp backups/clover.1 /usr/local/share/man/man1/
    sudo gzip -f /usr/local/share/man/man1/clover.1
else
    echo "Warning: Man page 'clover.1' not found in backups/"
fi

# Update man database if mandb is available
if command -v mandb &> /dev/null; then
    echo "Updating man page database..."
    sudo mandb
else
    echo "mandb not found, skipping man page database update."
fi

# Clean up
cd /
rm -rf "$TEMP_DIR"

echo ""
echo "Clover installed successfully!"
echo "You can now run it by typing 'clover' and read the manual with 'man clover'"
