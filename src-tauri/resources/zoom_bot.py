import asyncio
import sys
import argparse
from datetime import datetime
from playwright.async_api import async_playwright

async def verificar_conexao(page):
    try:
        status = await page.evaluate("""
            () => {
                const leaveBtn = document.querySelector('button[aria-label="Leave"]');
                const url = window.location.href;
                const naReuniao = url.includes('/wc/') || url.includes('meeting');
                const errorMsg = document.querySelector('[class*="error"], [class*="disconnect"]');
                
                return {
                    leaveBtn: !!leaveBtn,
                    naReuniao: naReuniao,
                    errorMsg: !!errorMsg,
                    url: url
                };
            }
        """)
        
        conectado = status['leaveBtn'] and not status['errorMsg'] and status['naReuniao']
        return {'conectado': conectado, 'status': status}
    except Exception as e:
        print(f"[Bot] Erro ao verificar conexao: {e}")
        return {'conectado': False, 'status': {'error': str(e)}}

async def abrir_painel_participantes(page):
    try:
        panel_aberto = await page.evaluate("""
            () => {
                const items = document.querySelectorAll(
                    '.participants-item, .wc-participants-item, [class*="participants-item"], [role="listitem"]'
                );
                const visiveis = Array.from(items).filter(item => item.offsetParent !== null);
                return visiveis.length;
            }
        """)
        
        if panel_aberto == 0:
            await page.evaluate("""
                () => {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const participantsBtn = buttons.find(btn => {
                        const text = btn.textContent || '';
                        const aria = btn.getAttribute('aria-label') || '';
                        return text.includes('Participants') || aria.includes('participants list');
                    });
                    if (participantsBtn) {
                        participantsBtn.click();
                    }
                }
            """)
            
            for i in range(10):
                await asyncio.sleep(1.5)
                count = await page.evaluate("""
                    () => {
                        const items = document.querySelectorAll(
                            '.participants-item, .wc-participants-item, [class*="participants-item"], [role="listitem"]'
                        );
                        const visiveis = Array.from(items).filter(item => item.offsetParent !== null);
                        return visiveis.length;
                    }
                """)
                if count > 0:
                    return True
        else:
            return True
        return False
    except Exception as e:
        print(f"[Bot] Erro ao abrir painel: {e}")
        return False

