@echo off
chcp 65001 >nul
rem 이 파일이 있는 폴더(프로젝트 폴더)로 이동
cd /d "%~dp0"
echo ==================================================
echo  스윙픽서 앱을 시작합니다.
echo  브라우저가 자동으로 열립니다. (http://localhost:3000)
echo  끄려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo ==================================================
if not exist node_modules (
  echo 처음 한 번만 필요한 설치를 합니다. 몇 분 걸릴 수 있습니다...
  call npm install
)
start "" /min cmd /c "timeout /t 4 /nobreak >nul & start http://localhost:3000"
call npm run dev
pause
