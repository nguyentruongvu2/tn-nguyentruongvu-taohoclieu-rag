@echo off
REM Batch script to switch Gemini model version on Windows
REM Usage: switch_model.bat

cd /d "%~dp0"
python switch_model.py
if errorlevel 1 (
    echo.
    echo Error: Make sure Python is installed and added to PATH
    pause
)
echo.
pause
