@echo off
setlocal
cd /d "%~dp0" || exit /b 1
py -3 -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 (
  py -3 tools\serve.py %*
  goto :done
)
python -c "import sys; sys.exit(sys.version_info < (3, 8))" >nul 2>&1
if not errorlevel 1 (
  python tools\serve.py %*
  goto :done
)
echo Python 3.8 or newer is required: https://www.python.org/downloads/windows/
pause
exit /b 1
:done
if errorlevel 1 (
  pause
  exit /b 1
)
