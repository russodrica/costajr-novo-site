@echo off
REM ---------------------------------------------------------------
REM  Ponte Comercial: traz os arquivos que chegaram no bot do
REM  Telegram para a pasta _CLAUDE COMERCIAL, e avisa no grupo
REM  quando o Claude termina um orcamento.
REM
REM  De dois cliques aqui, ou agende no Agendador de Tarefas do
REM  Windows para rodar a cada 5 minutos.
REM ---------------------------------------------------------------
cd /d "%~dp0"
node scripts\comercial-puxar-jobs.mjs
echo.
pause
