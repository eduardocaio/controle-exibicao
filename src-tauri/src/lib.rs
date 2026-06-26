mod state;

use state::{AppState, SharedState};
use std::sync::Arc;
use tokio::sync::RwLock;

#[tauri::command]
async fn get_app_state(state: tauri::State<'_, SharedState>) -> Result<String, String> {
    let app_state = state.read().await;
    serde_json::to_string(&*app_state).map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_presentation(
    name: String,
    state: tauri::State<'_, SharedState>,
) -> Result<String, String> {
    let mut app_state = state.write().await;
    let presentation = state::Presentation {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        slides: Vec::new(),
    };
    app_state.presentations.push(presentation.clone());
    serde_json::to_string(&presentation).map_err(|e| e.to_string())
}

pub fn run() {
    let app_state: SharedState = Arc::new(RwLock::new(AppState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            create_presentation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}