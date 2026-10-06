; Extra installer steps for electron-builder's NSIS template.
!include LogicLib.nsh

!macro customInstall
  DetailPrint "Downloading local AI models (about 650 MB)..."
  MessageBox MB_OK|MB_ICONINFORMATION "Portfolio Analyzer will now download its local AI models (about 650 MB).$\r$\n$\r$\nA progress window will open. Depending on your connection this can take several minutes. Please keep the window open until it finishes." /SD IDOK
  ExecWait '"$INSTDIR\resources\backend\pa-backend\pa-backend.exe" --download-models --data-dir "$LOCALAPPDATA\PortfolioAnalyzer"' $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Some AI models could not be downloaded. The app still works, using built-in estimates instead.$\r$\n$\r$\nYou can retry any time from: Start menu > Portfolio Analyzer - Download AI models." /SD IDOK
  ${EndIf}
  CreateShortCut "$SMPROGRAMS\Portfolio Analyzer - Download AI models.lnk" "$INSTDIR\resources\backend\pa-backend\pa-backend.exe" '--download-models --pause --data-dir "$LOCALAPPDATA\PortfolioAnalyzer"' "$INSTDIR\resources\backend\pa-backend\pa-backend.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMPROGRAMS\Portfolio Analyzer - Download AI models.lnk"
  ; Licence records and data in %LOCALAPPDATA%\PortfolioAnalyzer are deliberately kept, so
  ; reinstalling does not reset a licence. To remove everything, delete that folder manually.
!macroend
