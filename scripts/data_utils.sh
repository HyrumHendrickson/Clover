#!/bin/bash

# Data utility functions for Clover

# Check if required dependencies are available
check_dependencies() {
    local missing=()
    
    command -v curl >/dev/null 2>&1 || missing+=("curl")
    command -v jq >/dev/null 2>&1 || missing+=("jq")
    command -v awk >/dev/null 2>&1 || missing+=("awk")
    
    if [ ${#missing[@]} -gt 0 ]; then
        echo "Warning: Missing dependencies: ${missing[*]}"
        echo "Install with: sudo apt-get install ${missing[*]} (Ubuntu/Debian)"
        echo "             sudo yum install ${missing[*]} (CentOS/RHEL)"
        return 1
    fi
    return 0
}

# Validate JSON file
validate_json() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
    fi
    
    if ! jq empty < "$file" 2>/dev/null; then
        echo "Invalid JSON file: $file"
        return 1
    fi
    return 0
}

# Validate CSV file (basic check)
validate_csv() {
    local file="$1"
    if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
    fi
    
    # Check if file has at least one line
    if [ ! -s "$file" ]; then
        echo "Empty CSV file: $file"
        return 1
    fi
    return 0
}

# Format API response for better readability
format_api_response() {
    local response="$1"
    
    # Try to format as JSON first
    if echo "$response" | jq . >/dev/null 2>&1; then
        echo "$response" | jq .
    else
        # If not JSON, return as-is
        echo "$response"
    fi
}

# Save API response to file
save_api_response() {
    local response="$1"
    local filename="$2"
    
    if [ -z "$filename" ]; then
        filename="api_response_$(date +%Y%m%d_%H%M%S).json"
    fi
    
    echo "$response" > "$filename"
    echo "Response saved to: $filename"
}

# Extract specific fields from CSV
csv_extract_column() {
    local file="$1"
    local column="$2"
    
    if ! validate_csv "$file"; then
        return 1
    fi
    
    cut -d',' -f"$column" "$file"
}

# Count unique values in CSV column
csv_count_unique() {
    local file="$1"
    local column="$2"
    
    if ! validate_csv "$file"; then
        return 1
    fi
    
    cut -d',' -f"$column" "$file" | tail -n +2 | sort | uniq -c | sort -nr
}

# Simple CSV statistics
csv_stats() {
    local file="$1"
    local column="$2"
    
    if ! validate_csv "$file"; then
        return 1
    fi
    
    echo "Statistics for column $column in $file:"
    local values=$(cut -d',' -f"$column" "$file" | tail -n +2 | grep -E '^[0-9]+\.?[0-9]*$')
    
    if [ -n "$values" ]; then
        echo "Count: $(echo "$values" | wc -l)"
        echo "Sum: $(echo "$values" | awk '{sum+=$1} END {print sum}')"
        echo "Average: $(echo "$values" | awk '{sum+=$1} END {print sum/NR}')"
        echo "Min: $(echo "$values" | sort -n | head -1)"
        echo "Max: $(echo "$values" | sort -n | tail -1)"
    else
        echo "No numeric values found in column $column"
    fi
}
