mod state;

use state::*;
use std::fs;
use std::io::Cursor;
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
use rusqlite::Connection;
use std::collections::HashMap;
use chrono::Timelike;
use local_ip_address::local_ip;
use warp::Buf;
use tokio::io::{BufReader, AsyncBufReadExt};
use tokio::time::timeout;
use std::time::Duration;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::Mutex as TokioMutex;

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

pub struct ZoomBotProcess {
    pub process: Arc<TokioMutex<Option<tokio::process::Child>>>,
    pub connected: Arc<AtomicBool>,
    pub raised_hands: Arc<TokioMutex<Vec<ZoomRaisedHand>>>,
    pub error: Arc<TokioMutex<Option<String>>>,
    pub config: Arc<TokioMutex<ZoomBotConfig>>,
    pub should_stop: Arc<AtomicBool>,
}

impl ZoomBotProcess {
    pub fn new() -> Self {
        Self {
            process: Arc::new(TokioMutex::new(None)),
            connected: Arc::new(AtomicBool::new(false)),
            raised_hands: Arc::new(TokioMutex::new(Vec::new())),
            error: Arc::new(TokioMutex::new(None)),
            config: Arc::new(TokioMutex::new(ZoomBotConfig::default())),
            should_stop: Arc::new(AtomicBool::new(false)),
        }
    }
}

struct UploadSession {
    token: String,
    presentation_name: String,
}

struct UploadSessions {
    sessions: Mutex<HashMap<String, UploadSession>>,
}

impl UploadSessions {
    fn new() -> Self { Self { sessions: Mutex::new(HashMap::new()) } }
}

fn get_local_ip() -> String {
    local_ip().map(|ip| ip.to_string()).unwrap_or_else(|_| "127.0.0.1".to_string())
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

fn get_active_slides(state: &AppState) -> Vec<Slide> {
    if let Some(active_id) = &state.active_presentation_id {
        if let Some(pres) = state.presentations.iter().find(|p| &p.id == active_id) {
            return pres.slides.clone();
        }
    }
    Vec::new()
}

// Constantes para extensões de mídia
const IMG_EXTS: &[&str] = &["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];
const VIDEO_EXTS: &[&str] = &["mp4", "mov", "m4v", "webm", "avi", "mkv"];

fn is_media_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_lowercase();
    IMG_EXTS.contains(&ext.as_str()) || VIDEO_EXTS.contains(&ext.as_str())
}

fn is_image_ext(ext: &str) -> bool {
    let ext = ext.trim_start_matches('.').to_lowercase();
    IMG_EXTS.contains(&ext.as_str())
}

fn is_thumbnail_name(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    let name = std::path::Path::new(&path_lower)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    
    path_lower.contains("thumbnail") 
        || path_lower.contains("thumb") 
        || path_lower.contains("poster") 
        || path_lower.contains("cover") 
        || path_lower.contains("capa") 
        || name.starts_with("default_thumbnail")
}

fn extract_zip_to_temp(zip_data: &[u8], app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = get_data_dir(app_handle);
    let temp_dir = app_dir.join("jw_temp").join(uuid::Uuid::new_v4().to_string());
    fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    
    let cursor = Cursor::new(zip_data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Erro ao abrir ZIP: {}", e))?;
    
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Erro ao ler arquivo do ZIP: {}", e))?;
        let out_path = temp_dir.join(file.name());
        
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out_file = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out_file).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(temp_dir)
}

fn find_user_db(temp_dir: &PathBuf) -> Option<PathBuf> {
    let candidates = vec![
        temp_dir.join("userData.db"),
        temp_dir.join("userdata.db"),
    ];
    
    for c in candidates {
        if c.exists() {
            return Some(c);
        }
    }
    
    find_user_db_recursive(temp_dir)
}

fn find_user_db_recursive(dir: &PathBuf) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.to_lowercase() == "userdata.db") {
                return Some(path);
            } else if path.is_dir() {
                if let Some(found) = find_user_db_recursive(&path) {
                    return Some(found);
                }
            }
        }
    }
    None
}

#[derive(Debug)]
struct PlaylistItem {
    playlist_item_id: i64,
    label: String,
    thumbnail_file_path: String,
    original_filename: String,
    file_path: String,
    mime_type: String,
}

fn extract_media_from_db(db_path: &PathBuf) -> Result<Vec<PlaylistItem>, String> {
    let conn = Connection::open(db_path).map_err(|e| format!("Erro ao abrir banco de dados: {}", e))?;
    
    let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .map_err(|e| format!("Erro ao consultar tabelas: {}", e))?;
    let tables: Vec<String> = stmt.query_map([], |row| row.get(0))
        .map_err(|e| format!("Erro ao mapear tabelas: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
    
    let required = vec!["PlaylistItem", "PlaylistItemIndependentMediaMap", "IndependentMedia"];
    let has_all = required.iter().all(|r| tables.iter().any(|t| t == *r));
    
    if !has_all {
        return Ok(Vec::new());
    }
    
    let has_thumbnail = {
        let mut stmt = conn.prepare("PRAGMA table_info(PlaylistItem)")
            .map_err(|_| false).unwrap_or_else(|_| panic!());
        let cols: Vec<String> = stmt.query_map([], |row| row.get(1))
            .unwrap_or_else(|_| panic!())
            .filter_map(|r| r.ok())
            .collect();
        cols.contains(&"ThumbnailFilePath".to_string())
    };
    
    let query = if has_thumbnail {
        "SELECT pi.PlaylistItemId, pi.Label, pi.ThumbnailFilePath, im.OriginalFilename, im.FilePath, im.MimeType 
         FROM PlaylistItem pi 
         JOIN PlaylistItemIndependentMediaMap pim ON pim.PlaylistItemId = pi.PlaylistItemId 
         JOIN IndependentMedia im ON im.IndependentMediaId = pim.IndependentMediaId 
         ORDER BY pi.PlaylistItemId ASC, im.IndependentMediaId ASC"
    } else {
        "SELECT pi.PlaylistItemId, pi.Label, '' as ThumbnailFilePath, im.OriginalFilename, im.FilePath, im.MimeType 
         FROM PlaylistItem pi 
         JOIN PlaylistItemIndependentMediaMap pim ON pim.PlaylistItemId = pi.PlaylistItemId 
         JOIN IndependentMedia im ON im.IndependentMediaId = pim.IndependentMediaId 
         ORDER BY pi.PlaylistItemId ASC, im.IndependentMediaId ASC"
    };
    
    let mut stmt = conn.prepare(query)
        .map_err(|e| format!("Erro ao preparar consulta: {}", e))?;
    
    let items = stmt.query_map([], |row| {
        Ok(PlaylistItem {
            playlist_item_id: row.get(0)?,
            label: row.get::<_, String>(1).unwrap_or_default(),
            thumbnail_file_path: row.get::<_, String>(2).unwrap_or_default(),
            original_filename: row.get::<_, String>(3).unwrap_or_default(),
            file_path: row.get::<_, String>(4).unwrap_or_default(),
            mime_type: row.get::<_, String>(5).unwrap_or_default(),
        })
    }).map_err(|e| format!("Erro ao executar consulta: {}", e))?;
    
    let mut result = Vec::new();
    for item in items {
        if let Ok(item) = item {
            result.push(item);
        }
    }
    
    Ok(result)
}

fn find_file_in_dir(dir: &PathBuf, rel_path: &str) -> Option<PathBuf> {
    let rel_path = rel_path.replace('\\', "/").trim_start_matches('/').to_string();
    let direct = dir.join(&rel_path);
    
    if direct.exists() && direct.is_file() {
        return Some(direct);
    }
    
    let file_name = std::path::Path::new(&rel_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();
    
    find_file_recursive(dir, &file_name)
}

fn find_file_recursive(dir: &PathBuf, file_name: &str) -> Option<PathBuf> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() && path.file_name().and_then(|n| n.to_str()) == Some(file_name) {
                return Some(path);
            } else if path.is_dir() {
                if let Some(found) = find_file_recursive(&path, file_name) {
                    return Some(found);
                }
            }
        }
    }
    None
}

