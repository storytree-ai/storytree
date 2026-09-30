; Only installed apps follow releases. An unpacked build can carry app-update.yml too.
!macro customInstall
  FileOpen $0 "$INSTDIR\resources\storytree-installed" w
  FileWrite $0 "nsis"
  FileClose $0
!macroend

; Leaving storytree (app setup 1.8). The bundled helper removes what the app added outside its own
; folder: agent connections and hooks, the command and its PATH entry, the home, the update cache.
; An update runs this uninstaller with --updated and must remove nothing. The one-click uninstall
; section runs silently, so the library question is asked here, while the user's run is known.
!macro customUnInit
  Var /GLOBAL storytreeLibrary
  Var /GLOBAL storytreeAttended
  StrCpy $storytreeLibrary "keep"
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/S" $R1
  ${if} ${Errors}
    StrCpy $storytreeAttended "yes"
  ${else}
    StrCpy $storytreeAttended "no"
  ${endIf}
  ${ifNot} ${isUpdated}
  ${andIf} ${FileExists} "$INSTDIR\resources\agent-tools\storytree-deliver.mjs"
    ClearErrors
    ${GetOptions} $R0 "--remove-library" $R1
    ${ifNot} ${Errors}
      StrCpy $storytreeLibrary "remove"
    ${else}
      ClearErrors
      ${GetOptions} $R0 "--keep-library" $R1
      ${if} ${Errors}
        nsExec::Exec `"$INSTDIR\resources\agent-tools\node.exe" "$INSTDIR\resources\agent-tools\storytree-deliver.mjs" uninstall-asks "$INSTDIR"`
        Pop $R2
        ${if} $R2 == 10
          StrCpy $storytreeLibrary "remove"
        ${elseIf} $R2 == 0
        ${andIf} $storytreeAttended == "yes"
          ; Unattended (/S) without a choice keeps the library: nothing is lost that was not asked about.
          MessageBox MB_YESNO|MB_ICONQUESTION "Keep your storytree library on this computer?$\r$\n$\r$\nYour library holds your projects' plans and notes. Yes keeps it, so reinstalling storytree finds it again. No deletes it.$\r$\n$\r$\nYour project folders and their files are not touched either way." IDYES +2
          StrCpy $storytreeLibrary "remove"
        ${endIf}
      ${endIf}
    ${endIf}
  ${endIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
  ${andIf} ${FileExists} "$INSTDIR\resources\agent-tools\storytree-deliver.mjs"
    DetailPrint "Removing storytree's agent connections, command and home"
    nsExec::ExecToStack `"$INSTDIR\resources\agent-tools\node.exe" "$INSTDIR\resources\agent-tools\storytree-deliver.mjs" uninstall "$INSTDIR" $storytreeLibrary`
    Pop $R2
    Pop $R3
    DetailPrint $R3
    ; The one-click section runs silently, so only a message box without /SD reaches an attending user.
    ; The app registered itself to open at sign-in (lifecycle 1.12); leaving storytree removes that too.
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "storytree 0.3"
    ${if} $R2 != 0
    ${andIf} $storytreeAttended == "yes"
      MessageBox MB_OK|MB_ICONEXCLAMATION "storytree is uninstalled, but something it added is still there:$\r$\n$\r$\n$R3"
    ${endIf}
  ${endIf}
!macroend
