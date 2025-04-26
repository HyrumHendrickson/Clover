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
      [ -d "~/clover_files" ] || mkdir -p "~/clover_files"
      echo "${tokens[2]}" > ~/clover_files/"${tokens[1]}"
      echo "saved"
      ;;

    list)
		for file in ~/clover_files/*; do
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
