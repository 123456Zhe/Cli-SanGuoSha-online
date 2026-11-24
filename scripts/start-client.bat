@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "SG_EXE=clisanguo-lite-windows-x64.exe"
if not exist "%SG_EXE%" (
  echo 未找到 %SG_EXE%，请确认它和本脚本在同一个文件夹里（重新解压发布包）。
  pause
  exit /b 1
)
set "SG_HOST="
set "SG_PORT="
set "SG_NAME="
set /p SG_HOST=请输入房主 IP: 
set /p SG_PORT=请输入端口（直接回车使用 9527）:
if "%SG_PORT%"=="" set "SG_PORT=9527"
set /p SG_NAME=请输入你的名字: 
"%SG_EXE%" -host="%SG_HOST%" -port=%SG_PORT% -name="%SG_NAME%"
pause
