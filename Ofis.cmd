@echo off
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (start "" /min cmd /c node electron\run.mjs) else (start "" /min cmd /c node launcher.mjs)
