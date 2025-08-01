run_command() {
  local input="$1"

  
  read -a tokens <<< "$input"

  case "${tokens[0]}" in
  
    help)
      echo "List of commands:
-help                    Show this help message
-test                    Test basic functionality
-save <name> <value>     Save a variable
-list                    List all saved variables
-start                   Show startup logo
-clear                   Clear screen
-update                  Update Clover
-api <method> <url>      Make API call (GET/POST/PUT/DELETE)
-apipost <url> <data>    POST request with JSON data
-apiheader <header>      Set API header (format: 'Key: Value')
-clearheaders            Clear all custom headers
-showheaders             Show current headers
-csvinfo <file>          Show CSV file information
-csvhead <file> [n]      Show first n rows of CSV (default: 5)
-csvtail <file> [n]      Show last n rows of CSV (default: 5)
-csvfilter <file> <col> <value>  Filter CSV by column value
-jsoninfo <file>         Show JSON file information
-jsonkeys <file>         Show JSON keys
-jsonget <file> <path>   Get value from JSON path (e.g., .user.name)
-csv2json <csvfile>      Convert CSV to JSON
-json2csv <jsonfile>     Convert JSON to CSV
-shell                   Drop to shell
-exit                    Exit Clover
-quit                    Exit Clover"
      ;;
      
    test)
      echo "Testing dependencies..."
      command -v curl >/dev/null 2>&1 && echo "✓ curl available" || echo "✗ curl missing"
      command -v jq >/dev/null 2>&1 && echo "✓ jq available" || echo "✗ jq missing"
      command -v awk >/dev/null 2>&1 && echo "✓ awk available" || echo "✗ awk missing"
      echo "Basic test: ok"
      ;;
      
    save)
      if [ ${#tokens[@]} -lt 3 ]; then
        echo "Usage: save <name> <value>"
        return 1
      fi
      [ -d "$HOME/.clover_files" ] || mkdir -p "$HOME/.clover_files"
      echo "${tokens[2]}" > ~/.clover_files/"${tokens[1]}"
      echo "Saved '${tokens[1]}' = '${tokens[2]}'"
      ;;

    list)
      [ -d "$HOME/.clover_files" ] || mkdir -p "$HOME/.clover_files"
      if [ "$(find $HOME/.clover_files -mindepth 1 | head -n 1)" ]; then
        for file in $HOME/.clover_files/*; do
          echo -n "$(basename "$file"): "
          cat "$file"
        done
      else
        echo "No saved variables"
      fi
      ;;
      
    start)
      cat assets/logo.txt
      ;;

    clear)
      clear
      ;;

    update)
      source scripts/update.sh
      ;;

    # API Commands
    apiheader)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: apiheader 'Header-Name: Header-Value'"
        return 1
      fi
      [ -d "$HOME/.clover_files" ] || mkdir -p "$HOME/.clover_files"
      shift
      echo "$*" >> ~/.clover_files/.api_headers
      echo "Header added: $*"
      ;;

    clearheaders)
      [ -f ~/.clover_files/.api_headers ] && rm ~/.clover_files/.api_headers
      echo "API headers cleared"
      ;;

    showheaders)
      if [ -f ~/.clover_files/.api_headers ]; then
        echo "Current API headers:"
        cat ~/.clover_files/.api_headers
      else
        echo "No custom headers set"
      fi
      ;;

    api)
      if [ ${#tokens[@]} -lt 3 ]; then
        echo "Usage: api <GET|POST|PUT|DELETE> <url>"
        return 1
      fi
      
      local method="${tokens[1]^^}"
      local url="${tokens[2]}"
      local headers_file="$HOME/.clover_files/.api_headers"
      local curl_cmd="curl -s -X $method"
      
      # Add custom headers if they exist
      if [ -f "$headers_file" ]; then
        while IFS= read -r header; do
          curl_cmd="$curl_cmd -H '$header'"
        done < "$headers_file"
      fi
      
      curl_cmd="$curl_cmd '$url'"
      
      echo "Making $method request to: $url"
      eval $curl_cmd | jq . 2>/dev/null || eval $curl_cmd
      ;;

    apipost)
      if [ ${#tokens[@]} -lt 3 ]; then
        echo "Usage: apipost <url> <json_data>"
        return 1
      fi
      
      local url="${tokens[2]}"
      local data="${tokens[3]}"
      local headers_file="$HOME/.clover_files/.api_headers"
      local curl_cmd="curl -s -X POST -H 'Content-Type: application/json'"
      
      # Add custom headers if they exist
      if [ -f "$headers_file" ]; then
        while IFS= read -r header; do
          curl_cmd="$curl_cmd -H '$header'"
        done < "$headers_file"
      fi
      
      curl_cmd="$curl_cmd -d '$data' '$url'"
      
      echo "Making POST request to: $url"
      eval $curl_cmd | jq . 2>/dev/null || eval $curl_cmd
      ;;

    # CSV Commands
    csvinfo)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: csvinfo <file>"
        return 1
      fi
      
      local file="${tokens[1]}"
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "CSV File: $file"
      echo "Lines: $(wc -l < "$file")"
      echo "Columns: $(head -1 "$file" | tr ',' '\n' | wc -l)"
      echo "Headers:"
      head -1 "$file" | tr ',' '\n' | nl
      ;;

    csvhead)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: csvhead <file> [rows]"
        return 1
      fi
      
      local file="${tokens[1]}"
      local rows="${tokens[2]:-5}"
      
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "First $rows rows of $file:"
      head -n $rows "$file" | column -t -s ','
      ;;

    csvtail)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: csvtail <file> [rows]"
        return 1
      fi
      
      local file="${tokens[1]}"
      local rows="${tokens[2]:-5}"
      
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "Last $rows rows of $file:"
      tail -n $rows "$file" | column -t -s ','
      ;;

    csvfilter)
      if [ ${#tokens[@]} -lt 4 ]; then
        echo "Usage: csvfilter <file> <column_number> <value>"
        return 1
      fi
      
      local file="${tokens[1]}"
      local col="${tokens[2]}"
      local value="${tokens[3]}"
      
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "Filtering $file where column $col contains '$value':"
      head -1 "$file"  # Show header
      awk -F',' -v col="$col" -v val="$value" 'NR>1 && $col ~ val' "$file"
      ;;

    # JSON Commands
    jsoninfo)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: jsoninfo <file>"
        return 1
      fi
      
      local file="${tokens[1]}"
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "JSON File: $file"
      echo "Size: $(wc -c < "$file") bytes"
      echo "Valid JSON: $(jq empty < "$file" 2>/dev/null && echo "Yes" || echo "No")"
      echo "Type: $(jq -r 'type' < "$file" 2>/dev/null || echo "Invalid")"
      ;;

    jsonkeys)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: jsonkeys <file>"
        return 1
      fi
      
      local file="${tokens[1]}"
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      echo "Keys in $file:"
      jq -r 'keys[]' "$file" 2>/dev/null || echo "Cannot extract keys (not an object or invalid JSON)"
      ;;

    jsonget)
      if [ ${#tokens[@]} -lt 3 ]; then
        echo "Usage: jsonget <file> <path>"
        echo "Example: jsonget data.json .user.name"
        return 1
      fi
      
      local file="${tokens[1]}"
      local path="${tokens[2]}"
      
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      jq -r "$path" "$file" 2>/dev/null || echo "Invalid path or JSON"
      ;;

    # Conversion Commands
    csv2json)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: csv2json <csvfile>"
        return 1
      fi
      
      local file="${tokens[1]}"
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      local output="${file%.csv}.json"
      
      # Simple CSV to JSON conversion
      awk -F',' '
      NR==1 {
        for(i=1; i<=NF; i++) headers[i] = $i
        print "["
        next
      }
      NR>2 { print "," }
      {
        printf "{"
        for(i=1; i<=NF; i++) {
          if(i>1) printf ","
          printf "\"%s\":\"%s\"", headers[i], $i
        }
        printf "}"
      }
      END { print "\n]" }
      ' "$file" > "$output"
      
      echo "Converted $file to $output"
      ;;

    json2csv)
      if [ ${#tokens[@]} -lt 2 ]; then
        echo "Usage: json2csv <jsonfile>"
        return 1
      fi
      
      local file="${tokens[1]}"
      if [ ! -f "$file" ]; then
        echo "File not found: $file"
        return 1
      fi
      
      local output="${file%.json}.csv"
      
      # Convert JSON array to CSV
      if jq -e 'type == "array"' "$file" >/dev/null 2>&1; then
        jq -r '(.[0] | keys_unsorted) as $keys | $keys, (.[] as $item | $keys | map($item[.])) | @csv' "$file" > "$output"
        echo "Converted $file to $output"
      else
        echo "JSON file must contain an array of objects for CSV conversion"
        return 1
      fi
      ;;

    shell)
      echo "Dropping to shell (type 'exit' to return to Clover)"
      bash
      ;;
      
    *)
      echo "Unknown command: $input"
      echo "Type 'help' for available commands"
      ;;
  esac
}
