@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================================
echo  Portal Costa Junior - Importar colaboradores do Manus
echo ============================================================
echo.
node scripts\importar-usuarios-manus.mjs > scripts\resultado-import.log 2>&1
type scripts\resultado-import.log
echo.
echo ============================================================
echo  Fim. Se aparecer "CONCLUIDO", os usuarios foram importados.
echo  As senhas iniciais estao em scripts\SENHAS-INICIAIS.txt
echo ============================================================
pause
