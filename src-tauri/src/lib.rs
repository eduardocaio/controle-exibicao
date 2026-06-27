mod state;

use state::{AppState, Presentation, SharedState};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tauri::Manager;
use tauri::WebviewWindowBuilder;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{StreamExt, SinkExt};

// ============ FUNÇÕES DE PERSISTÊNCIA ============

fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn save_state_to_disk(state: &AppState, app_handle: &tauri::AppHandle) {
    let data_dir = get_data_dir(app_handle);
    let _ = fs::create_dir_all(&data_dir);
    let state_file = data_dir.join("state.json");
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = fs::write(state_file, json);
    }
}

fn load_state_from_disk(app_handle: &tauri::AppHandle) -> AppState {
    let data_dir = get_data_dir(app_handle);
    let state_file = data_dir.join("state.json");
    if let Ok(content) = fs::read_to_string(state_file) {
        if let Ok(state) = serde_json::from_str(&content) {
            return state;
        }
    }
    AppState::new()
}

// ============ BASE64 ENCODE ============

fn base64_encode(bytes: &[u8]) -> String {
    let alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let combined = (b0 << 16) | (b1 << 8) | b2;
        result.push(alphabet.chars().nth(((combined >> 18) & 63) as usize).unwrap());
        result.push(alphabet.chars().nth(((combined >> 12) & 63) as usize).unwrap());
        result.push(if chunk.len() > 1 {
            alphabet.chars().nth(((combined >> 6) & 63) as usize).unwrap()
        } else {
            '='
        });
        result.push(if chunk.len() > 2 {
            alphabet.chars().nth((combined & 63) as usize).unwrap()
        } else {
            '='
        });
    }
    result
}

// ============ COMANDOS TAURI ============

