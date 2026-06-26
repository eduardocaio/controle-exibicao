mod state;

use state::{AppState, Presentation, SharedState};
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tauri::Manager;

// Comando para pegar o diretório de dados do app
#[tauri::command]
async fn get_app_data_dir(app_handle: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    Ok(app_dir.to_string_lossy().to_string())
}

// Comando para carregar estado completo
#[tauri::command]
async fn get_app_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&*app_state).map_err(|e| e.to_string())
}

// Comando para criar apresentação
#[tauri::command]
async fn create_presentation(
    name: String,
    state: tauri::State<'_, SharedState>,
) -> Result<String, String> {
    let mut app_state = state.write().await;
    let presentation = Presentation {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        slides: Vec::new(),
    };
    app_state.presentations.push(presentation.clone());
    serde_json::to_string(&presentation).map_err(|e| e.to_string())
}

// Comando para deletar apresentação
#[tauri::command]
async fn delete_presentation(
    id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // Primeiro, remove as imagens da apresentação
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    let mut app_state = state.write().await;
    if let Some(presentation) = app_state.presentations.iter().find(|p| p.id == id) {
        for slide in &presentation.slides {
            let image_path = app_dir.join("images").join(&slide.filename);
            let thumb_path = app_dir.join("thumbnails").join(&slide.filename);
            let _ = fs::remove_file(image_path);
            let _ = fs::remove_file(thumb_path);
        }
    }
    
    app_state.presentations.retain(|p| p.id != id);
    Ok(())
}

// Comando para editar nome da apresentação
#[tauri::command]
async fn edit_presentation_name(
    id: String,
    new_name: String,
    state: tauri::State<'_, SharedState>,
) -> Result<(), String> {
    let mut app_state = state.write().await;
    if let Some(presentation) = app_state.presentations.iter_mut().find(|p| p.id == id) {
        presentation.name = new_name;
    }
    Ok(())
}

// Comando para fazer upload de imagens
#[tauri::command]
async fn upload_images(
    presentation_id: String,
    file_paths: Vec<String>,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<String, String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    // Criar pastas se não existirem
    let images_dir = app_dir.join("images");
    let thumbs_dir = app_dir.join("thumbnails");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&thumbs_dir).map_err(|e| e.to_string())?;
    
    let mut app_state = state.write().await;
    let presentation = app_state
        .presentations
        .iter_mut()
        .find(|p| p.id == presentation_id)
        .ok_or("Apresentação não encontrada")?;
    
    let mut new_slides = Vec::new();
    
    for file_path in &file_paths {
        let original_path = PathBuf::from(file_path);
        let extension = original_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("jpg");
        
        let new_filename = format!("{}.{}", uuid::Uuid::new_v4(), extension);
        let dest_path = images_dir.join(&new_filename);
        
        // Copiar arquivo
        fs::copy(&original_path, &dest_path).map_err(|e| e.to_string())?;
        
        // Gerar miniatura
        let thumb_path = thumbs_dir.join(&new_filename);
        if let Ok(img) = image::open(&dest_path) {
            let thumbnail = img.thumbnail(200, 150);
            let _ = thumbnail.save(&thumb_path);
        } else {
            // Se não conseguir gerar thumb, copia a original
            let _ = fs::copy(&dest_path, &thumb_path);
        }
        
        let slide = state::Slide {
            id: uuid::Uuid::new_v4().to_string(),
            filename: new_filename,
            order: presentation.slides.len() + new_slides.len(),
        };
        
        new_slides.push(slide);
    }
    
    presentation.slides.extend(new_slides.clone());
    
    serde_json::to_string(&presentation).map_err(|e| e.to_string())
}

// Comando para deletar um slide específico
#[tauri::command]
async fn delete_slide(
    presentation_id: String,
    slide_id: String,
    state: tauri::State<'_, SharedState>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    let app_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    
    let mut app_state = state.write().await;
    let presentation = app_state
        .presentations
        .iter_mut()
        .find(|p| p.id == presentation_id)
        .ok_or("Apresentação não encontrada")?;
    
    // Remove o arquivo de imagem
    if let Some(slide) = presentation.slides.iter().find(|s| s.id == slide_id) {
        let image_path = app_dir.join("images").join(&slide.filename);
        let thumb_path = app_dir.join("thumbnails").join(&slide.filename);
        let _ = fs::remove_file(image_path);
        let _ = fs::remove_file(thumb_path);
    }
    
    presentation.slides.retain(|s| s.id != slide_id);
    
    // Reordenar
    for (i, slide) in presentation.slides.iter_mut().enumerate() {
        slide.order = i;
    }
    
    Ok(())
}

pub fn run() {
    let app_state: SharedState = Arc::new(RwLock::new(AppState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_app_data_dir,
            get_app_state,
            create_presentation,
            delete_presentation,
            edit_presentation_name,
            upload_images,
            delete_slide,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}