@echo off
rem Lance la passerelle Forexia <-> MetaTrader 5 (laisser cette fenetre ouverte)
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% -c "import MetaTrader5" >nul 2>nul
if errorlevel 1 (
  echo Installation du module MetaTrader5 ^(donnees du courtier^)...
  %PY% -m pip install --user --upgrade MetaTrader5
)
%PY% forexia_bridge.py
if errorlevel 1 (
  echo.
  echo Si Python est introuvable : installez-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH".
)
pause