fn get_image_resolution(path: &PathBuf) -> (u32, u32, u64) {
    if let Ok(img) = image::open(path) {
        let (w, h) = img.dimensions();
        (w, h, (w as u64) * (h as u64))
    } else {
        (0, 0, 0)
    }
}

fn is_thumbnail_by_resolution(path: &PathBuf, min_side: u32, min_pixels: u64) -> bool {
    let (w, h, px) = get_image_resolution(path);
    if w == 0 || h == 0 {
        return false;
    }
    w.min(h) < min_side || px < min_pixels
}

fn copy_media_fallback(dir: &PathBuf, result: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if is_media_ext(ext) && !is_thumbnail_name(&path.to_string_lossy()) {
                        if is_image_ext(ext) && is_thumbnail_by_resolution(&path, 300, 120000) {
                            continue;
                        }
                        result.push(path);
                    }
                }
            } else if path.is_dir() {
                copy_media_fallback(&path, result);
            }
        }
    }
}

#[tauri::command]
async fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    Ok(app_handle.path().app_data_dir().map_err(|e| e.to_string())?.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_app_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    serde_json::to_string(&*state.read().await).map_err(|e| e.to_string())
}

// COMANDOS DE APRESENTAÇÃO

#[tauri::command]
async fn create_presentation(
    name: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let mut app_state = state.write().await;
    let id = uuid::Uuid::new_v4().to_string();
    
    app_state.presentations.push(Presentation {
        id: id.clone(),
        name,
        slides: Vec::new(),
        active: false,
    });
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(id)
}

#[tauri::command]
async fn delete_presentation(
    presentation_id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    
    if let Some(pres) = app_state.presentations.iter().find(|p| p.id == presentation_id) {
        for slide in &pres.slides {
            let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
            let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
        }
    }
    
    if app_state.active_presentation_id.as_ref() == Some(&presentation_id) {
        app_state.active_presentation_id = None;
        app_state.current_slide_index = 0;
    }
    
    app_state.presentations.retain(|p| p.id != presentation_id);
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn set_active_presentation(
    presentation_id: Option<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    
    for pres in &mut app_state.presentations {
        pres.active = false;
    }
    
    if let Some(ref id) = presentation_id {
        if let Some(pres) = app_state.presentations.iter_mut().find(|p| &p.id == id) {
            pres.active = true;
            app_state.active_presentation_id = Some(id.clone());
        } else {
            return Err("Apresentação não encontrada".to_string());
        }
    } else {
        app_state.active_presentation_id = None;
    }
    
    app_state.current_slide_index = 0;
    app_state.is_blackout = true;
    
    save_state_to_disk(&app_state, &app_handle);
    
    let active_slides = get_active_slides(&app_state);
    let msg = serde_json::json!({
        "type": "state",
        "slides": build_slides_json(&active_slides, &app_handle),
        "current_index": app_state.current_slide_index,
        "is_blackout": app_state.is_blackout,
        "active_presentation_id": app_state.active_presentation_id,
    }).to_string();
    ws_clients.broadcast(msg);
    
    Ok(())
}

#[tauri::command]
async fn get_presentations(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.presentations).map_err(|e| e.to_string())
}

