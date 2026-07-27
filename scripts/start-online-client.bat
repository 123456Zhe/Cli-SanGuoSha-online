@echo off
chcp 65001 >nul
set /p SG_HOST=请输入房主 IP: 
set /p SG_PORT=请输入端口（直接回车使用 9527）: 
if "%SG_PORT%"=="" set SG_PORT=9527
set /p SG_NAME=请输入你的名字: 
clisanguo-lite-windows-x64.exe --host=%SG_HOST% --port=%SG_PORT% --name=%SG_NAME%
pause
