@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist runtime\node.exe goto run
echo Lan dau chay: dang tai Node.js, khoang 85 MB, cho 1-2 phut. Dung tat cua so nay.
curl.exe -L --fail -o runtime\node.tmp https://nodejs.org/dist/latest-v22.x/win-x64/node.exe
if errorlevel 1 goto fail
move /y runtime\node.tmp runtime\node.exe >nul
:run
title IT GOT TALENT - Binh chon DUNG THAT
:loop
runtime\node.exe --disable-warning=ExperimentalWarning server\index.js --tunnel --ask --open
echo.
echo May chu da dung hoac bi loi. Se khoi dong lai sau 5 giay. Dong cua so nay de thoat.
timeout /t 5 >nul
goto loop

:fail
del runtime\node.tmp 2>nul
echo.
echo LOI: khong tai duoc Node.js. Kiem tra Internet roi chay lai.
pause
exit /b 1
