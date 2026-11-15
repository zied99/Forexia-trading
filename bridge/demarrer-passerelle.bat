@echo off
rem Lance la passerelle Forexia <-> MetaTrader 5 (laisser cette fenetre ouverte)
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 forexia_bridge.py
) else (
  python forexia_bridge.py
)
if errorlevel 1 (
  echo.
  echo Si Python est introuvable : installez-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH".
)
pause
