@echo off
rem Un Momento Rolled - abre la caja en pantalla completa e imprime el ticket directo,
rem sin la ventana de impresion. Antes: pon la impresora termica como "predeterminada" en Windows.
set URL=https://elianmendezsena.github.io/unmomentorolled/
set CHROME=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set CHROME=%LocalAppData%\Google\Chrome\Application\chrome.exe
if "%CHROME%"=="" (
  echo No encontre Google Chrome. Instalalo y vuelve a abrir este archivo.
  pause
  exit /b 1
)
start "" "%CHROME%" --kiosk-printing --app=%URL%
