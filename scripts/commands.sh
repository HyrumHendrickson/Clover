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
-shell
-exit
-quit"
      ;;
      
    test)
      echo "ok"
      ;;
      
    save)
      [ -d "$HOME/.clover_files" ] || mkdir -p "$HOME/.clover_files"
      echo "${tokens[2]}" > ~/.clover_files/"${tokens[1]}"
      echo "saved"
      ;;

    list)
        [ -d "$HOME/.clover_files" ] || mkdir -p "$HOME/.clover_files"


        if [ "$(find $HOME/.clover_files -mindepth 1 | head -n 1)" ]; then
            for file in $HOME/clover_files/*; do
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
      
    *)
      echo "Unknown command: $input"
      ;;
  esac
}
