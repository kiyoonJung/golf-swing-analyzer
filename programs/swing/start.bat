@echo off
chcp 65001 >nul
rem 이 파일이 있는 폴더(프로젝트 폴더)로 이동
cd /d "%~dp0"
echo ==================================================
echo  골프 스윙 분석 서버를 시작합니다.
echo  브라우저가 자동으로 열립니다. (http://localhost:8010)
echo  끄려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo ==================================================
rem 서버가 켜질 시간을 2초 준 뒤 브라우저를 연다 (별도 창에서 실행)
start "" /min cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:8010"
rem python 이 있으면 python, 없으면 py 런처로 서버 실행
where python >nul 2>nul && (python serve.py 8010) || (py serve.py 8010)
echo.
echo 서버가 종료되었습니다. 오류가 보인다면 이미 서버가 켜져 있거나 Python 이 설치되지 않은 경우입니다.
pause