#[tauri::command]
async fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_dir.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_app_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&*app_state).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_presentation(
    name: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut app_state = state.write().await;
    let presentation = Presentation {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        slides: Vec::new(),
    };
    app_state.presentations.push(presentation.clone());
    save_state_to_disk(&app_state, &app_handle);
    serde_json::to_string(&presentation).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_presentation(
    id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    if let Some(presentation) = app_state.presentations.iter().find(|p| p.id == id) {
        for slide in &presentation.slides {
            let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
            let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
        }
    }
    app_state.presentations.retain(|p| p.id != id);
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn edit_presentation_name(
    id: String,
    new_name: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(p) = app_state.presentations.iter_mut().find(|p| p.id == id) {
        p.name = new_name;
    }
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn upload_images(
    presentation_id: String,
    file_paths: Vec<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = app_dir.join("images");
    let thumbs_dir = app_dir.join("thumbnails");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;

    let mut new_slides = Vec::new();
    for file_path in &file_paths {
        let original_path = PathBuf::from(file_path);
        let extension = original_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg");
        let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
        let dest_path = images_dir.join(&new_filename);
        fs::copy(&original_path, &dest_path).map_err(|e| e.to_string())?;
        let thumb_path = thumbs_dir.join(&new_filename);
        if let Ok(img) = image::open(&dest_path) {
            let _ = img.thumbnail(200, 150).save(&thumb_path);
        } else {
            let _ = fs::copy(&dest_path, &thumb_path);
        }
        new_slides.push(state::Slide {
            id: uuid::Uuid::new_v4().to_string(),
            filename: new_filename.clone(),
            order: 0,
        });
    }

    let mut app_state = state.write().await;
    let presentation = app_state
        .presentations
        .iter_mut()
        .find(|p| p.id == presentation_id)
        .ok_or("Apresentação não encontrada")?;

    for slide in &mut new_slides {
        slide.order = presentation.slides.len();
        presentation.slides.push(slide.clone());
    }

    let result = serde_json::to_string(&presentation).map_err(|e| e.to_string())?;
    save_state_to_disk(&app_state, &app_handle);
    Ok(result)
}

#[tauri::command]
async fn delete_slide(
    presentation_id: String,
    slide_id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    let presentation = app_state
        .presentations
        .iter_mut()
        .find(|p| p.id == presentation_id)
        .ok_or("Apresentação não encontrada")?;

    if let Some(slide) = presentation.slides.iter().find(|s| s.id == slide_id) {
        let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
        let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
    }

    presentation.slides.retain(|s| s.id != slide_id);
    for (i, slide) in presentation.slides.iter_mut().enumerate() {
        slide.order = i;
    }

    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn get_image_base64(
    filename: String,
    is_thumb: bool,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let folder = if is_thumb { "thumbnails" } else { "images" };
    let file_path = app_dir.join(folder).join(&filename);
    let bytes = fs::read(&file_path).map_err(|e| format!("Erro: {}", e))?;
    let ext = file_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    let b64 = base64_encode(&bytes);
    Ok(format!("data:image/{};base64,{}", ext, b64))
}

#[tauri::command]
async fn get_default_image(app_handle: tauri::AppHandle) -> Result<String, String> {
    let resource_path = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join("texto-do-ano.jpg");

    if resource_path.exists() {
        let bytes = fs::read(&resource_path).map_err(|e| e.to_string())?;
        let b64 = base64_encode(&bytes);
        Ok(format!("data:image/jpeg;base64,{}", b64))
    } else {
        Ok("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9ImJsYWNrIi8+PC9zdmc+".to_string())
    }
}

#[tauri::command]
async fn set_active_presentation(
    presentation_id: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    app_state.active_presentation = Some(presentation_id);
    app_state.current_slide_index = 0;
    app_state.is_blackout = false;
    Ok(())
}

#[tauri::command]
async fn set_current_slide(
    index: usize,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    app_state.current_slide_index = index;
    app_state.is_blackout = false;
    Ok(())
}

#[tauri::command]
async fn set_blackout(
    value: bool,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    state.write().await.is_blackout = value;
    Ok(())
}

#[tauri::command]
async fn next_slide(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(ref pres_id) = app_state.active_presentation.clone() {
        let pres_id = pres_id.clone();
        if let Some(pres) = app_state.presentations.iter().find(|p| p.id == pres_id) {
            if app_state.current_slide_index + 1 < pres.slides.len() {
                app_state.current_slide_index += 1;
            }
        }
    }
    Ok(())
}

#[tauri::command]
async fn prev_slide(state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let mut app_state = state.write().await;
    if app_state.current_slide_index > 0 {
        app_state.current_slide_index -= 1;
    }
    Ok(())
}

#[tauri::command]
async fn get_display_state(
    state: tauri::State<'_, SharedState>,
) -> Result<String, String> {
    let app_state = state.read().await;
    let data = if let Some(ref pres_id) = app_state.active_presentation {
        if let Some(pres) = app_state.presentations.iter().find(|p| &p.id == pres_id) {
            let s = pres.slides.get(app_state.current_slide_index);
            serde_json::json!({
                "presentation_name": pres.name,
                "current_index": app_state.current_slide_index,
                "total_slides": pres.slides.len(),
                "is_blackout": app_state.is_blackout,
                "current_filename": s.map(|s| s.filename.clone()),
            })
        } else {
            serde_json::json!({ "is_blackout": true, "current_filename": null })
        }
    } else {
        serde_json::json!({ "is_blackout": true, "current_filename": null })
    };
    serde_json::to_string(&data).map_err(|e| e.to_string())
}

// ============ CONTROLE DA JANELA DE EXIBIÇÃO ============

#[tauri::command]
async fn show_display_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    show_display_window_internal(&app_handle).await
}

#[tauri::command]
async fn close_display_window() -> Result<(), String> {
    Ok(())
}

#[tauri::command]
async fn lower_display_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app_handle.get_webview_window("display") {
        w.set_always_on_top(false).map_err(|e| e.to_string())?;
        if let Some(main) = app_handle.get_webview_window("main") {
            main.set_focus().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ============ BOTÃO SWITCH: ALTERNAR ENTRE SISTEMA E JW LIBRARY ============

#[tauri::command]
async fn switch_to_jw_library(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Baixa nossa janela
    if let Some(w) = app_handle.get_webview_window("display") {
        w.set_always_on_top(false).ok();
    }
    // Traz JW Library ao topo
    std::process::Command::new("powershell")
        .args(&["-NoProfile", "-Command",
            "$wshell = New-Object -ComObject WScript.Shell;",
            "$wshell.AppActivate('JW Library');"
        ])
        .spawn()
        .ok();
    Ok(())
}

#[tauri::command]
async fn switch_to_sistema(app_handle: tauri::AppHandle) -> Result<(), String> {
    show_display_window_internal(&app_handle).await
}

#[tauri::command]
async fn get_monitors(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    if let Some(w) = app_handle.get_webview_window("main") {
        if let Ok(monitors) = w.available_monitors() {
            return Ok(monitors
                .iter()
                .enumerate()
                .map(|(i, m)| format!("Monitor {}: {}x{}", i + 1, m.size().width, m.size().height))
                .collect());
        }
    }
    Ok(vec!["Não detectado".into()])
}

// ============ WEBSOCKET ============

fn start_ws_server(app_state: SharedState, app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let addr = "0.0.0.0:20777";
        let listener = match TcpListener::bind(addr).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("❌ Erro ao iniciar WebSocket: {}", e);
                return;
            }
        };
        println!("🟢 WebSocket rodando em ws://{}", addr);

        while let Ok((stream, peer)) = listener.accept().await {
            let state = app_state.clone();
            let handle = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                handle_ws_connection(stream, peer, state, handle).await;
            });
        }
    });
}

