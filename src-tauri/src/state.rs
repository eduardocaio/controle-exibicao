use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slide {
    pub id: String,
    pub filename: String,
    pub order: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Presentation {
    pub id: String,
    pub name: String,
    pub slides: Vec<Slide>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub pin: String,
    pub selected_monitor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub presentations: Vec<Presentation>,
    pub active_presentation: Option<String>,
    pub current_slide_index: usize,
    pub is_blackout: bool,
    pub config: AppConfig,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            presentations: Vec::new(),
            active_presentation: None,
            current_slide_index: 0,
            is_blackout: false,
            config: AppConfig {
                pin: "1234".to_string(),
                selected_monitor: "".to_string(),
            },
        }
    }
}

pub type SharedState = Arc<RwLock<AppState>>;