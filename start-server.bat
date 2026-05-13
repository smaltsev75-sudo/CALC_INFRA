@echo off
REM ============================================================
REM Infrastructure Calculator - local HTTP server launcher
REM ============================================================

cd /d "%~dp0"

setlocal
set "PORT=8000"
set "URL=http://localhost:%PORT%"

echo.
echo === Infrastructure Calculator ===
echo Starting local HTTP server at %URL%
echo Working directory: %CD%
echo Press Ctrl+C to stop.
echo.

where python >/dev/null 2>/dev/null
if %ERRORLEVEL% equ 0 (
    echo Found Python. Starting http.server on port %PORT%...
    start "" %URL%
    python -m http.server %PORT%
    goto :end
)

where py >/dev/null 2>/dev/null
if %ERRORLEVEL% equ 0 (
    echo Found Python ^(py launcher^). Starting http.server on port %PORT%...
    start "" %URL%
    py -3 -m http.server %PORT%
    goto :end
)

where node >/dev/null 2>/dev/null
if %ERRORLEVEL% equ 0 (
    echo Found Node.js. Starting http-server on port %PORT% via npx...
    start "" %URL%
    npx --yes http-server -p %PORT% -c-1
    goto :end
)

echo.
echo ERROR: Neither Python nor Node.js found in PATH.
echo Install one of them:
echo   - Python:  https://www.python.org/downloads/
echo   - Node.js: https://nodejs.org/
echo.
pause

:end
endlocal
