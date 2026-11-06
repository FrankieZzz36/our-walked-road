@echo off
setlocal
cd /d "%~dp0"

set "PYW=D:\anaconda\pythonw.exe"
if not exist "%PYW%" set "PYW=D:\anaconda\python.exe"
if not exist "%PYW%" (
    echo [StarSea] Anaconda Python not found: D:\anaconda\pythonw.exe
    pause
    exit /b 1
)

start "" "%PYW%" "%~dp0app.py"
exit /b 0