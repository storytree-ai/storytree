; Only installed apps follow releases. An unpacked build can carry app-update.yml too.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\storytree-installed" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend
