@echo off
title Marketing Check - Servidor Local
chcp 65001 > nul

cd /d "%~dp0"

echo ==================================================
echo  Iniciando o servidor local do Marketing Check...
echo ==================================================

:: 1. Verifica se o Node.js está instalado
where node >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Node.js detectado. Iniciando servidor...
    echo Abrindo o painel no seu navegador...
    start http://localhost:3000
    node local/server.js
    goto end
)

:: 2. Verifica se o Python está instalado
where python >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] Node.js nao encontrado. Python detectado!
    echo Iniciando servidor Python...
    echo Abrindo o painel no seu navegador...
    start http://localhost:3000
    python local/server.py
    goto end
)

:: 3. Erro - nenhum dos dois instalado
echo [ERRO] Nem Node.js nem Python foram encontrados no seu computador!
echo Para rodar o painel com persistencia local de dados, instale um deles:
echo - Node.js: https://nodejs.org/
echo - Python: https://www.python.org/
echo.
echo Voce ainda pode abrir o arquivo "index.html" diretamente pelo navegador,
echo porem as alteracoes serao salvas no cache temporario (localStorage).
echo.
pause

:end
