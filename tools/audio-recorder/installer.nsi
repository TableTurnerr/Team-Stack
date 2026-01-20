; Audio Recorder Installer Script
; Built with NSIS (Nullsoft Scriptable Install System)
; Requires: NSIS 3.x with NSISdl and nsDialogs plugins (included by default)

;--------------------------------
; Includes

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

;--------------------------------
; General Configuration

!define PRODUCT_NAME "Audio Recorder"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_PUBLISHER "TableaTurnerr"
!define PRODUCT_WEB_SITE "https://github.com/TableTurnerr/Team-Stack"
!define PRODUCT_DIR_REGKEY "Software\Microsoft\Windows\CurrentVersion\App Paths\AudioRecorder.exe"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"
!define PRODUCT_UNINST_ROOT_KEY "HKLM"

; VC++ Redistributable download URL
!define VCREDIST_URL "https://aka.ms/vs/17/release/vc_redist.x64.exe"
!define VCREDIST_FILE "vc_redist.x64.exe"

; Installer attributes
Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "dist\AudioRecorder_Setup.exe"
InstallDir "$PROGRAMFILES64\AudioRecorder"
InstallDirRegKey HKLM "${PRODUCT_DIR_REGKEY}" ""
ShowInstDetails show
ShowUnInstDetails show
RequestExecutionLevel admin

;--------------------------------
; MUI Settings

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

; Welcome page
!define MUI_WELCOMEPAGE_TITLE "Welcome to ${PRODUCT_NAME} Setup"
!define MUI_WELCOMEPAGE_TEXT "This wizard will guide you through the installation of ${PRODUCT_NAME}.$\r$\n$\r$\nThe installer will automatically download and install Visual C++ Redistributable if needed.$\r$\n$\r$\nClick Next to continue."

; Finish page
!define MUI_FINISHPAGE_RUN "$INSTDIR\AudioRecorder.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${PRODUCT_NAME}"

;--------------------------------
; Installer Pages

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

;--------------------------------
; Uninstaller Pages

!insertmacro MUI_UNPAGE_WELCOME
UninstPage custom un.DeleteRecordingsPage un.DeleteRecordingsPageLeave
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

;--------------------------------
; Language

!insertmacro MUI_LANGUAGE "English"

;--------------------------------
; Variables

Var DeleteRecordingsCheckbox
Var DeleteRecordings

;--------------------------------
; Installer Sections

Section "Main Application" SEC01
    SetOutPath "$INSTDIR"
    SetOverwrite on
    
    ; Copy main executable
    File "dist\AudioRecorder.exe"
    
    ; Create recordings folder
    CreateDirectory "$INSTDIR\recordings"
    
    ; Create Start Menu shortcuts
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk" "$INSTDIR\AudioRecorder.exe"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk" "$INSTDIR\uninstall.exe"
    
    ; Create Desktop shortcut
    CreateShortCut "$DESKTOP\${PRODUCT_NAME}.lnk" "$INSTDIR\AudioRecorder.exe"
SectionEnd

Section "Visual C++ Redistributable" SEC02
    ; Check if VC++ Redistributable is already installed
    ; This checks for VS 2015-2022 x64 runtime
    ReadRegDword $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
    ${If} $0 == 1
        DetailPrint "Visual C++ Redistributable is already installed."
    ${Else}
        ; Download VC++ Redistributable
        DetailPrint "Downloading Visual C++ Redistributable..."
        SetOutPath "$TEMP"
        
        NSISdl::download /TIMEOUT=60000 "${VCREDIST_URL}" "$TEMP\${VCREDIST_FILE}"
        Pop $0
        
        ${If} $0 == "success"
            DetailPrint "Download complete. Installing Visual C++ Redistributable..."
            
            ; Run silent installation
            ExecWait '"$TEMP\${VCREDIST_FILE}" /install /quiet /norestart' $1
            
            ${If} $1 == 0
                DetailPrint "Visual C++ Redistributable installed successfully."
            ${ElseIf} $1 == 1638
                DetailPrint "Visual C++ Redistributable is already installed (newer version)."
            ${ElseIf} $1 == 3010
                DetailPrint "Visual C++ Redistributable installed. A restart may be required."
            ${Else}
                DetailPrint "Visual C++ Redistributable installation returned code: $1"
            ${EndIf}
            
            ; Clean up downloaded file
            Delete "$TEMP\${VCREDIST_FILE}"
        ${Else}
            DetailPrint "Download failed: $0"
            MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to download Visual C++ Redistributable.$\r$\n$\r$\nPlease install it manually from:$\r$\nhttps://aka.ms/vs/17/release/vc_redist.x64.exe$\r$\n$\r$\nThe application may not work without it."
        ${EndIf}
    ${EndIf}