async def fazer_login(page, meeting_id, passcode, nome):
    try:
        url_web_client = f"https://zoom.us/wc/join/{meeting_id}"
        print(f"[Bot] Acessando: {url_web_client}")
        
        await page.goto(url_web_client, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_load_state("networkidle", timeout=30000)
        await asyncio.sleep(3)
        
        # Cookie
        try:
            cookie_btn = page.locator("#onetrust-accept-btn-handler")
            if await cookie_btn.is_visible(timeout=2000):
                await cookie_btn.click()
                await asyncio.sleep(0.5)
        except:
            pass
        
        print("[Bot] Procurando campos do formulario...")
        
        # Tentar vários seletores para o campo de nome
        name_selectors = [
            "#input-for-name",
            "input[placeholder*='name' i]",
            "input[placeholder*='nome' i]",
            "input[name='name']",
            "input[autocomplete='name']",
            "input[aria-label*='name' i]",
            "input[aria-label*='nome' i]",
        ]
        
        name_input = None
        for selector in name_selectors:
            try:
                name_input = page.locator(selector).first
                if await name_input.is_visible(timeout=1000):
                    print(f"[Bot] Campo nome encontrado com seletor: {selector}")
                    break
            except:
                continue
        
        if name_input is None:
            inputs = await page.query_selector_all("input[type='text']")
            if inputs:
                name_input = inputs[0]
                print("[Bot] Campo nome encontrado como primeiro input de texto")
            else:
                print("[Bot] Campo nome nao encontrado")
                return False
        
        # Tentar vários seletores para o campo de senha
        pwd_selectors = [
            "#input-for-pwd",
            "input[placeholder*='password' i]",
            "input[placeholder*='senha' i]",
            "input[type='password']",
            "input[name='password']",
        ]
        
        pwd_input = None
        for selector in pwd_selectors:
            try:
                pwd_input = page.locator(selector).first
                if await pwd_input.is_visible(timeout=1000):
                    print(f"[Bot] Campo senha encontrado com seletor: {selector}")
                    break
            except:
                continue
        
        if pwd_input is None:
            print("[Bot] Campo senha nao encontrado")
            return False
        
        # Preencher nome
        await name_input.click()
        await name_input.fill(nome)
        print(f"[Bot] Nome preenchido: {nome}")
        
        # Preencher senha
        await pwd_input.click()
        await pwd_input.fill(passcode)
        print("[Bot] Senha preenchida")
        
        await asyncio.sleep(0.5)
        
        # Disparar eventos
        await page.evaluate("""
            () => {
                document.querySelectorAll('input').forEach(el => {
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                });
            }
        """)
        
        await asyncio.sleep(0.5)
        
        # Clicar Join
        print("[Bot] Procurando botao 'Join'...")
        join_selectors = [
            ".preview-join-button",
            "button[type='submit']",
            "button:has-text('Join')",
            "button:has-text('Entrar')",
            "button:has-text('Participar')",
        ]
        
        join_button = None
        for selector in join_selectors:
            try:
                join_button = page.locator(selector).first
                if await join_button.is_visible(timeout=1000):
                    print(f"[Bot] Botao encontrado com seletor: {selector}")
                    break
            except:
                continue
        
        if join_button:
            await join_button.click()
            print("[Bot] Botao 'Join' clicado!")
        else:
            print("[Bot] Botao 'Join' nao encontrado, tentando Enter...")
            await page.keyboard.press("Enter")
        
        # Aguardar sala carregar
        print("[Bot] Aguardando entrada na reuniao...")
        for i in range(30):
            await asyncio.sleep(3)
            
            indicadores = await page.evaluate("""
                () => {
                    const leaveBtn = document.querySelector('button[aria-label="Leave"]');
                    const participantsBtn = document.querySelector('button[aria-label*="participants"], button[aria-label*="particpants"]');
                    return {
                        leaveBtn: !!leaveBtn,
                        participantsBtn: !!participantsBtn
                    };
                }
            """)
            
            if indicadores['leaveBtn'] and indicadores['participantsBtn']:
                print("[Bot] Entrou na reuniao!")
                await asyncio.sleep(5)
                return True
            
            print(f"[Bot] Tentativa {i+1}/30 - ainda entrando...")
        
        print("[Bot] Tempo esgotado para entrar na reuniao")
        return False
        
    except Exception as e:
        print(f"[Bot] Erro no login: {e}")
        import traceback
        traceback.print_exc()
        return False

async def monitorar_zoom(meeting_id, passcode, nome, headless=True):
    print(f"[Bot] Iniciando bot com:")
    print(f"  Meeting ID: {meeting_id}")
    print(f"  Nome: {nome}")
    print(f"  Headless: {headless}")
    print()
    
    async with async_playwright() as p:
        launch_args = {
            "headless": headless,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--lang=pt-BR",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-extensions",
                "--disable-background-networking",
                "--disable-sync",
                "--disable-translate",
                "--window-size=1280,720",
                "--disable-notifications",
                "--mute-audio",
            ]
        }
        
        if headless:
            launch_args["args"].append("--headless=new")
        
        print("[Bot] Lancando navegador...")
        browser = await p.chromium.launch(**launch_args)
        print("[Bot] Navegador iniciado")
        
        context = await browser.new_context(
            viewport={'width': 1280, 'height': 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale='pt-BR',
            timezone_id='America/Sao_Paulo',
            permissions=['camera', 'microphone'],
        )
        
        await context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {}, loadTimes: function() {}, csi: function() {}, app: {} };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US', 'en'] });
        """)
        
        page = await context.new_page()
        
        await page.route("**/*", lambda route: route.abort() 
                        if route.request.resource_type in ['media', 'font']
                        else route.continue_())
        
        print(f"[Bot] Conectando a reuniao {meeting_id}...")
        
        reconexoes = 0
        MAX_RECONEXOES = 5
        
        try:
            sucesso = await fazer_login(page, meeting_id, passcode, nome)
            
            if not sucesso:
                print("[Bot] Falha no login inicial!")
                await browser.close()
                return
            
            print("[Bot] Login inicial bem sucedido!")
            
            print("[Bot] Abrindo painel de participantes...")
            painel_ok = await abrir_painel_participantes(page)
            
            if painel_ok:
                print("[Bot] Painel de participantes aberto!")
            else:
                print("[Bot] Nao foi possivel abrir o painel")
            
            # Configurar monitoramento
            async def notificar_mao_levantada(nome):
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"MAO LEVANTADA: {nome} [{timestamp}]")
            
            async def notificar_mao_abaixada(nome):
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"MAO ABAIXADA: {nome} [{timestamp}]")
            
            await page.expose_function("notificar_mao_levantada", notificar_mao_levantada)
            await page.expose_function("notificar_mao_abaixada", notificar_mao_abaixada)
            
            await page.evaluate("""
                () => {
                    let maosLevantadas = new Set();
                    
                    function obterParticipantesVisiveis() {
                        const todos = document.querySelectorAll(
                            '.participants-item, .wc-participants-item, [class*="participants-item"], [role="listitem"]'
                        );
                        return Array.from(todos).filter(item => item.offsetParent !== null);
                    }
                    
                    function obterNome(participante) {
                        const nomeElemento = participante.querySelector(
                            '.participants-item__display-name, .wc-participants-item__name, [class*="name"]'
                        );
                        return nomeElemento ? nomeElemento.innerText.trim() : null;
                    }
                    
                    function temMaoLevantada(participante) {
                        return participante.querySelector(
                            '[aria-label*="mao"], [aria-label*="hand"], .hand-raised-icon, [class*="hand-raised"], [class*="handRaised"], img[src*="hand"]'
                        );
                    }
                    
                    function checarMaos() {
                        const participantes = obterParticipantesVisiveis();
                        const maosAtuais = new Set();
                        
                        participantes.forEach(participante => {
                            const nome = obterNome(participante);
                            if (nome && temMaoLevantada(participante)) {
                                maosAtuais.add(nome);
                            }
                        });
                        
                        maosAtuais.forEach(nome => {
                            if (!maosLevantadas.has(nome)) {
                                window.notificar_mao_levantada(nome);
                            }
                        });
                        
                        maosLevantadas.forEach(nome => {
                            if (!maosAtuais.has(nome)) {
                                window.notificar_mao_abaixada(nome);
                            }
                        });
                        
                        maosLevantadas = maosAtuais;
                    }
                    
                    const listaContainer = document.querySelector(
                        '.participants-list, .wc-participants-list, [aria-label="Participants list"], [aria-label="Lista de participantes"]'
                    );
                    
                    const alvo = listaContainer || document.body;
                    
                    const observer = new MutationObserver(() => {
                        clearTimeout(window.maoCheckTimeout);
                        window.maoCheckTimeout = setTimeout(checarMaos, 500);
                    });
                    
                    observer.observe(alvo, { 
                        attributes: true, 
                        childList: true, 
                        subtree: true 
                    });
                    
                    setInterval(checarMaos, 3000);
                    setTimeout(checarMaos, 2000);
                }
            """)
            
            print("[Bot] Sistema de monitoramento ativo!")
            print("[Bot] Monitorando conexao a cada 30 segundos...")
            print("[Bot] Pressione Ctrl+C para encerrar\n")
            
            while True:
                await asyncio.sleep(30)
                
                resultado = await verificar_conexao(page)
                
                if not resultado['conectado']:
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    print(f"\nCONEXAO PERDIDA! [{timestamp}]")
                    print(f"[Bot] Status: {resultado['status']}")
                    
                    if reconexoes >= MAX_RECONEXOES:
                        print(f"[Bot] Numero maximo de reconexoes atingido ({MAX_RECONEXOES})")
                        print("[Bot] Encerrando...")
                        break
                    
                    reconexoes += 1
                    print(f"[Bot] Tentativa de reconexao {reconexoes}/{MAX_RECONEXOES} em 10 segundos...")
                    
                    await asyncio.sleep(10)
                    
                    print(f"[Bot] Reconectando...")
                    sucesso = await fazer_login(page, meeting_id, passcode, nome)
                    
                    if sucesso:
                        print("[Bot] Reconectado com sucesso!")
                        reconexoes = 0
                        
                        await asyncio.sleep(3)
                        painel_ok = await abrir_painel_participantes(page)
                        
                        if painel_ok:
                            print("[Bot] Painel reaberto!")
                            
                            await page.expose_function("notificar_mao_levantada", notificar_mao_levantada)
                            await page.expose_function("notificar_mao_abaixada", notificar_mao_abaixada)
                            
                            await page.evaluate("""
                                () => {
                                    let maosLevantadas = new Set();
                                    
                                    function obterParticipantesVisiveis() {
                                        const todos = document.querySelectorAll(
                                            '.participants-item, .wc-participants-item, [class*="participants-item"], [role="listitem"]'
                                        );
                                        return Array.from(todos).filter(item => item.offsetParent !== null);
                                    }
                                    
                                    function obterNome(participante) {
                                        const nomeElemento = participante.querySelector(
                                            '.participants-item__display-name, .wc-participants-item__name, [class*="name"]'
                                        );
                                        return nomeElemento ? nomeElemento.innerText.trim() : null;
                                    }
                                    
                                    function temMaoLevantada(participante) {
                                        return participante.querySelector(
                                            '[aria-label*="mao"], [aria-label*="hand"], .hand-raised-icon, [class*="hand-raised"], [class*="handRaised"], img[src*="hand"]'
                                        );
                                    }
                                    
                                    function checarMaos() {
                                        const participantes = obterParticipantesVisiveis();
                                        const maosAtuais = new Set();
                                        
                                        participantes.forEach(participante => {
                                            const nome = obterNome(participante);
                                            if (nome && temMaoLevantada(participante)) {
                                                maosAtuais.add(nome);
                                            }
                                        });
                                        
                                        maosAtuais.forEach(nome => {
                                            if (!maosLevantadas.has(nome)) {
                                                window.notificar_mao_levantada(nome);
                                            }
                                        });
                                        
                                        maosLevantadas.forEach(nome => {
                                            if (!maosAtuais.has(nome)) {
                                                window.notificar_mao_abaixada(nome);
                                            }
                                        });
                                        
                                        maosLevantadas = maosAtuais;
                                    }
                                    
                                    const listaContainer = document.querySelector(
                                        '.participants-list, .wc-participants-list, [aria-label="Participants list"], [aria-label="Lista de participantes"]'
                                    );
                                    
                                    const alvo = listaContainer || document.body;
                                    
                                    const observer = new MutationObserver(() => {
                                        clearTimeout(window.maoCheckTimeout);
                                        window.maoCheckTimeout = setTimeout(checarMaos, 500);
                                    });
                                    
                                    observer.observe(alvo, { 
                                        attributes: true, 
                                        childList: true, 
                                        subtree: true 
                                    });
                                    
                                    setInterval(checarMaos, 3000);
                                    setTimeout(checarMaos, 2000);
                                }
                            """)
                            
                            print("[Bot] Monitoramento reconfigurado!")
                        else:
                            print("[Bot] Nao foi possivel reabrir o painel")
                    else:
                        print(f"[Bot] Falha na reconexao {reconexoes}")
                
        except KeyboardInterrupt:
            print("\n[Bot] Interrompido pelo usuario")
        except Exception as e:
            print(f"\n[Bot] Erro: {e}")
            import traceback
            traceback.print_exc()
        finally:
            await browser.close()
            print(f"[Bot] Encerrado. Total de reconexoes: {reconexoes}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Zoom Bot para monitorar maos levantadas')
    parser.add_argument('--meeting', required=True, help='ID da reuniao Zoom')
    parser.add_argument('--passcode', required=True, help='Senha da reuniao')
    parser.add_argument('--name', default='Ouvinte_Silencioso', help='Nome do bot')
    parser.add_argument('--headless', action='store_true', default=True, help='Executar em modo headless')
    parser.add_argument('--visible', action='store_true', help='Executar em modo visivel (debug)')
    
    args = parser.parse_args()
    
    headless = not args.visible
    
    # Forçar codificação UTF-8 para evitar erros de caracteres
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    
    asyncio.run(monitorar_zoom(args.meeting, args.passcode, args.name, headless))