#[tauri::command]
async fn upload_images_to_presentation(
    presentation_id: String,
    file_paths: Vec<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
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
            
            let optimized_img = if width > 1920 || height > 1080 {
                let aspect_ratio = width as f32 / height as f32;
                let new_height = 1080u32;
                let new_width = (new_height as f32 * aspect_ratio) as u32;
                img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3)
            } else {
                img
            };
            
            let _ = optimized_img.save_with_format(&dest_path, ImageFormat::Jpeg);
            
            let thumb = optimized_img.resize_exact(400, 300, image::imageops::FilterType::Lanczos3);
            let _ = thumb.save_with_format(&thumb_path, ImageFormat::Jpeg);
        } else {
            let _ = fs::copy(&original_path, &dest_path);
            let _ = fs::copy(&original_path, &thumb_path);
        }
        
        new_slides.push((uuid::Uuid::new_v4().to_string(), new_filename));
    }
    
    let mut app_state = state.write().await;
    
    if let Some(pres) = app_state.presentations.iter_mut().find(|p| p.id == presentation_id) {
        let start_order = pres.slides.len();
        for (i, (id, filename)) in new_slides.into_iter().enumerate() {
            pres.slides.push(Slide { id, filename, order: start_order + i });
        }
        
        if pres.active {
            let active_slides = get_active_slides(&app_state);
            let msg = serde_json::json!({
                "type": "state",
                "slides": build_slides_json(&active_slides, &app_handle),
                "current_index": app_state.current_slide_index,
                "is_blackout": app_state.is_blackout,
                "active_presentation_id": app_state.active_presentation_id,
            }).to_string();
            ws_clients.broadcast(msg);
        }
    } else {
        return Err("Apresentação não encontrada".to_string());
    }
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn delete_slide_from_presentation(
    presentation_id: String,
    slide_id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    
    if let Some(pres) = app_state.presentations.iter_mut().find(|p| p.id == presentation_id) {
        if let Some(slide) = pres.slides.iter().find(|s| s.id == slide_id) {
            let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
            let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
        }
        
        pres.slides.retain(|s| s.id != slide_id);
        for (i, slide) in pres.slides.iter_mut().enumerate() { 
            slide.order = i; 
        }
    }
    
    let needs_update = if let Some(pres) = app_state.presentations.iter().find(|p| p.id == presentation_id) {
        pres.active && app_state.current_slide_index >= pres.slides.len()
    } else {
        false
    };
    
    if needs_update {
        app_state.current_slide_index = if let Some(pres) = app_state.presentations.iter().find(|p| p.id == presentation_id) {
            if pres.slides.is_empty() { 0 } else { pres.slides.len() - 1 }
        } else {
            0
        };
    }
    
    let is_active = app_state.presentations.iter()
        .find(|p| p.id == presentation_id)
        .map(|p| p.active)
        .unwrap_or(false);
    
    if is_active {
        let active_slides = get_active_slides(&app_state);
        let msg = serde_json::json!({
            "type": "state",
            "slides": build_slides_json(&active_slides, &app_handle),
            "current_index": app_state.current_slide_index,
            "is_blackout": app_state.is_blackout,
            "active_presentation_id": app_state.active_presentation_id,
        }).to_string();
        ws_clients.broadcast(msg);
    }
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

// COMANDO DE IMPORTAÇÃO JW PLAYLIST

#[tauri::command]
async fn extract_jw_playlist(
    file_path: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    
    let zip_data = fs::read(&file_path).map_err(|e| format!("Erro ao ler arquivo: {}", e))?;
    
    let temp_dir = extract_zip_to_temp(&zip_data, &app_handle)?;
    
    let db_path = find_user_db(&temp_dir);
    
    let images_dir = app_dir.join("images");
    let thumbs_dir = app_dir.join("thumbnails");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    
    let min_side = 300u32;
    let min_pixels = 120000u64;
    
    let mut app_state = state.write().await;
    
    let presentation_name = PathBuf::from(&file_path)
        .file_stem()
        .and_then(|n| n.to_str())
        .unwrap_or("Apresentação JW")
        .to_string();
    
    let presentation_id = uuid::Uuid::new_v4().to_string();
    
    let mut new_slides = Vec::new();
    
    if let Some(db_path) = db_path {
        if let Ok(items) = extract_media_from_db(&db_path) {
            let mut grouped: HashMap<i64, Vec<&PlaylistItem>> = HashMap::new();
            
            for item in &items {
                let file_path_normalized = item.file_path.replace('\\', "/").trim_start_matches('/').to_string();
                let thumb_normalized = item.thumbnail_file_path.replace('\\', "/").trim_start_matches('/').to_string();
                
                if !thumb_normalized.is_empty() && file_path_normalized == thumb_normalized {
                    continue;
                }
                
                if is_thumbnail_name(&item.file_path) || is_thumbnail_name(&item.original_filename) {
                    continue;
                }
                
                if let Some(src_path) = find_file_in_dir(&temp_dir, &item.file_path) {
                    let ext = src_path.extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("jpg");
                    
                    if !is_media_ext(ext) {
                        continue;
                    }
                    
                    if is_image_ext(ext) && is_thumbnail_by_resolution(&src_path, min_side, min_pixels) {
                        continue;
                    }
                    
                    grouped.entry(item.playlist_item_id)
                        .or_insert_with(Vec::new)
                        .push(item);
                }
            }
            
            let mut ordered_ids: Vec<i64> = grouped.keys().cloned().collect();
            ordered_ids.sort();
            
            for id in ordered_ids {
                if let Some(items) = grouped.get(&id) {
                    if let Some(item) = items.first() {
                        if let Some(src_path) = find_file_in_dir(&temp_dir, &item.file_path) {
                            let ext = src_path.extension()
                                .and_then(|e| e.to_str())
                                .unwrap_or("jpg");
                            
                            let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
                            let dest_path = images_dir.join(&new_filename);
                            let thumb_path = thumbs_dir.join(&new_filename);
                            
                            if let Ok(img) = image::open(&src_path) {
                                let (width, height) = img.dimensions();
                                let optimized = if width > 1920 || height > 1080 {
                                    let aspect = width as f32 / height as f32;
                                    let new_h = 1080u32;
                                    let new_w = (new_h as f32 * aspect) as u32;
                                    img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
                                } else {
                                    img
                                };
                                let _ = optimized.save_with_format(&dest_path, image::ImageFormat::Jpeg);
                                let thumb = optimized.resize_exact(400, 300, image::imageops::FilterType::Lanczos3);
                                let _ = thumb.save_with_format(&thumb_path, image::ImageFormat::Jpeg);
                            } else {
                                fs::copy(&src_path, &dest_path).ok();
                                fs::copy(&src_path, &thumb_path).ok();
                            }
                            
                            new_slides.push(Slide {
                                id: uuid::Uuid::new_v4().to_string(),
                                filename: new_filename,
                                order: new_slides.len(),
                            });
                        }
                    }
                }
            }
        }
    } else {
        let mut all_media = Vec::new();
        copy_media_fallback(&temp_dir, &mut all_media);
        
        for src_path in &all_media {
            let ext = src_path.extension()
                .and_then(|e| e.to_str())
                .unwrap_or("jpg");
            
            let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
            let dest_path = images_dir.join(&new_filename);
            let thumb_path = thumbs_dir.join(&new_filename);
            
            if let Ok(img) = image::open(src_path) {
                let (width, height) = img.dimensions();
                let optimized = if width > 1920 || height > 1080 {
                    let aspect = width as f32 / height as f32;
                    let new_h = 1080u32;
                    let new_w = (new_h as f32 * aspect) as u32;
                    img.resize_exact(new_w, new_h, image::imageops::FilterType::Lanczos3)
                } else {
                    img
                };
                let _ = optimized.save_with_format(&dest_path, image::ImageFormat::Jpeg);
                let thumb = optimized.resize_exact(400, 300, image::imageops::FilterType::Lanczos3);
                let _ = thumb.save_with_format(&thumb_path, image::ImageFormat::Jpeg);
            } else {
                fs::copy(src_path, &dest_path).ok();
                fs::copy(src_path, &thumb_path).ok();
            }
            
            new_slides.push(Slide {
                id: uuid::Uuid::new_v4().to_string(),
                filename: new_filename,
                order: new_slides.len(),
            });
        }
    }
    
    app_state.presentations.push(Presentation {
        id: presentation_id.clone(),
        name: presentation_name,
        slides: new_slides,
        active: false,
    });
    
    let _ = fs::remove_dir_all(&temp_dir);
    
    save_state_to_disk(&app_state, &app_handle);
    
    Ok(presentation_id)
}

// COMANDOS DE IMAGEM (mantidos para compatibilidade)

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
            
            let optimized_img = if width > 1920 || height > 1080 {
                let aspect_ratio = width as f32 / height as f32;
                let new_height = 1080u32;
                let new_width = (new_height as f32 * aspect_ratio) as u32;
                img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3)
            } else {
                img
            };
            
            let _ = optimized_img.save_with_format(&dest_path, ImageFormat::Jpeg);
            
            let thumb = optimized_img.resize_exact(400, 300, image::imageops::FilterType::Lanczos3);
            let _ = thumb.save_with_format(&thumb_path, ImageFormat::Jpeg);
        } else {
            let _ = fs::copy(&original_path, &dest_path);
            let _ = fs::copy(&original_path, &thumb_path);
        }
        
        new_slides.push((uuid::Uuid::new_v4().to_string(), new_filename));
    }
    
    let mut app_state = state.write().await;
    
    if app_state.presentations.is_empty() {
        app_state.presentations.push(Presentation {
            id: uuid::Uuid::new_v4().to_string(),
            name: "Apresentação Padrão".to_string(),
            slides: Vec::new(),
            active: false,
        });
    }
    
    if let Some(pres) = app_state.presentations.first_mut() {
        let start_order = pres.slides.len();
        for (i, (id, filename)) in new_slides.into_iter().enumerate() {
            pres.slides.push(Slide { id, filename, order: start_order + i });
        }
    }
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn get_all_slides(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    let active_slides = get_active_slides(&app_state);
    serde_json::to_string(&active_slides).map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_slide(slide_id: String, state: tauri::State<'_, SharedState>, app_handle: tauri::AppHandle) -> Result<(), String> {
    let app_dir = app_handle.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut app_state = state.write().await;
    
    for pres in &mut app_state.presentations {
        if let Some(slide) = pres.slides.iter().find(|s| s.id == slide_id) {
            let _ = fs::remove_file(app_dir.join("images").join(&slide.filename));
            let _ = fs::remove_file(app_dir.join("thumbnails").join(&slide.filename));
        }
        pres.slides.retain(|s| s.id != slide_id);
        for (i, slide) in pres.slides.iter_mut().enumerate() { 
            slide.order = i; 
        }
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
    let active_slides = get_active_slides(&app_state);
    let s = active_slides.get(app_state.current_slide_index);
    let data = serde_json::json!({
        "current_index": app_state.current_slide_index,
        "total_slides": active_slides.len(),
        "is_blackout": app_state.is_blackout,
        "current_filename": s.map(|s| s.filename.clone()),
        "active_presentation_id": app_state.active_presentation_id,
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

// COMANDOS DO TIMER

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

// COMANDOS DE ÁGUA

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

// COMANDOS DE INDICADOR

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

// COMANDOS DE MENSAGEM

#[tauri::command]
async fn send_operator_message(
    text: String,
    response_options: Vec<String>,
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
        response_options, // ✅
        selected_response: None, // ✅
    };
    
    app_state.operator_message = Some(message.clone());
    app_handle.emit("operator-message-sent", &message).map_err(|e| e.to_string())?;
    
    let ws_msg = serde_json::json!({
        "type": "operator_message",
        "id": message.id,
        "text": message.text,
        "timestamp": message.timestamp,
        "response_options": message.response_options, 
    }).to_string();
    ws_clients.broadcast(ws_msg);
    
    Ok(())
}

#[tauri::command]
async fn acknowledge_operator_message(
    selected_response: Option<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(ref mut msg) = app_state.operator_message {
        msg.acknowledged = true;
        msg.selected_response = selected_response;
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

// FUNÇÕES DE SISTEMA

async fn switch_to_jw_library_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let countdown_running = {
        if let Some(state) = app_handle.try_state::<SharedState>() {
            let state = state.read().await;
            state.countdown.running
        } else {
            false
        }
    };
    
    if !countdown_running {
        if let Some(w) = app_handle.get_webview_window("display") {
            // w.set_always_on_top(false).ok();
            w.hide().ok();
        }
        
        std::process::Command::new("powershell")
            .args(&["-NoProfile", "-WindowStyle", "Hidden", "-Command", 
                "$wshell = New-Object -ComObject WScript.Shell;",
                "$wshell.AppActivate('JW Library');"
            ])
            .spawn().ok();
        
        app_handle.emit("switch-app", "jw").ok(); // ✅ Só emite "jw" se NÃO tem cronômetro
    } else {
        show_display_window_internal(app_handle).await.ok();
        app_handle.emit("switch-app", "sistema").ok(); // ✅ Emite "sistema" se tem cronômetro
    }
    
    Ok(())
}

async fn switch_to_sistema_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    show_display_window_internal(app_handle).await?;
    app_handle.emit("switch-app", "sistema").ok();
    Ok(())
}

// WEBSOCKET SERVER

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
                let active_slides = get_active_slides(&state);
                let slides = build_slides_json(&active_slides, &app_handle);
                let msg = serde_json::json!({ 
                    "type": "state", 
                    "slides": slides, 
                    "current_index": state.current_slide_index, 
                    "is_blackout": state.is_blackout,
                    "active_presentation_id": state.active_presentation_id,
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
                
                if let Some(ref msg) = state.operator_message {
                    if !msg.acknowledged {
                        let op_msg = serde_json::json!({
                            "type": "operator_message",
                            "id": msg.id,
                            "text": msg.text,
                            "timestamp": msg.timestamp,
                            "response_options": msg.response_options, // ✅
                        }).to_string();
                        let _ = s.send(Message::Text(op_msg)).await;
                    }
                }
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
                                        let selected = cmd["response"].as_str().map(|s| s.to_string());
                                        msg.acknowledged = true;
                                        msg.selected_response = selected.clone();
                                        
                                        let mut s = sender.lock().await;
                                        let _ = s.send(Message::Text(serde_json::json!({
                                            "type": "message_acknowledged",
                                            "response": selected.clone()
                                        }).to_string())).await;
                                        
                                        drop(st);
                                        // ✅ Emitir objeto com a resposta
                                        app_handle.emit("operator-message-acknowledged", &serde_json::json!({
                                            "response": selected
                                        })).ok();
                                        st = app_state.write().await;
                                        st.operator_message = None;
                                    }
                                }
                                "refresh" => {},
                                _ => {}
                            }

                            let response = {
                                let active_slides = get_active_slides(&st);
                                let slides = build_slides_json(&active_slides, &app_handle);
                                serde_json::json!({ 
                                    "type": "state", 
                                    "slides": slides, 
                                    "current_index": st.current_slide_index, 
                                    "is_blackout": st.is_blackout,
                                    "active_presentation_id": st.active_presentation_id,
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

// HTTP SERVER

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
                let active_slides = get_active_slides(&app_state);
                let json = serde_json::json!({
                    "current_slide_index": app_state.current_slide_index,
                    "is_blackout": app_state.is_blackout,
                    "active_presentation_id": app_state.active_presentation_id,
                    "presentations": app_state.presentations.iter().map(|p| {
                        serde_json::json!({
                            "id": p.id,
                            "name": p.name,
                            "active": p.active,
                            "slides_count": p.slides.len()
                        })
                    }).collect::<Vec<_>>(),
                    "slides": active_slides.iter().map(|s| {
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

async fn show_display_window_internal(app_handle: &tauri::AppHandle) -> Result<(), String> {
    if let Some(w) = app_handle.get_webview_window("display") {
        w.unminimize().map_err(|e| e.to_string())?; 
        w.show().map_err(|e| e.to_string())?;
        // w.set_always_on_top(true).map_err(|e| e.to_string())?; 
        w.set_fullscreen(true).map_err(|e| e.to_string())?;
        w.set_focus().map_err(|e| e.to_string())?; 
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(app_handle, "display", tauri::WebviewUrl::App("/display".into()))
        .title("Tela de Exibição")
        .inner_size(800.0, 600.0)
        .decorations(false)
        // .always_on_top(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
    
    if let Ok(monitors) = window.available_monitors() {
        let target = if monitors.len() > 1 { &monitors[1] } else { &monitors[0] };
        window.set_position(tauri::PhysicalPosition::new(target.position().x, target.position().y)).map_err(|e| e.to_string())?;
        window.set_size(tauri::PhysicalSize::new(target.size().width, target.size().height)).map_err(|e| e.to_string())?;
    }
    // window.set_always_on_top(true).map_err(|e| e.to_string())?; 
    window.set_fullscreen(true).map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?; 
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn reorder_slides(
    presentation_id: String,
    slide_ids: Vec<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    
    if let Some(pres) = app_state.presentations.iter_mut().find(|p| p.id == presentation_id) {
        // Reordenar slides baseado na nova ordem de IDs
        let mut reordered = Vec::new();
        for (new_order, id) in slide_ids.iter().enumerate() {
            if let Some(slide) = pres.slides.iter().find(|s| &s.id == id) {
                let mut slide = slide.clone();
                slide.order = new_order;
                reordered.push(slide);
            }
        }
        
        // Manter slides que não estão na lista (não deveria acontecer, mas por segurança)
        for slide in &pres.slides {
            if !slide_ids.contains(&slide.id) {
                let mut slide = slide.clone();
                slide.order = reordered.len();
                reordered.push(slide);
            }
        }
        
        pres.slides = reordered;
        
        // Se esta apresentação é a ativa, notificar tablets
        if pres.active {
            let active_slides = get_active_slides(&app_state);
            let msg = serde_json::json!({
                "type": "state",
                "slides": build_slides_json(&active_slides, &app_handle),
                "current_index": app_state.current_slide_index,
                "is_blackout": app_state.is_blackout,
                "active_presentation_id": app_state.active_presentation_id,
            }).to_string();
            ws_clients.broadcast(msg);
        }
    } else {
        return Err("Apresentação não encontrada".to_string());
    }
    
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

// Adicione estes comandos no lib.rs

#[tauri::command]
async fn get_schedule_config(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.schedule_config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn save_schedule_config(
    config_json: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let config: ScheduleConfig = serde_json::from_str(&config_json).map_err(|e| format!("Erro ao parsear config: {}", e))?;
    let mut app_state = state.write().await;
    app_state.schedule_config = config;
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn get_countdown_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.countdown).map_err(|e| e.to_string())
}

#[tauri::command]
async fn stop_countdown(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    app_state.countdown.running = false;
    app_state.countdown.seconds_left = 0;
    app_state.countdown.target_time = None;
    app_state.countdown.label = String::new();
    app_state.countdown.stopped_manually = true;
    save_state_to_disk(&app_state, &app_handle);
    
    app_handle.emit("countdown-stop", ()).map_err(|e| e.to_string())?;
    
    // Força ir para JW Library
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

// Função para iniciar o cronômetro (chamada internamente)
fn start_countdown_internal(
    state: &mut AppState,
    target_time: String,
    seconds_left: u64,
    label: String,
) {
    state.countdown.running = true;
    state.countdown.target_time = Some(target_time);
    state.countdown.seconds_left = seconds_left;
    state.countdown.label = label;
}

fn check_and_start_countdown(app_state: &SharedState, app_handle: &tauri::AppHandle) {
    let state = app_state.clone();
    let handle = app_handle.clone();
    
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
            
            let mut app_state = state.write().await;
            
            // Se estiver rodando, decrementar o contador
            if app_state.countdown.running {
                if app_state.countdown.seconds_left > 0 {
                    app_state.countdown.seconds_left -= 1;
                    
                    let countdown_json = serde_json::json!({
                        "running": true,
                        "target_time": app_state.countdown.target_time,
                        "seconds_left": app_state.countdown.seconds_left,
                        "label": app_state.countdown.label,
                    });
                    let _ = handle.emit("countdown-update", &countdown_json);
                    
                    if app_state.countdown.seconds_left == 0 {
                        app_state.countdown.running = false;
                        app_state.countdown.target_time = None;
                        app_state.countdown.label = String::new();
                        let _ = handle.emit("countdown-stop", ());
                        
                        drop(app_state);
                        let _ = switch_to_jw_library_internal(&handle).await;
                        continue;
                    }
                }
                continue;
            }

            if app_state.countdown.stopped_manually {
                continue;
            }
            
            // Verificar agendamento
            let now = chrono::Local::now();
            let current_second = now.second();
            
            if current_second % 30 != 0 && current_second != 0 {
                continue;
            }
            
            let weekday = now.format("%A").to_string().to_lowercase();
            
            if let Some(day_config) = app_state.schedule_config.days.iter().find(|d| d.day == weekday) {
                if !day_config.enabled || day_config.times.is_empty() {
                    continue;
                }
                
                let current_hour = now.hour();
                let current_minute = now.minute();
                let current_seconds_total = (current_hour * 3600 + current_minute * 60 + current_second) as i64;
                
                let mut next_meeting: Option<&MeetingTime> = None;
                let mut min_diff: i64 = i64::MAX;
                
                for time in &day_config.times {
                    let meeting_seconds = (time.hour * 3600 + time.minute * 60) as i64;
                    let diff = meeting_seconds - current_seconds_total;
                    
                    if diff > 0 && diff <= 300 && diff < min_diff {
                        min_diff = diff;
                        next_meeting = Some(time);
                    }
                }
                
                if let Some(meeting) = next_meeting {
                    let seconds_left = min_diff as u64;
                    let target = format!("{:02}:{:02}", meeting.hour, meeting.minute);
                    let label = day_config.label.clone();
                    
                    start_countdown_internal(&mut app_state, target.clone(), seconds_left, label.clone());
                    
                    let countdown_json = serde_json::json!({
                        "running": true,
                        "target_time": target,
                        "seconds_left": seconds_left,
                        "label": label,
                    });
                    let _ = handle.emit("countdown-update", &countdown_json);
                    
                    // ✅ ALTERNAR PARA A TELA DE IMAGENS (SISTEMA)
                    drop(app_state);
                    let _ = switch_to_sistema_internal(&handle).await;
                    // Re-obter o lock após alternar
                    app_state = state.write().await;
                }
            }
        }
    });
}

#[tauri::command]
async fn ensure_display_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    // Apenas cria a janela se não existir, mas não a mostra
    if app_handle.get_webview_window("display").is_none() {
        let window = WebviewWindowBuilder::new(&app_handle, "display", tauri::WebviewUrl::App("/display".into()))
            .title("Tela de Exibição")
            .inner_size(800.0, 600.0)
            .decorations(false)
            .always_on_top(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        
        if let Ok(monitors) = window.available_monitors() {
            let target = if monitors.len() > 1 { &monitors[1] } else { &monitors[0] };
            window.set_position(tauri::PhysicalPosition::new(target.position().x, target.position().y)).ok();
            window.set_size(tauri::PhysicalSize::new(target.size().width, target.size().height)).ok();
        }
    }
    Ok(())
}

#[tauri::command]
async fn generate_upload_qr(upload_sessions: tauri::State<'_, Arc<UploadSessions>>) -> Result<String, String> {
    let token = uuid::Uuid::new_v4().to_string().replace("-", "")[..8].to_string();
    let session = UploadSession {
        token: token.clone(),
        presentation_name: format!("Envio do Orador - {}", chrono::Local::now().format("%d/%m/%Y %H:%M")),
    };
    upload_sessions.sessions.lock().map_err(|e| e.to_string())?.insert(token.clone(), session);
    Ok(format!("http://{}:20779/upload/{}", get_local_ip(), token))
}

fn start_upload_server(
    app_state: SharedState,
    app_handle: tauri::AppHandle,
    upload_sessions: Arc<UploadSessions>,
    ws_clients: Arc<WsClients>,
) {
    tauri::async_runtime::spawn(async move {
        let state = warp::any().map(move || (app_state.clone(), app_handle.clone(), upload_sessions.clone(), ws_clients.clone()));

        let upload_page = warp::path!("upload" / String)
            .and(warp::get())
            .map(|token: String| {
                let html = include_str!("../upload_page.html");
                warp::reply::html(html.replace("{{TOKEN}}", &token))
            });

        let upload_api = warp::path!("api" / "upload" / String)
            .and(warp::post())
            .and(warp::multipart::form().max_length(100 * 1024 * 1024))
            .and(state)
            .and_then(move |token: String, mut form: warp::multipart::FormData, (state, handle, sessions, clients): (SharedState, tauri::AppHandle, Arc<UploadSessions>, Arc<WsClients>)| async move {
                let session_name = {
                    let map = sessions.sessions.lock().unwrap();
                    map.get(&token).map(|s| s.presentation_name.clone())
                };

                if session_name.is_none() {
                    return Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({"error": "Link inválido"})));
                }

                let app_dir = get_data_dir(&handle);
                let images_dir = app_dir.join("images");
                let thumbs_dir = app_dir.join("thumbnails");
                fs::create_dir_all(&images_dir).ok();
                fs::create_dir_all(&thumbs_dir).ok();

                let mut new_slides = Vec::new();

                // Processar cada parte do formulário
                while let Some(Ok(part)) = form.next().await {
                    // Obter o nome do arquivo
                    let filename = part.filename().unwrap_or("imagem.jpg").to_string();
                    let ext = PathBuf::from(&filename)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("jpg")
                        .to_lowercase();
                    
                    // Coletar bytes manualmente usando stream
                    let mut data = Vec::new();
                    let mut part_stream = part.stream();
                    while let Some(result) = part_stream.next().await {
                        match result {
                            Ok(buf) => {
                                let chunk = buf.chunk();
                                data.extend_from_slice(chunk);
                            },
                            Err(_) => break,
                        }
                    }
                    
                    if !data.is_empty() {
                        let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
                        let dest = images_dir.join(&new_filename);
                        let thumb = thumbs_dir.join(&new_filename);

                        // Escrever arquivo diretamente
                        if fs::write(&dest, &data).is_ok() {
                            // Criar thumbnail
                            if let Ok(img) = image::open(&dest) {
                                let (w, h) = img.dimensions();
                                let opt = if w > 1920 || h > 1080 {
                                    let new_w = (1080.0 * w as f32 / h as f32) as u32;
                                    img.resize_exact(new_w, 1080, image::imageops::FilterType::Lanczos3)
                                } else { img };
                                let _ = opt.resize_exact(400, 300, image::imageops::FilterType::Lanczos3).save_with_format(&thumb, image::ImageFormat::Jpeg);
                                // Salvar imagem otimizada
                                let _ = opt.save_with_format(&dest, image::ImageFormat::Jpeg);
                            }
                            
                            new_slides.push(Slide {
                                id: uuid::Uuid::new_v4().to_string(),
                                filename: new_filename,
                                order: new_slides.len(),
                            });
                        }
                    }
                }

                if !new_slides.is_empty() {
                    let mut app_state = state.write().await;
                    let pres_id = uuid::Uuid::new_v4().to_string();
                    app_state.presentations.push(Presentation {
                        id: pres_id.clone(),
                        name: session_name.unwrap(),
                        slides: new_slides,
                        active: false,
                    });
                    save_state_to_disk(&app_state, &handle);
                    sessions.sessions.lock().unwrap().remove(&token);
                    
                    // ✅ Emitir evento para fechar o modal
                    handle.emit("tablet-upload-complete", &pres_id).ok();
                }

                Ok::<_, warp::Rejection>(warp::reply::json(&serde_json::json!({"success": true})))
            });

        let routes = upload_page.or(upload_api);
        println!("📱 Servidor de Upload: http://0.0.0.0:20779");
        warp::serve(routes).run(([0, 0, 0, 0], 20779)).await;
    });
}

#[tauri::command]
async fn zoom_get_config(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&app_state.zoom_config).map_err(|e| e.to_string())
}

#[tauri::command]
async fn zoom_save_config(
    config_json: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let config: ZoomBotConfig = serde_json::from_str(&config_json)
        .map_err(|e| format!("Erro ao parsear config: {}", e))?;
    let mut app_state = state.write().await;
    app_state.zoom_config = config;
    save_state_to_disk(&app_state, &app_handle);
    Ok(())
}

#[tauri::command]
async fn zoom_start_bot(
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
    zoom_bot: tauri::State<'_, Arc<ZoomBotProcess>>,
    ws_clients: tauri::State<'_, Arc<WsClients>>,
) -> Result<(), String> {
    use tokio::io::{AsyncReadExt, BufReader, AsyncBufReadExt};
    use tokio::time::sleep;
    use std::process::Stdio;
    
    println!("🟢 zoom_start_bot: Iniciando...");
    
    // Verificar se já está rodando
    {
        let process = zoom_bot.process.lock().await;
        if process.is_some() {
            println!("⚠️ Bot já está em execução");
            return Err("Bot já está em execução".to_string());
        }
    }
    
    // Limpar estado anterior
    zoom_bot.should_stop.store(false, Ordering::SeqCst);
    zoom_bot.connected.store(false, Ordering::SeqCst);
    *zoom_bot.error.lock().await = None;
    *zoom_bot.raised_hands.lock().await = Vec::new();
    
    // Obter configuração
    let config = {
        let app_state = state.read().await;
        app_state.zoom_config.clone()
    };
    
    println!("📋 Configuração carregada: meeting_id={}, passcode=****, bot_name={}", 
        config.meeting_id, config.bot_name);
    
    if config.meeting_id.is_empty() || config.passcode.is_empty() {
        println!("❌ Configuração incompleta");
        return Err("Configure o ID da reunião e senha primeiro".to_string());
    }
    
    *zoom_bot.config.lock().await = config.clone();
    
    // ===== LOCALIZAR O zoom_bot.exe =====
    let data_dir = get_data_dir(&app_handle);
    let zoom_bot_exe = data_dir.join("resources").join("zoom_bot.exe");
    
    // Se não existir no diretório de dados, copiar da instalação
    if !zoom_bot_exe.exists() {
        println!("⚠️ zoom_bot.exe não encontrado em: {:?}", zoom_bot_exe);
        
        let install_dir = std::env::current_exe()
            .map_err(|e| format!("Erro ao obter diretório do executável: {}", e))?
            .parent()
            .ok_or("Diretório do executável não encontrado")?
            .to_path_buf();
        
        let possible_paths = vec![
            install_dir.join("resources").join("zoom_bot.exe"),
            install_dir.join("zoom_bot.exe"),
            PathBuf::from("src-tauri").join("resources").join("zoom_bot.exe"),
            PathBuf::from(".").join("zoom_bot.exe"),
        ];
        
        let mut found = false;
        for path in &possible_paths {
            println!("🔍 Procurando em: {:?}", path);
            if path.exists() {
                println!("✅ zoom_bot.exe encontrado em: {:?}", path);
                
                if let Err(e) = fs::create_dir_all(data_dir.join("resources")) {
                    return Err(format!("Erro ao criar diretório: {}", e));
                }
                
                if let Err(e) = fs::copy(path, &zoom_bot_exe) {
                    return Err(format!("Erro ao copiar zoom_bot.exe: {}", e));
                }
                
                println!("✅ zoom_bot.exe copiado para: {:?}", zoom_bot_exe);
                found = true;
                break;
            }
        }
        
        if !found {
            let err = format!("zoom_bot.exe não encontrado em nenhum dos locais verificados");
            println!("❌ {}", err);
            return Err(err);
        }
    } else {
        println!("✅ zoom_bot.exe encontrado em: {:?}", zoom_bot_exe);
    }
    
    // ===== CONSTRUIR COMANDO =====
    let use_visible = false; // Modo visível para debug
    
    let mut cmd = tokio::process::Command::new(&zoom_bot_exe);
    cmd.arg("--meeting").arg(&config.meeting_id);
    cmd.arg("--passcode").arg(&config.passcode);
    cmd.arg("--name").arg(&config.bot_name);
    
    if use_visible {
        cmd.arg("--visible");
        println!("👁️ Modo VISÍVEL (debug)");
    } else {
        cmd.arg("--headless");
        println!("👻 Modo HEADLESS");
    }
    
    // Definir diretório de trabalho
    if let Some(parent) = zoom_bot_exe.parent() {
        cmd.current_dir(parent);
        println!("📂 Diretório de trabalho: {:?}", parent);
    }
    
    // 🔥 IMPORTANTE: Capturar stdout e stderr separadamente
    cmd.stdout(Stdio::piped())
       .stderr(Stdio::piped());
    
    // ===== VARIÁVEIS DE AMBIENTE =====
    cmd.env("PLAYWRIGHT_BROWSERS_PATH", "0");
    cmd.env("PYTHONUNBUFFERED", "1");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.env("PYTHONUTF8", "1");
    cmd.env("PYTHONWARNINGS", "ignore");
    
    // Copiar PATH do sistema
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    
    // Adicionar o diretório atual ao PATH
    if let Some(parent) = zoom_bot_exe.parent() {
        if let Ok(current_path) = std::env::var("PATH") {
            let new_path = format!("{};{}", parent.display(), current_path);
            cmd.env("PATH", new_path);
        }
    }
    
    println!("▶️ Executando: {} --meeting {} --passcode **** --name {}",
        zoom_bot_exe.display(), config.meeting_id, config.bot_name);
    
    // ===== INICIAR PROCESSO =====
    let mut child = match cmd.spawn() {
        Ok(c) => {
            println!("✅ Processo iniciado com PID: {:?}", c.id());
            c
        },
        Err(e) => {
            let err = format!("Erro ao iniciar bot: {}", e);
            println!("❌ {}", err);
            return Err(err);
        }
    };
    
    let stdout = child.stdout.take().expect("Failed to capture stdout");
    let stderr = child.stderr.take().expect("Failed to capture stderr");
    
    // ===== CLONAR ARCs =====
    let process_arc = zoom_bot.process.clone();
    let connected_arc = zoom_bot.connected.clone();
    let should_stop_arc = zoom_bot.should_stop.clone();
    let handle = app_handle.clone();
    let ws_clients_inner = ws_clients.inner().clone();
    
    // 🔥 CLONE para usar nas tasks
    let zoom_bot_for_tasks = zoom_bot.inner().clone();
    
    // Armazenar o processo
    *zoom_bot.process.lock().await = Some(child);
    
    // ===== FUNÇÃO AUXILIAR para processar saída =====
    async fn process_zoom_output(
        line: &str,
        zoom_bot: &Arc<ZoomBotProcess>,
        handle: &tauri::AppHandle,
        ws_clients: &Arc<WsClients>,
        source: &str, // "stdout" ou "stderr"
    ) {
        println!("[Zoom Bot {}] {}", source, line);
        
        // ===== DETECTAR CONEXÃO BEM SUCEDIDA =====
        if line.contains("Login inicial bem sucedido!") 
            || line.contains("Reconectado com sucesso!") 
            || line.contains("Entrou na reuniao!") {
            zoom_bot.connected.store(true, Ordering::SeqCst);
            *zoom_bot.error.lock().await = None;
            let _ = handle.emit("zoom-connected", true);
            
            let ws_msg = serde_json::json!({
                "type": "zoom_connected",
            }).to_string();
            ws_clients.broadcast(ws_msg);
            println!("📡 Evento zoom_connected enviado via WebSocket");
        }
        
        // ===== DETECTAR CONEXÃO PERDIDA =====
        if line.contains("CONEXAO PERDIDA!") 
            || line.contains("Falha no login inicial!") {
            zoom_bot.connected.store(false, Ordering::SeqCst);
            let _ = handle.emit("zoom-disconnected", "Conexão perdida");
            
            let ws_msg = serde_json::json!({
                "type": "zoom_disconnected",
            }).to_string();
            ws_clients.broadcast(ws_msg);
            println!("📡 Evento zoom_disconnected enviado via WebSocket");
        }
        
        // ===== DETECTAR MÃO LEVANTADA =====
        if line.contains("MAO LEVANTADA:") {
            if let Some(name) = line.split("MAO LEVANTADA:").nth(1) {
                let name = name.trim().to_string();
                let name = name.split('[').next().unwrap_or(&name).trim().to_string();
                let timestamp = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap()
                    .as_secs();
                
                let mut hands = zoom_bot.raised_hands.lock().await;
                if !hands.iter().any(|h| h.name == name) {
                    hands.push(ZoomRaisedHand { name: name.clone(), timestamp });
                    
                    let _ = handle.emit("zoom-hand-raised", &serde_json::json!({
                        "name": name,
                        "timestamp": timestamp
                    }));
                    println!("✋ Mão levantada: {}", name);
                    
                    let ws_msg = serde_json::json!({
                        "type": "zoom_hand_raised",
                        "name": name,
                        "timestamp": timestamp
                    }).to_string();
                    ws_clients.broadcast(ws_msg);
                    println!("📡 Evento zoom_hand_raised enviado via WebSocket: {}", name);
                }
            }
        }
        
        // ===== DETECTAR MÃO ABAIXADA =====
        if line.contains("MAO ABAIXADA:") {
            if let Some(name) = line.split("MAO ABAIXADA:").nth(1) {
                let name = name.trim().to_string();
                let name = name.split('[').next().unwrap_or(&name).trim().to_string();
                let mut hands = zoom_bot.raised_hands.lock().await;
                hands.retain(|h| h.name != name);
                
                let _ = handle.emit("zoom-hand-lowered", &serde_json::json!({
                    "name": name
                }));
                println!("👇 Mão abaixada: {}", name);
                
                let ws_msg = serde_json::json!({
                    "type": "zoom_hand_lowered",
                    "name": name
                }).to_string();
                ws_clients.broadcast(ws_msg);
                println!("📡 Evento zoom_hand_lowered enviado via WebSocket: {}", name);
            }
        }
        
        // ===== DETECTAR ERRO FATAL =====
        if line.contains("[Bot] Erro:") 
            || line.contains("[Bot] Numero maximo de reconexoes")
            || line.contains("Traceback")
            || line.contains("Error:")
            || line.contains("ModuleNotFoundError") {
            zoom_bot.connected.store(false, Ordering::SeqCst);
            let error_msg = line.to_string();
            *zoom_bot.error.lock().await = Some(error_msg.clone());
            let _ = handle.emit("zoom-error", &error_msg);
            println!("❌ Erro detectado: {}", error_msg);
            zoom_bot.should_stop.store(true, Ordering::SeqCst);
        }
        
        // ===== VERIFICAR SE O BOT FOI ENCERRADO =====
        if line.contains("[Bot] Encerrado") || line.contains("[Bot] Interrompido") {
            zoom_bot.connected.store(false, Ordering::SeqCst);
            zoom_bot.should_stop.store(true, Ordering::SeqCst);
            let _ = handle.emit("zoom-disconnected", "Bot encerrado");
            println!("🔴 Bot encerrado");
        }
    }
    
    // ===== TASK PARA MONITORAR STDOUT =====
    let should_stop_stdout = should_stop_arc.clone();
    let connected_stdout = connected_arc.clone();
    let handle_stdout = handle.clone();
    let ws_clients_stdout = ws_clients_inner.clone();
    let zoom_bot_stdout = zoom_bot_for_tasks.clone();
    
    let _handle_stdout = tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        
        while let Ok(Some(line)) = lines.next_line().await {
            if should_stop_stdout.load(Ordering::SeqCst) {
                break;
            }
            
            process_zoom_output(&line, &zoom_bot_stdout, &handle_stdout, &ws_clients_stdout, "stdout").await;
        }
        
        connected_stdout.store(false, Ordering::SeqCst);
        should_stop_stdout.store(true, Ordering::SeqCst);
        let _ = handle_stdout.emit("zoom-disconnected", "Bot finalizado (stdout)");
        println!("🔴 Task stdout finalizada");
    });
    
    // ===== TASK PARA MONITORAR STDERR =====
    let should_stop_stderr = should_stop_arc.clone();
    let handle_stderr = handle.clone();
    let ws_clients_stderr = ws_clients_inner.clone();
    let zoom_bot_stderr = zoom_bot_for_tasks.clone();
    
    let _handle_stderr = tauri::async_runtime::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        
        while let Ok(Some(line)) = lines.next_line().await {
            if should_stop_stderr.load(Ordering::SeqCst) {
                break;
            }
            
            // Processar stderr também
            process_zoom_output(&line, &zoom_bot_stderr, &handle_stderr, &ws_clients_stderr, "stderr").await;
        }
        
        println!("🔴 Task stderr finalizada");
    });
    
    // ===== TASK PARA MONITORAR O PROCESSO =====
    let process_arc_clone = process_arc.clone();
    let should_stop_clone = should_stop_arc.clone();
    let connected_clone = connected_arc.clone();
    let handle_clone = handle.clone();
    
    tauri::async_runtime::spawn(async move {
        let mut process = process_arc_clone.lock().await;
        if let Some(mut child) = process.take() {
            drop(process);
            let status = child.wait().await;
            connected_clone.store(false, Ordering::SeqCst);
            should_stop_clone.store(true, Ordering::SeqCst);
            let _ = handle_clone.emit("zoom-disconnected", "Processo do bot encerrado");
            println!("🔴 Processo do bot encerrado com status: {:?}", status);
        }
    });
    
    // 🔥 AGUARDAR ATÉ O BOT ESTAR CONECTADO (COM TIMEOUT)
    println!("⏳ Aguardando bot conectar (máximo 60 segundos)...");
    let mut attempts = 0;
    let max_attempts = 60;
    
    while attempts < max_attempts {
        sleep(Duration::from_secs(1)).await;
        attempts += 1;
        
        // Verificar se o bot já está conectado
        if zoom_bot.connected.load(Ordering::SeqCst) {
            println!("✅ Bot conectado com sucesso após {} segundos!", attempts);
            break;
        }
        
        // Verificar se houve erro
        if let Some(err) = zoom_bot.error.lock().await.clone() {
            return Err(format!("Erro no bot: {}", err));
        }
        
        // Verificar se o bot foi parado
        if zoom_bot.should_stop.load(Ordering::SeqCst) {
            return Err("Bot foi interrompido".to_string());
        }
        
        // Mostrar progresso a cada 5 segundos
        if attempts % 5 == 0 {
            println!("⏳ Aguardando conexão... ({}/{} segundos)", attempts, max_attempts);
        }
    }
    
    if attempts >= max_attempts {
        println!("⚠️ Timeout: bot não conectou em {} segundos", max_attempts);
    }
    
    println!("✅ zoom_start_bot concluído com sucesso!");
    Ok(())
}

#[tauri::command]
async fn zoom_stop_bot(
    zoom_bot: tauri::State<'_, Arc<ZoomBotProcess>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    println!("🔴 Parando Zoom Bot...");
    
    // 1. Sinalizar para parar
    zoom_bot.should_stop.store(true, Ordering::SeqCst);
    
    // 2. Tentar matar o processo principal (se tiver)
    {
        let mut process = zoom_bot.process.lock().await;
        if let Some(mut child) = process.take() {
            let _ = child.kill().await;
            let _ = timeout(Duration::from_secs(3), child.wait()).await;
        }
    }
    
    // 3. 🔥 FORÇAR FECHAMENTO DO zoom_bot.exe PELO NOME
    println!("🔴 Forçando fechamento do zoom_bot.exe...");
    
    // Usando taskkill para matar o processo pelo nome exato
    let _ = std::process::Command::new("taskkill")
        .args(&["/F", "/IM", "zoom_bot.exe"])
        .spawn();
    
    // Também tenta matar pelo PID se tiver (opcional, mas vamos manter só o nome)
    // O taskkill /F /IM já é suficiente
    
    // 4. Limpar estado
    zoom_bot.connected.store(false, Ordering::SeqCst);
    *zoom_bot.raised_hands.lock().await = Vec::new();
    *zoom_bot.error.lock().await = None;
    
    let _ = app_handle.emit("zoom-disconnected", "Bot parado manualmente");
    println!("✅ Zoom Bot parado com sucesso!");
    Ok(())
}

#[tauri::command]
async fn zoom_get_state(
    zoom_bot: tauri::State<'_, Arc<ZoomBotProcess>>,
) -> Result<String, String> {
    let connected = zoom_bot.connected.load(Ordering::SeqCst);
    let hands = zoom_bot.raised_hands.lock().await;
    let error = zoom_bot.error.lock().await;
    
    let state = serde_json::json!({
        "connected": connected,
        "raised_hands": *hands,
        "error": *error,
    });
    
    Ok(state.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = load_state_from_disk(&app.handle());
            
            let mut state = state;
            for pres in &mut state.presentations {
                pres.active = false;
            }
            state.active_presentation_id = None;
            state.current_slide_index = 0;
            state.is_blackout = true;
            state.countdown.running = false;
            state.countdown.stopped_manually = false; 
            
            let shared_state: SharedState = Arc::new(RwLock::new(state)); // PRIMEIRO
            let clients = Arc::new(WsClients::new()); // PRIMEIRO
            let upload_sessions = Arc::new(UploadSessions::new()); // PRIMEIRO
            let zoom_bot = Arc::new(ZoomBotProcess::new());

            app.manage(zoom_bot.clone()); 
            app.manage(shared_state.clone());
            app.manage(clients.clone());
            app.manage(upload_sessions.clone());
            
            start_ws_server(shared_state.clone(), app.handle().clone(), clients.clone());
            start_http_control_server(shared_state.clone(), app.handle().clone());
            start_upload_server(shared_state.clone(), app.handle().clone(), upload_sessions, clients);
            
            check_and_start_countdown(&shared_state, &app.handle());
            
            // ✅ Fechar completamente ao clicar no X
            let window = app.get_webview_window("main").unwrap();
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Fecha todas as janelas e encerra o app
                    if let Some(display) = app_handle.get_webview_window("display") {
                        display.close().ok();
                    }
                    app_handle.exit(0);
                }
            });
            
            // ✅ INICIAR NO JW LIBRARY - Emite apenas o evento de switch
            // O AdminPage vai escutar e atualizar o estado visual
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // Aguardar um pouco para o frontend carregar
                tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                
                // Emitir evento para o frontend saber que está no JW
                let _ = handle.emit("switch-app", "jw");
                
                // Também ativar o JW Library via PowerShell
                std::process::Command::new("powershell")
                    .args(&["-NoProfile", "-WindowStyle", "Hidden", "-Command", 
                        "$wshell = New-Object -ComObject WScript.Shell;",
                        "$wshell.AppActivate('JW Library');"
                    ])
                    .spawn().ok();
                
                // Esconder a janela display se já existir
                if let Some(w) = handle.get_webview_window("display") {
                    w.set_always_on_top(false).ok();
                    w.hide().ok();
                }
            });
            
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
            send_operator_message, acknowledge_operator_message, get_operator_message,
            create_presentation, delete_presentation, set_active_presentation,
            upload_images_to_presentation, delete_slide_from_presentation, get_presentations,
            extract_jw_playlist, reorder_slides, get_schedule_config, save_schedule_config, 
            get_countdown_state, stop_countdown, ensure_display_window, generate_upload_qr,
            zoom_get_config, zoom_save_config, zoom_start_bot, zoom_stop_bot, zoom_get_state
        ])
        .run(tauri::generate_context!())
        .expect("erro");
}