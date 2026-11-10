; Only installed apps follow releases. An unpacked build can carry app-update.yml too.
; Capture the old marker before electron-builder removes the prior installation.
!macro customInit
  Var /GLOBAL storytreeReleaseMarker
  StrCpy $storytreeReleaseMarker "nsis-stable"
  ${if} ${FileExists} "$INSTDIR\resources\storytree-installed"
    FileOpen $0 "$INSTDIR\resources\storytree-installed" r
    FileRead $0 $1
    FileClose $0
    ${if} $1 == "nsis"
      StrCpy $storytreeReleaseMarker "nsis"
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  FileOpen $0 "$INSTDIR\resources\storytree-installed" w
  FileWrite $0 $storytreeReleaseMarker
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

; Is storytree running (4.43, ADR-1296 D4)? electron-builder's own check asks PowerShell, with no time
; limit, for every process under the install folder, and one such query never returned. This one looks
; only for storytree-0.3.exe, in-process, each step bounded (nsProcess's close waits 3 s, then ends it).
; An update's app is quitting itself, so it gets a grace before being closed. At the ceiling an attended
; run offers Retry / Cancel; a silent one gives up with error level 2. Inserted in the install section
; and in the uninstaller's un.checkAppRunning, so its labels are unique within each.
!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    ${ifNot} ${isUpdated}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK storytreeCloseApp
      Quit
    ${endIf}
    storytreeCloseApp:
    DetailPrint "$(appClosing)"
    StrCpy $R1 0
    storytreeWaitApp:
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ${if} $R1 >= 60
          MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "storytree is still running and could not be closed (storytree-0.3.exe).$\r$\n$\r$\nClose it, or end storytree-0.3.exe in Task Manager, then choose Retry. Cancel stops this setup." /SD IDCANCEL IDRETRY storytreeRetryApp
          SetErrorLevel 2
          Quit
          storytreeRetryApp:
          StrCpy $R1 0
        ${endIf}
        ${if} ${isUpdated}
        ${andIf} $R1 < 10
          Sleep 1000
        ${else}
          ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
          Sleep 1000
        ${endIf}
        IntOp $R1 $R1 + 1
        Goto storytreeWaitApp
      ${endIf}
  ${endIf}
  ${nsProcess::Unload}
!macroend

; The first update off a release from before the agents' tool copies (4.46, ADR-1296 D4, option C of
; question_2811ad357110). electron-builder's uninstallOldVersion, patched (patches/app-builder-lib.patch),
; inserts these two macros. The old release's uninstaller runs its own check with no time limit for any
; process under its folder, and a session started before the app re-pointed it may still run that folder's
; agent-tools node.exe. So that node.exe, found by its image path, never by name alone, is stopped first;
; then the old uninstaller runs in a job object with a time limit. At the limit the job (the uninstaller
; and the PowerShell it started) is ended, and this setup carries on over the old files. Stopping a tool
; leaves a record in the storytree home (tools-stopped), from which each session it cut off is told how
; to reconnect (Hooks 3.57).
!define storytreeOldUninstallerLimit 120000

