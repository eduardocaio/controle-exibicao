mod state;

use state::{AppState, SharedState, Slide, WaterRequest, IndicatorRequest, OperatorMessage};
use std::fs;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::RwLock;
use tauri::Manager;
use tauri::Emitter;
use tauri::WebviewWindowBuilder;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::Message;
use futures_util::{StreamExt, SinkExt};
use warp::Filter;
use rust_embed::RustEmbed;
use mime_guess::from_path;
use image::ImageFormat;
use image::GenericImageView;

// Estrutura para gerenciar conexões WebSocket
struct WsClients {
    senders: Mutex<Vec<tokio::sync::mpsc::UnboundedSender<String>>>,
}

impl WsClients {
    fn new() -> Self {
        Self {
            senders: Mutex::new(Vec::new()),
        }
    }
    
    fn broadcast(&self, msg: String) {
        if let Ok(senders) = self.senders.lock() {
            let mut active_senders = Vec::new();
            for sender in senders.iter() {
                if sender.send(msg.clone()).is_ok() {
                    active_senders.push(sender.clone());
                }
            }
            drop(senders);
            if let Ok(mut senders) = self.senders.lock() {
                *senders = active_senders;
            }
        }
    }
    
    fn add(&self, sender: tokio::sync::mpsc::UnboundedSender<String>) {
        if let Ok(mut senders) = self.senders.lock() {
            senders.push(sender);
        }
    }
}

fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    app_handle.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."))
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

