run_command() {
  local input="$1"

  
  read -a tokens <<< "$input"

  case "${tokens[0]}" in
  
    help)
      echo "List of commands:
-help
-test
-save
-list
-start
-clear
-update
-exit
-quit"
      ;;
      
    test)
      echo "ok"
      ;;
      
    save)
      sudo echo "${tokens[2]}" > data/env_vars/"${tokens[1]}"
      echo "saved"
      ;;

    list)
		for file in data/env_vars/*; do
		  echo -n "$(basename "$file"): "
		  cat "$file"
		done
		
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
      
    *)
      echo "Unknown command: $input"
      ;;
  esac
}