async fn handle_ws_connection(
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
    app_state: SharedState,
    app_handle: tauri::AppHandle,
) {
    if let Ok(ws_stream) = tokio_tungstenite::accept_async(stream).await {
        println!("🔗 Tablet conectado: {}", peer);
        let (mut sender, mut receiver) = ws_stream.split();

        // Envia estado inicial
        {
            let st = app_state.read().await;
            if let Some(ref pres_id) = st.active_presentation {
                if let Some(pres) = st.presentations.iter().find(|p| &p.id == pres_id) {
                    let slides: Vec<serde_json::Value> = pres
                        .slides
                        .iter()
                        .map(|sl| {
                            serde_json::json!({
                                "id": sl.id,
                                "filename": sl.filename,
                                "order": sl.order
                            })
                        })
                        .collect();
                    let msg = serde_json::json!({
                        "type": "state",
                        "slides": slides,
                        "current_index": st.current_slide_index,
                        "is_blackout": st.is_blackout
                    })
                    .to_string();
                    let _ = sender.send(Message::Text(msg)).await;
                }
            }
        }

        // Loop de mensagens
        while let Some(Ok(msg)) = receiver.next().await {
            if let Message::Text(text) = msg {
                if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(&text) {
                    let mut st = app_state.write().await;
                    let action = cmd["action"].as_str().unwrap_or("");

                    match action {
                        "set_slide" => {
                            if let Some(idx) = cmd["index"].as_u64() {
                                st.current_slide_index = idx as usize;
                                st.is_blackout = false;
                            }
                        }
                        "next" => {
                            let pres_id = st.active_presentation.clone();
                            if let Some(ref pid) = pres_id {
                                if let Some(p) = st.presentations.iter().find(|p| &p.id == pid) {
                                    if st.current_slide_index + 1 < p.slides.len() {
                                        st.current_slide_index += 1;
                                        st.is_blackout = false;
                                    }
                                }
                            }
                        }
                        "prev" => {
                            if st.current_slide_index > 0 {
                                st.current_slide_index -= 1;
                                st.is_blackout = false;
                            }
                        }
                        "blackout" => st.is_blackout = true,
                        "show" => st.is_blackout = false,
                        _ => {}
                    }

                    // Envia estado atualizado (apenas atualiza o estado, não mexe na janela)
                    let response = {
                        let pres_id = st.active_presentation.clone();
                        if let Some(ref pid) = pres_id {
                            if let Some(p) = st.presentations.iter().find(|p| &p.id == pid) {
                                let slides: Vec<serde_json::Value> = p
                                    .slides
                                    .iter()
                                    .map(|sl| {
                                        serde_json::json!({
                                            "id": sl.id,
                                            "filename": sl.filename,
                                            "order": sl.order
                                        })
                                    })
                                    .collect();
                                serde_json::json!({
                                    "type": "state",
                                    "slides": slides,
                                    "current_index": st.current_slide_index,
                                    "is_blackout": st.is_blackout
                                })
                                .to_string()
                            } else {
                                "{}".into()
                            }
                        } else {
                            "{}".into()
                        }
                    };
                    let _ = sender.send(Message::Text(response)).await;
                }
            }
        }

        println!("🔴 Tablet desconectado: {}", peer);
    }
}

async fn show_display_window_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app_handle.get_webview_window("display") {
        w.unminimize().map_err(|e| e.to_string())?;
        w.show().map_err(|e| e.to_string())?;
        w.set_always_on_top(true).map_err(|e| e.to_string())?;
        w.set_fullscreen(true).map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(
        app_handle,
        "display",
        tauri::WebviewUrl::App("/display".into()),
    )
    .title("Tela de Exibição")
    .inner_size(800.0, 600.0)
    .decorations(false)
    .always_on_top(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;

    if let Ok(monitors) = window.available_monitors() {
        let target = if monitors.len() > 1 {
            &monitors[1]
        } else {
            &monitors[0]
        };
        window
            .set_position(tauri::PhysicalPosition::new(
                target.position().x,
                target.position().y,
            ))
            .map_err(|e| e.to_string())?;
        window
            .set_size(tauri::PhysicalSize::new(
                target.size().width,
                target.size().height,
            ))
            .map_err(|e| e.to_string())?;
    }

    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

// ============ INICIALIZAÇÃO ============

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = load_state_from_disk(&app.handle());
            let shared_state: SharedState = Arc::new(RwLock::new(state));
            app.manage(shared_state.clone());

            start_ws_server(shared_state, app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir,
            get_app_state,
            create_presentation,
            delete_presentation,
            edit_presentation_name,
            upload_images,
            delete_slide,
            get_image_base64,
            get_default_image,
            set_active_presentation,
            set_current_slide,
            set_blackout,
            next_slide,
            prev_slide,
            get_display_state,
            show_display_window,
            close_display_window,
            lower_display_window,
            switch_to_jw_library,
            switch_to_sistema,
            get_monitors,
        ])
        .run(tauri::generate_context!())
        .expect("erro");
}