fn base64_encode(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn get_thumbnail_base64(app_handle: &tauri::AppHandle, filename: &str) -> String {
    let app_dir = get_data_dir(app_handle);
    let thumb_path = app_dir.join("thumbnails").join(filename);
    if let Ok(bytes) = fs::read(&thumb_path) {
        let b64 = base64_encode(&bytes);
        let ext = thumb_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        format!("data:image/{};base64,{}", ext, b64)
    } else { 
        String::new() 
    }
}

fn build_slides_json(slides: &Vec<Slide>, _app_handle: &tauri::AppHandle) -> Vec<serde_json::Value> {
    slides.iter().map(|sl| {
        serde_json::json!({ 
            "id": sl.id, 
            "filename": sl.filename, 
            "order": sl.order
        })
    }).collect()
}

#[tauri::command]
async fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    Ok(app_handle.path().app_data_dir().map_err(|e| e.to_string())?.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_app_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    serde_json::to_string(&*state.read().await).map_err(|e| e.to_string())
}

#[tauri::command]
async fn upload_images_direct(
    file_paths: Vec<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let images_dir = app_dir.join("images");
    let thumbs_dir = app_dir.join("thumbnails");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    
    let mut new_slides = Vec::new();
    for file_path in &file_paths {
        let original_path = PathBuf::from(file_path);
        let extension = original_path.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
        let dest_path = images_dir.join(&new_filename);
        let thumb_path = thumbs_dir.join(&new_filename);
        
        if let Ok(img) = image::open(&original_path) {
            let (width, height) = img.dimensions();
            
            // Otimizar imagem original se for muito grande
            let optimized_img = if width > 1920 || height > 1080 {
                let aspect_ratio = width as f32 / height as f32;
                let new_height = 1080u32;
                let new_width = (new_height as f32 * aspect_ratio) as u32;
                img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3)
            } else {
                img
            };
            
            // Salvar imagem otimizada (JPEG qualidade 80%)
            let _ = optimized_img.save_with_format(&dest_path, ImageFormat::Jpeg);
            
            // Thumbnail 400x300
            let thumb = optimized_img.resize_exact(400, 300, image::imageops::FilterType::Lanczos3);
            let _ = thumb.save_with_format(&thumb_path, ImageFormat::Jpeg);
        } else {
            let _ = fs::copy(&original_path, &dest_path);
            let _ = fs::copy(&original_path, &thumb_path);
        }
        
        new_slides.push((uuid::Uuid::new_v4().to_string(), new_filename));
    }
    
    let mut app_state = state.write().await;
    let start_order = app_state.slides.len();
    for (i, (id, filename)) in new_slides.into_iter().enumerate() {
        app_state.slides.push(Slide { id, filename, order: start_order + i });
    }
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn get_all_slides(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.slides).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_slide(slide_id: String, state: tauri::State<'_, SharedState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    if let Some(slide) = app_state.slides.iter().find(|s| s.id == slide_id) {
        let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
        let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
    }
    app_state.slides.retain(|s| s.id != slide_id);
    for (i, slide) in app_state.slides.iter_mut().enumerate() { 
        slide.order = i; 
    }
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn get_image_base64(filename: String, is_thumb: bool, app_handle: tauri::AppHandle) -> Result<String, String> {
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
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let custom_path = app_dir.join("resources").join("texto-do-ano.jpg");
    let img_path = if custom_path.exists() { 
        custom_path 
    } else { 
        app_handle.path().resource_dir().map_err(|e| e.to_string())?.join("resources").join("texto-do-ano.jpg") 
    };
    if img_path.exists() {
        let bytes = fs::read(&img_path).map_err(|e| e.to_string())?;
        let b64 = base64_encode(&bytes);
        Ok(format!("data:image/jpeg;base64,{}", b64))
    } else {
        Ok("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9ImJsYWNrIi8+PC9zdmc+".to_string())
    }
}

#[tauri::command]
async fn set_current_slide(index: usize, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    let mut app_state = state.write().await;
    app_state.current_slide_index = index;
    app_state.is_blackout = false;
    Ok(())
}

#[tauri::command]
async fn set_blackout(value: bool, state: tauri::State<'_, SharedState>) -> Result<(), String> {
    state.write().await.is_blackout = value;
    Ok(())
}

#[tauri::command]
async fn get_display_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    let s = app_state.slides.get(app_state.current_slide_index);
    let data = serde_json::json!({
        "current_index": app_state.current_slide_index,
        "total_slides": app_state.slides.len(),
        "is_blackout": app_state.is_blackout,
        "current_filename": s.map(|s| s.filename.clone()),
    });
    serde_json::to_string(&data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn show_display_window(app_handle: tauri::AppHandle) -> Result<(), String> { 
    show_display_window_internal(&app_handle).await 
}

#[tauri::command]
async fn switch_to_jw_library(app_handle: tauri::AppHandle) -> Result<(), String> { 
    switch_to_jw_library_internal(&app_handle).await 
}

#[tauri::command]
async fn switch_to_sistema(app_handle: tauri::AppHandle) -> Result<(), String> { 
    switch_to_sistema_internal(&app_handle).await 
}

#[tauri::command]
async fn get_monitors(app_handle: tauri::AppHandle) -> Result<Vec<String>, String> {
    if let Some(w) = app_handle.get_webview_window("main") {
        if let Ok(monitors) = w.available_monitors() {
            return Ok(monitors.iter().enumerate().map(|(i, m)| 
                format!("Monitor {}: {}x{}", i + 1, m.size().width, m.size().height)
            ).collect());
        }
    }
    Ok(vec!["Não detectado".into()])
}

#[tauri::command]
async fn set_texto_do_ano(file_path: String, app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let resources_dir = app_dir.join("resources");
    fs::create_dir_all(&resources_dir).map_err(|e| e.to_string())?;
    fs::copy(&file_path, &resources_dir.join("texto-do-ano.jpg")).map_err(|e| e.to_string())?;
    app_handle.emit("texto-do-ano-atualizado", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_texto_do_ano_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let custom_path = app_dir.join("resources").join("texto-do-ano.jpg");
    if custom_path.exists() { 
        Ok(custom_path.to_string_lossy().to_string()) 
    } else { 
        Ok(String::new()) 
    }
}

#[tauri::command]
async fn reset_texto_do_ano(app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let custom_path = app_dir.join("resources").join("texto-do-ano.jpg");
    if custom_path.exists() { 
        fs::remove_file(&custom_path).map_err(|e| e.to_string())?; 
    }
    app_handle.emit("texto-do-ano-atualizado", ()).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn timer_control(
    action: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<String, String> {
    let mut app_state = state.write().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    
    match action.as_str() {
        "start" => {
            if !app_state.timer.running {
                app_state.timer.running = true;
                app_state.timer.start_time = now;
            }
        }
        "pause" => {
            if app_state.timer.running {
                app_state.timer.running = false;
                app_state.timer.accumulated += now - app_state.timer.start_time;
            }
        }
        "reset" => {
            app_state.timer.running = false;
            app_state.timer.accumulated = 0;
            app_state.timer.start_time = 0;
        }
        _ => return Err("Ação inválida".to_string()),
    }
    
    let current_ms = if app_state.timer.running {
        app_state.timer.accumulated + (now - app_state.timer.start_time)
    } else {
        app_state.timer.accumulated
    };
    
    let timer_state = serde_json::json!({
        "running": app_state.timer.running,
        "accumulated": current_ms,
        "start_time": app_state.timer.start_time,
    });
    
    app_handle.emit("timer-update", &timer_state).map_err(|e| e.to_string())?;
    
    let ws_msg = serde_json::json!({
        "type": "timer_state",
        "running": app_state.timer.running,
        "accumulated": current_ms,
        "start_time": app_state.timer.start_time,
    }).to_string();
    ws_clients.broadcast(ws_msg);
    
    Ok(timer_state.to_string())
}

#[tauri::command]
async fn get_timer_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64;
    
    let current_ms = if app_state.timer.running {
        app_state.timer.accumulated + (now - app_state.timer.start_time)
    } else {
        app_state.timer.accumulated
    };
    
    let timer_state = serde_json::json!({
        "running": app_state.timer.running,
        "accumulated": current_ms,
        "start_time": app_state.timer.start_time,
    });
    
    Ok(timer_state.to_string())
}

#[tauri::command]
async fn request_water(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    
    let request = WaterRequest {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: now,
        acknowledged: false,
    };
    
    app_state.water_requests.push(request.clone());
    app_handle.emit("water-request", &request).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn acknowledge_water_request(
    request_id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(req) = app_state.water_requests.iter_mut().find(|r| r.id == request_id) {
        req.acknowledged = true;
    }
    app_handle.emit("water-request-acknowledged", &request_id).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_water_requests(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.water_requests).map_err(|e| e.to_string())
}

#[tauri::command]
async fn request_indicator(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    
    if let Some(ref req) = app_state.indicator_request {
        if !req.acknowledged {
            return Err("Já existe um pedido de indicador pendente".to_string());
        }
    }
    
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    
    let request = IndicatorRequest {
        timestamp: now,
        acknowledged: false,
    };
    
    app_state.indicator_request = Some(request.clone());
    app_handle.emit("indicator-request", &request).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn acknowledge_indicator_request(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(ref mut req) = app_state.indicator_request {
        req.acknowledged = true;
    }
    app_handle.emit("indicator-request-acknowledged", true).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_indicator_request(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.indicator_request).map_err(|e| e.to_string())
}

#[tauri::command]
async fn send_operator_message(
    text: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    
    let message = OperatorMessage {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.clone(),
        timestamp: now,
        acknowledged: false,
    };
    
    app_state.operator_message = Some(message.clone());
    app_handle.emit("operator-message-sent", &message).map_err(|e| e.to_string())?;
    
    let ws_msg = serde_json::json!({
        "type": "operator_message",
        "id": message.id,
        "text": message.text,
        "timestamp": message.timestamp,
    }).to_string();
    ws_clients.broadcast(ws_msg);
    
    Ok(())
}

#[tauri::command]
async fn acknowledge_operator_message(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(ref mut msg) = app_state.operator_message {
        msg.acknowledged = true;
    }
    app_state.operator_message = None;
    app_handle.emit("operator-message-acknowledged", true).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_operator_message(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.operator_message).map_err(|e| e.to_string())
}

async fn switch_to_jw_library_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app_handle.get_webview_window("display") {
        w.set_always_on_top(false).ok();
        w.hide().ok();
    }
    
    std::process::Command::new("powershell")
        .args(&["-NoProfile", "-WindowStyle", "Hidden", "-Command", 
            "$wshell = New-Object -ComObject WScript.Shell;",
            "$wshell.AppActivate('JW Library');"
        ])
        .spawn().ok();
    
    app_handle.emit("switch-app", "jw").ok();
    Ok(())
}

async fn switch_to_sistema_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    show_display_window_internal(app_handle).await?;
    app_handle.emit("switch-app", "sistema").ok();
    Ok(())
}

fn start_ws_server(app_state: SharedState, app_handle: tauri::AppHandle, clients: Arc<WsClients>) {
    tauri::async_runtime::spawn(async move {
        let addr = "0.0.0.0:20777";
        let listener = match TcpListener::bind(addr).await { 
            Ok(l) => l, 
            Err(e) => { 
                eprintln!("❌ Erro WebSocket: {}", e); 
                return; 
            } 
        };
        println!("🟢 WebSocket rodando em ws://{}", addr);
        while let Ok((stream, peer)) = listener.accept().await {
            let state = app_state.clone();
            let handle = app_handle.clone();
            let clients = clients.clone();
            tauri::async_runtime::spawn(async move { 
                handle_ws_connection(stream, peer, state, handle, clients).await; 
            });
        }
    });
}

async fn handle_ws_connection(
    stream: tokio::net::TcpStream, 
    peer: SocketAddr, 
    app_state: SharedState, 
    app_handle: tauri::AppHandle,
    clients: Arc<WsClients>,
) {
    match tokio_tungstenite::accept_async(stream).await {
        Ok(ws_stream) => {
            println!("🔗 Tablet conectado: {}", peer);
            let (ws_sender, mut receiver) = ws_stream.split();
            
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            clients.add(tx);
            
            let sender = Arc::new(tokio::sync::Mutex::new(ws_sender));
            let sender_clone = sender.clone();
            
            let send_task = tauri::async_runtime::spawn(async move {
                while let Some(msg) = rx.recv().await {
                    let mut s = sender_clone.lock().await;
                    if s.send(Message::Text(msg)).await.is_err() {
                        break;
                    }
                }
            });

            {
                let state = app_state.read().await;
                let slides = build_slides_json(&state.slides, &app_handle);
                let msg = serde_json::json!({ 
                    "type": "state", 
                    "slides": slides, 
                    "current_index": state.current_slide_index, 
                    "is_blackout": state.is_blackout 
                }).to_string();
                let mut s = sender.lock().await;
                let _ = s.send(Message::Text(msg)).await;
                
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_millis() as u64;
                
                let current_ms = if state.timer.running {
                    state.timer.accumulated + (now - state.timer.start_time)
                } else {
                    state.timer.accumulated
                };
                
                let timer_msg = serde_json::json!({
                    "type": "timer_state",
                    "running": state.timer.running,
                    "accumulated": current_ms,
                    "start_time": state.timer.start_time,
                }).to_string();
                let _ = s.send(Message::Text(timer_msg)).await;
            }

            while let Some(msg_result) = receiver.next().await {
                match msg_result {
                    Ok(Message::Text(text)) => {
                        if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(&text) {
                            let mut st = app_state.write().await;
                            let action = cmd["action"].as_str().unwrap_or("");
                            
                            match action {
                                "set_slide" => {
                                    if let Some(idx) = cmd["index"].as_u64() { 
                                        st.current_slide_index = idx as usize; 
                                        st.is_blackout = false;
                                        drop(st);
                                        let _ = switch_to_sistema_internal(&app_handle).await;
                                        st = app_state.write().await;
                                    }
                                },
                                "blackout" => {
                                    st.is_blackout = true;
                                    drop(st);
                                    let _ = switch_to_jw_library_internal(&app_handle).await;
                                    st = app_state.write().await;
                                },
                                "show" => {
                                    st.is_blackout = false;
                                    drop(st);
                                    let _ = switch_to_sistema_internal(&app_handle).await;
                                    st = app_state.write().await;
                                },
                                "timer_control" => {
                                    if let Some(timer_action) = cmd["timer_action"].as_str() {
                                        let now = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap()
                                            .as_millis() as u64;
                                        
                                        match timer_action {
                                            "start" => {
                                                if !st.timer.running {
                                                    st.timer.running = true;
                                                    st.timer.start_time = now;
                                                }
                                            }
                                            "pause" => {
                                                if st.timer.running {
                                                    st.timer.running = false;
                                                    st.timer.accumulated += now - st.timer.start_time;
                                                }
                                            }
                                            "reset" => {
                                                st.timer.running = false;
                                                st.timer.accumulated = 0;
                                                st.timer.start_time = 0;
                                            }
                                            _ => {}
                                        }
                                        
                                        let current_ms = if st.timer.running {
                                            st.timer.accumulated + (now - st.timer.start_time)
                                        } else {
                                            st.timer.accumulated
                                        };
                                        
                                        let timer_msg = serde_json::json!({
                                            "type": "timer_state",
                                            "running": st.timer.running,
                                            "accumulated": current_ms,
                                            "start_time": st.timer.start_time,
                                        }).to_string();
                                        
                                        let mut s = sender.lock().await;
                                        let _ = s.send(Message::Text(timer_msg)).await;
                                        
                                        let timer_state = serde_json::json!({
                                            "running": st.timer.running,
                                            "accumulated": current_ms,
                                            "start_time": st.timer.start_time,
                                        });
                                        drop(st);
                                        app_handle.emit("timer-update", &timer_state).ok();
                                        st = app_state.write().await;
                                    }
                                }
                                "request_water" => {
                                    let now = SystemTime::now()
                                        .duration_since(UNIX_EPOCH)
                                        .unwrap()
                                        .as_secs();
                                    
                                    let request = WaterRequest {
                                        id: uuid::Uuid::new_v4().to_string(),
                                        timestamp: now,
                                        acknowledged: false,
                                    };
                                    
                                    st.water_requests.push(request.clone());
                                    
                                    let mut s = sender.lock().await;
                                    let _ = s.send(Message::Text(serde_json::json!({
                                        "type": "water_request_sent"
                                    }).to_string())).await;
                                    
                                    drop(st);
                                    app_handle.emit("water-request", &request).ok();
                                    st = app_state.write().await;
                                }
                                "request_indicator" => {
                                    if st.indicator_request.as_ref().map_or(true, |r| r.acknowledged) {
                                        let now = SystemTime::now()
                                            .duration_since(UNIX_EPOCH)
                                            .unwrap()
                                            .as_secs();
                                        
                                        let request = IndicatorRequest {
                                            timestamp: now,
                                            acknowledged: false,
                                        };
                                        
                                        st.indicator_request = Some(request.clone());
                                        
                                        let mut s = sender.lock().await;
                                        let _ = s.send(Message::Text(serde_json::json!({
                                            "type": "indicator_request_sent"
                                        }).to_string())).await;
                                        
                                        drop(st);
                                        app_handle.emit("indicator-request", &request).ok();
                                        st = app_state.write().await;
                                    } else {
                                        let mut s = sender.lock().await;
                                        let _ = s.send(Message::Text(serde_json::json!({
                                            "type": "indicator_request_pending"
                                        }).to_string())).await;
                                    }
                                }
                                "acknowledge_message" => {
                                    if let Some(ref mut msg) = st.operator_message {
                                        msg.acknowledged = true;
                                        
                                        let mut s = sender.lock().await;
                                        let _ = s.send(Message::Text(serde_json::json!({
                                            "type": "message_acknowledged"
                                        }).to_string())).await;
                                        
                                        drop(st);
                                        app_handle.emit("operator-message-acknowledged", true).ok();
                                        st = app_state.write().await;
                                        st.operator_message = None;
                                    }
                                }
                                "refresh" => {},
                                _ => {}
                            }

                            let response = {
                                let slides = build_slides_json(&st.slides, &app_handle);
                                serde_json::json!({ 
                                    "type": "state", 
                                    "slides": slides, 
                                    "current_index": st.current_slide_index, 
                                    "is_blackout": st.is_blackout 
                                }).to_string()
                            };
                            let mut s = sender.lock().await;
                            let _ = s.send(Message::Text(response)).await;
                        }
                    },
                    Ok(Message::Close(_)) => break,
                    Ok(Message::Ping(data)) => { 
                        let mut s = sender.lock().await;
                        let _ = s.send(Message::Pong(data)).await; 
                    },
                    Err(_) => break,
                    _ => {}
                }
            }
            
            send_task.abort();
            println!("🔴 Tablet desconectado: {}", peer);
        },
        Err(e) => { eprintln!("❌ Erro ao aceitar: {}", e); }
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
    let window = WebviewWindowBuilder::new(app_handle, "display", tauri::WebviewUrl::App("/display".into()))
        .title("Tela de Exibição")
        .inner_size(800.0, 600.0)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    
    if let Ok(monitors) = window.available_monitors() {
        let target = if monitors.len() > 1 { &monitors[1] } else { &monitors[0] };
        window.set_position(tauri::PhysicalPosition::new(target.position().x, target.position().y)).map_err(|e| e.to_string())?;
        window.set_size(tauri::PhysicalSize::new(target.size().width, target.size().height)).map_err(|e| e.to_string())?;
    }
    window.set_always_on_top(true).map_err(|e| e.to_string())?; 
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?; 
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(RustEmbed)]
#[folder = "../dist/"]
struct StaticAssets;

fn start_http_control_server(app_state: SharedState, app_handle: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state_filter = warp::any().map(move || app_state.clone());
        let handle_filter = warp::any().map(move || app_handle.clone());
        
        let get_state = warp::path!("api" / "state")
            .and(warp::get())
            .and(state_filter.clone())
            .and_then(|state: SharedState| async move {
                let app_state = state.read().await;
                let json = serde_json::json!({
                    "current_slide_index": app_state.current_slide_index,
                    "is_blackout": app_state.is_blackout,
                    "slides": app_state.slides.iter().map(|s| {
                        serde_json::json!({
                            "id": s.id,
                            "filename": s.filename,
                            "order": s.order
                        })
                    }).collect::<Vec<_>>()
                });
                Ok::<_, warp::Rejection>(warp::reply::json(&json))
            });
        
        let post_command = warp::path!("api" / "command")
            .and(warp::post())
            .and(warp::body::json())
            .and(state_filter.clone())
            .and(handle_filter.clone())
            .and_then(|cmd: serde_json::Value, state: SharedState, handle: tauri::AppHandle| async move {
                let mut app_state = state.write().await;
                let action = cmd["action"].as_str().unwrap_or("");
                
                match action {
                    "set_slide" => {
                        if let Some(idx) = cmd["index"].as_u64() {
                            app_state.current_slide_index = idx as usize;
                            app_state.is_blackout = false;
                            drop(app_state);
                            let _ = switch_to_sistema_internal(&handle).await;
                        }
                    },
                    "blackout" => {
                        app_state.is_blackout = true;
                        drop(app_state);
                        let _ = switch_to_jw_library_internal(&handle).await;
                    },
                    "show" => {
                        app_state.is_blackout = false;
                        drop(app_state);
                        let _ = switch_to_sistema_internal(&handle).await;
                    },
                    _ => {}
                }
                Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({"status": "ok"})))
            });
        
        // NOVO: Servir imagens via HTTP
        let serve_image = warp::path!("images" / String)
            .and(warp::get())
            .and(handle_filter.clone())
            .and_then(|filename: String, handle: tauri::AppHandle| async move {
                let app_dir = handle.path().app_data_dir()
                    .map_err(|_| warp::reject::not_found())?;
                let image_path = app_dir.join("images").join(&filename);
                
                if let Ok(bytes) = fs::read(&image_path) {
                    let mime = from_path(&image_path).first_or_octet_stream();
                    Ok::<_, warp::Rejection>(warp::http::Response::builder()
                        .header("Content-Type", mime.as_ref())
                        .header("Cache-Control", "public, max-age=3600")
                        .body(bytes)
                        .unwrap())
                } else {
                    Err(warp::reject::not_found())
                }
            });
        
        // NOVO: Servir thumbnails via HTTP
        let serve_thumbnail = warp::path!("thumbnails" / String)
            .and(warp::get())
            .and(handle_filter.clone())
            .and_then(|filename: String, handle: tauri::AppHandle| async move {
                let app_dir = handle.path().app_data_dir()
                    .map_err(|_| warp::reject::not_found())?;
                let thumb_path = app_dir.join("thumbnails").join(&filename);
                
                if let Ok(bytes) = fs::read(&thumb_path) {
                    let mime = from_path(&thumb_path).first_or_octet_stream();
                    Ok::<_, warp::Rejection>(warp::http::Response::builder()
                        .header("Content-Type", mime.as_ref())
                        .header("Cache-Control", "public, max-age=3600")
                        .body(bytes)
                        .unwrap())
                } else {
                    Err(warp::reject::not_found())
                }
            });
        
        let static_files = warp::any()
            .and(warp::path::full())
            .and_then(|path: warp::path::FullPath| async move {
                let path = path.as_str().trim_start_matches('/');
                let path = if path.is_empty() { "index.html" } else { path };
                
                match StaticAssets::get(path) {
                    Some(content) => {
                        let mime = from_path(path).first_or_octet_stream();
                        let bytes: Vec<u8> = content.data.into_owned();
                        Ok::<_, warp::Rejection>(warp::reply::with_header(
                            bytes,
                            "Content-Type",
                            mime.as_ref(),
                        ))
                    },
                    None => {
                        match StaticAssets::get("index.html") {
                            Some(content) => {
                                let bytes: Vec<u8> = content.data.into_owned();
                                Ok(warp::reply::with_header(
                                    bytes,
                                    "Content-Type",
                                    "text/html",
                                ))
                            },
                            None => Err(warp::reject::not_found()),
                        }
                    }
                }
            });
        
        let cors = warp::cors()
            .allow_any_origin()
            .allow_methods(vec!["GET", "POST"])
            .allow_headers(vec!["Content-Type"]);
        
        // Rotas: API primeiro, depois imagens, depois arquivos estáticos
        let routes = get_state
            .or(post_command)
            .or(serve_image)
            .or(serve_thumbnail)
            .or(static_files)
            .with(cors);
        
        println!("🌐 Servidor HTTP rodando em http://0.0.0.0:20778");
        warp::serve(routes).run(([0, 0, 0, 0], 20778)).await;
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = load_state_from_disk(&app.handle());
            let shared_state: SharedState = Arc::new(RwLock::new(state));
            let clients = Arc::new(WsClients::new());
            
            app.manage(shared_state.clone());
            app.manage(clients.clone());
            
            start_ws_server(shared_state.clone(), app.handle().clone(), clients);
            start_http_control_server(shared_state.clone(), app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir, get_app_state, upload_images_direct, get_all_slides,
            delete_slide, get_image_base64, get_default_image, set_current_slide,
            set_blackout, get_display_state, show_display_window,
            switch_to_jw_library, switch_to_sistema, get_monitors,
            set_texto_do_ano, get_texto_do_ano_path, reset_texto_do_ano,
            timer_control, get_timer_state,
            request_water, acknowledge_water_request, get_water_requests,
            request_indicator, acknowledge_indicator_request, get_indicator_request,
            send_operator_message, acknowledge_operator_message, get_operator_message
        ])
        .run(tauri::generate_context!())
        .expect("erro");
}