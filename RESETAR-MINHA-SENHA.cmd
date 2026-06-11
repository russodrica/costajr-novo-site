@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Portal Costa Junior - Resetar minha senha de admin
echo ============================================================
echo.
node scripts\resetar-minha-senha-admin.mjs > scripts\resultado-reset.log 2>&1
type scripts\resultado-reset.log
echo.
echo ============================================================
echo  Use a NOVA SENHA acima para entrar em /admin/login
echo  (tambem salva em scripts\SENHA-TEMPORARIA-ADMIN.txt)
echo ============================================================
pause
