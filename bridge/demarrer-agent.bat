@echo off
rem Agent Forexia : relie le MetaTrader 5 de ce PC a la page admin (lecture seule). Laisser cette fenetre ouverte.
cd /d "%~dp0"
set PY=python
where py >nul 2>nul && set PY=py -3
%PY% -c "import MetaTrader5" >nul 2>nul
if errorlevel 1 (
  echo Installation du module MetaTrader5...
  %PY% -m pip install --user --upgrade MetaTrader5
)
:boucle
%PY% forexia_agent.py %*
if errorlevel 1 (
  echo.
  echo L'agent s'est arrete. Nouvelle tentative dans 60 secondes ^(fermez la fenetre pour annuler^).
  echo Si Python est introuvable : installez-le depuis https://www.python.org/downloads/ en cochant "Add python.exe to PATH".
  timeout /t 60 >nul
  goto boucle
)
pause
