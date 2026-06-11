@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Portal Costa Junior - PUBLICAR (enviar para o GitHub)
echo  Isso aciona o deploy automatico na Vercel.
echo ============================================================
echo.
echo Commit atual:
git log -1 --oneline
echo.
echo Enviando para o GitHub (branch main)...
git push origin main > publicar-resultado.log 2>&1
type publicar-resultado.log
echo.
echo ============================================================
echo  Se aparecer "main -^> main" acima, o envio deu certo e a
echo  Vercel vai publicar em 1-2 minutos.
echo  Se pedir login do GitHub, faca o login que aparecer.
echo ============================================================
pause
