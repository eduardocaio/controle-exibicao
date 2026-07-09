@echo off
title Gerador do Zoom Bot

:: 🔥 FORÇAR O DIRETÓRIO CORRETO
cd /d "%~dp0"
echo ========================================
echo        GERADOR DO ZOOM BOT
echo ========================================
echo.
echo Diretorio atual: %cd%
echo.

:: Verificar se o PyInstaller está instalado
echo [1/6] Verificando PyInstaller...
pip show pyinstaller > nul 2>&1
if %errorlevel% neq 0 (
    echo [!] PyInstaller nao encontrado. Instalando...
    pip install pyinstaller
    echo.
)

:: Verificar se o Playwright está instalado
echo [2/6] Verificando Playwright...
pip show playwright > nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Playwright nao encontrado. Instalando...
    pip install playwright
    playwright install chromium
    echo.
)

:: 1. Fazer backup do executável atual
echo [3/6] Fazendo backup do zoom_bot.exe...
if exist "zoom_bot.exe" (
    if exist "zoom_bot_backup.exe" (
        echo [!] Backup ja existe. Removendo...
        del "zoom_bot_backup.exe"
    )
    rename "zoom_bot.exe" "zoom_bot_backup.exe"
    echo [OK] Backup criado: zoom_bot_backup.exe
) else (
    echo [OK] Nenhum executavel encontrado para fazer backup
)

:: 2. Gerar o novo executável
echo.
echo [4/6] Gerando novo executavel...
echo Isso pode levar alguns minutos...
echo.

:: 🔥 EXECUTAR PYINSTALLER NO DIRETÓRIO CORRETO
pyinstaller --onefile --noconsole --name zoom_bot --hidden-import=playwright.async_api --hidden-import=playwright._impl._api_structures --collect-all playwright zoom_bot.py

:: Verificar se a geração foi bem sucedida
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Falha ao gerar o executavel!
    echo.
    echo Voltando o backup...
    if exist "zoom_bot_backup.exe" (
        rename "zoom_bot_backup.exe" "zoom_bot.exe"
        echo [OK] Backup restaurado
    )
    pause
    exit /b 1
)

:: 3. Copiar o novo executável para a pasta atual
echo.
echo [5/6] Copiando novo executavel...

:: Verifica se o executável foi gerado
if exist "dist\zoom_bot.exe" (
    :: Volta uma pasta (da pasta atual para a pasta resources)
    copy "dist\zoom_bot.exe" ".\zoom_bot.exe"
    echo [OK] Executavel copiado com sucesso!
) else (
    echo [ERRO] Executavel nao encontrado na pasta dist!
    echo Restaurando backup...
    if exist "zoom_bot_backup.exe" (
        rename "zoom_bot_backup.exe" "zoom_bot.exe"
        echo [OK] Backup restaurado
    )
    pause
    exit /b 1
)

:: 4. Limpar arquivos temporários
echo.
echo [6/6] Limpando arquivos temporarios...

:: Remove a pasta dist
if exist "dist" (
    rmdir /s /q "dist"
    echo [OK] Pasta dist removida
)

:: Remove a pasta build
if exist "build" (
    rmdir /s /q "build"
    echo [OK] Pasta build removida
)

:: Remove o arquivo .spec
if exist "zoom_bot.spec" (
    del "zoom_bot.spec"
    echo [OK] Arquivo zoom_bot.spec removido
)

:: Remove pastas do PyInstaller (se existirem)
if exist "__pycache__" (
    rmdir /s /q "__pycache__"
    echo [OK] Pasta __pycache__ removida
)

echo.
echo ========================================
echo        PROCESSO CONCLUIDO!
echo ========================================
echo.
echo [OK] Novo executavel gerado com sucesso!
echo [OK] Backup mantido como: zoom_bot_backup.exe
echo.

:: Mostrar informações do novo arquivo
if exist "zoom_bot.exe" (
    echo Informacoes do novo executavel:
    echo   Tamanho: 
    for %%A in ("zoom_bot.exe") do echo     %%~zA bytes
    echo   Data: %%~tA
)

echo.
echo Pressione qualquer tecla para sair...
pause > nul