!macro storytreeStopAgentTools DIR
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  Push $8
  Push $9
  ; Long names: a folder given in its 8.3 form never prefixes the image path Windows reports.
  StrCpy $9 "${DIR}\resources\agent-tools\"
  System::Call 'kernel32::GetLongPathNameW(w r9, w .r1, i ${NSIS_MAX_STRLEN}) i .r2'
  ${if} $2 > 0
  ${andIf} $2 < ${NSIS_MAX_STRLEN}
    StrLen $3 $1
    System::Call 'kernel32::CreateToolhelp32Snapshot(i 2, i 0) i .r4'
    ${if} $4 <> -1
      ; PROCESSENTRY32W, as a 32-bit setup sees it.
      System::Call '*(&l4, i, i, i, i, i, i, i, i, &w260) i .r5'
      System::Call 'kernel32::Process32FirstW(i r4, i r5) i .r6'
      ${doWhile} $6 <> 0
        System::Call '*$5(i, i, i .r7, i, i, i, i, i, i, &w260 .r8)'
        ${if} $8 == "node.exe"
          ; PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE
          System::Call 'kernel32::OpenProcess(i 0x101001, i 0, i r7) i .r9'
          ${if} $9 <> 0
            StrCpy $6 ${NSIS_MAX_STRLEN}
            System::Call 'kernel32::QueryFullProcessImageNameW(i r9, i 0, w .r8, *i r6) i .r2'
            ${if} $2 <> 0
              System::Call 'kernel32::GetLongPathNameW(w r8, w .r6, i ${NSIS_MAX_STRLEN}) i .r2'
              ${if} $2 > 0
              ${andIf} $2 < ${NSIS_MAX_STRLEN}
                StrCpy $8 $6
              ${endIf}
              StrCpy $6 $8 $3
              ${if} $6 == $1
                DetailPrint "Stopping storytree's agent tools left running by the old version: $8 (process $7)"
                System::Call 'kernel32::TerminateProcess(i r9, i 1)'
                System::Call 'kernel32::WaitForSingleObject(i r9, i 5000)'
                ; The record that the open sessions' tools were stopped, its time being when (Hooks 3.57 tells them).
                ; The error flag is the caller's, so a record that cannot be written leaves it as it was.
                StrCpy $8 ""
                IfErrors 0 +2
                StrCpy $8 "set"
                ReadEnvStr $2 STORYTREE_HOME
                ${if} $2 == ""
                  StrCpy $2 "$PROFILE\.storytree\0.3"
                ${endIf}
                CreateDirectory $2
                FileOpen $6 "$2\tools-stopped" w
                FileWrite $6 "storytree's agent tools were stopped by an update$\r$\n"
                FileClose $6
                ClearErrors
                ${if} $8 == "set"
                  SetErrors
                ${endIf}
              ${endIf}
            ${endIf}
            System::Call 'kernel32::CloseHandle(i r9)'
          ${endIf}
        ${endIf}
        System::Call 'kernel32::Process32NextW(i r4, i r5) i .r6'
      ${loop}
      System::Free $5
      System::Call 'kernel32::CloseHandle(i r4)'
    ${endIf}
  ${endIf}
  Pop $9
  Pop $8
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
!macroend

; Runs COMMAND as ExecWait does, its exit code in $R0 and the error flag set when it cannot start, but
; within storytreeOldUninstallerLimit. At the limit it ends the job, stops DIR's agent tools again and
; leaves $R0 at 0, so uninstallOldVersion carries on without a retry or a message box.
!macro storytreeExecBounded COMMAND DIR
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  Push $7
  StrCpy $5 '${COMMAND}'
  StrCpy $7 ""
  System::Call 'kernel32::CreateJobObjectW(i 0, i 0) i .r1'
  ; STARTUPINFOW and PROCESS_INFORMATION, zeroed.
  System::Call '*(&l4, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, &i2 0, &i2 0, i 0, i 0, i 0, i 0) i .r2'
  System::Call '*(i 0, i 0, i 0, i 0) i .r3'
  ; CREATE_SUSPENDED, so it is in the job before it can start anything.
  System::Call 'kernel32::CreateProcessW(i 0, w r5, i 0, i 0, i 0, i 4, i 0, i 0, i r2, i r3) i .r4'
  ${if} $4 = 0
    StrCpy $7 "failed"
  ${else}
    System::Call '*$3(i .r4, i .r6)'
    ${if} $1 <> 0
      System::Call 'kernel32::AssignProcessToJobObject(i r1, i r4)'
    ${endIf}
    System::Call 'kernel32::ResumeThread(i r6)'
    System::Call 'kernel32::CloseHandle(i r6)'
    System::Call 'kernel32::WaitForSingleObject(i r4, i ${storytreeOldUninstallerLimit}) i .r6'
    ${if} $6 = 258
      ${if} $1 <> 0
        System::Call 'kernel32::TerminateJobObject(i r1, i 1)'
      ${endIf}
      System::Call 'kernel32::TerminateProcess(i r4, i 1)'
      System::Call 'kernel32::WaitForSingleObject(i r4, i 5000)'
      DetailPrint "The old version's uninstaller did not finish in time and was stopped; installing over its files"
      !insertmacro storytreeStopAgentTools "${DIR}"
      StrCpy $R0 0
    ${else}
      System::Call 'kernel32::GetExitCodeProcess(i r4, *i .r6)'
      StrCpy $R0 $6
    ${endIf}
    System::Call 'kernel32::CloseHandle(i r4)'
  ${endIf}
  System::Free $2
  System::Free $3
  ${if} $1 <> 0
    System::Call 'kernel32::CloseHandle(i r1)'
  ${endIf}
  ${if} $7 == "failed"
    SetErrors
  ${endIf}
  Pop $7
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
!macroend