SectionEnd

Section -Post
    ; Write uninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"
    
    ; Write registry keys for Add/Remove Programs
    WriteRegStr HKLM "${PRODUCT_DIR_REGKEY}" "" "$INSTDIR\AudioRecorder.exe"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayName" "$(^Name)"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayIcon" "$INSTDIR\AudioRecorder.exe"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
    WriteRegStr ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
    
    ; Calculate installed size
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"
SectionEnd

;--------------------------------
; Uninstaller Custom Page - Delete Recordings Option

Function un.DeleteRecordingsPage
    !insertmacro MUI_HEADER_TEXT "Recordings" "Choose whether to delete your recordings."
    
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
        Abort
    ${EndIf}
    
    ${NSD_CreateLabel} 0 0 100% 24u "The uninstaller found a recordings folder. Would you like to remove it?"
    Pop $0
    
    ${NSD_CreateCheckbox} 0 40u 100% 12u "Delete recordings (moves to Recycle Bin)"
    Pop $DeleteRecordingsCheckbox
    ${NSD_SetState} $DeleteRecordingsCheckbox ${BST_UNCHECKED}
    
    ${NSD_CreateLabel} 0 60u 100% 36u "Note: If checked, recordings will be moved to the Recycle Bin,$\r$\nnot permanently deleted. You can restore them if needed."
    Pop $0
    
    nsDialogs::Show
FunctionEnd

Function un.DeleteRecordingsPageLeave
    ${NSD_GetState} $DeleteRecordingsCheckbox $DeleteRecordings
FunctionEnd

;--------------------------------
; Uninstaller Section

Section Uninstall
    ; Remove shortcuts
    Delete "$DESKTOP\${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\${PRODUCT_NAME}.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall.lnk"
    RMDir "$SMPROGRAMS\${PRODUCT_NAME}"
    
    ; Remove main executable and config
    Delete "$INSTDIR\AudioRecorder.exe"
    Delete "$INSTDIR\config.json"
    Delete "$INSTDIR\uninstall.exe"
    
    ; Handle recordings folder based on user choice
    ${If} $DeleteRecordings == ${BST_CHECKED}
        ; Move recordings to Recycle Bin using SHFileOperation
        ; FOF_ALLOWUNDO (0x40) ensures files go to Recycle Bin
        ; FOF_NOCONFIRMATION (0x10) suppresses confirmation dialogs
        ; FOF_SILENT (0x4) suppresses progress dialog
        ; FO_DELETE = 3
        
        ; Prepare the path (must be double-null terminated)
        StrCpy $0 "$INSTDIR\recordings"
        
        ; Use System plugin to call SHFileOperation
        System::Call 'shell32::SHFileOperationW(t r0, i 3, t r0, t "", i 0x54, *i .r1, t "") i .r2'
        
        ${If} $2 == 0
            DetailPrint "Recordings moved to Recycle Bin."
        ${Else}
            DetailPrint "Could not move recordings to Recycle Bin. Leaving folder intact."
        ${EndIf}
    ${Else}
        DetailPrint "Recordings folder preserved at: $INSTDIR\recordings"
    ${EndIf}
    
    ; Remove installation directory (only if empty or recordings were deleted)
    RMDir "$INSTDIR\recordings"
    RMDir "$INSTDIR"
    
    ; Remove registry keys
    DeleteRegKey ${PRODUCT_UNINST_ROOT_KEY} "${PRODUCT_UNINST_KEY}"
    DeleteRegKey HKLM "${PRODUCT_DIR_REGKEY}"
    
    SetAutoClose true
SectionEnd

;--------------------------------
; Section Descriptions

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SEC01} "Install the main Audio Recorder application."
    !insertmacro MUI_DESCRIPTION_TEXT ${SEC02} "Download and install Visual C++ Redistributable (required)."
!insertmacro MUI_FUNCTION_DESCRIPTION_END
