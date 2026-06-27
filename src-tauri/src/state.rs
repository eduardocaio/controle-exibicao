// src-tauri/src/state.rs

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
pub struct AppConfig {
    pub pin: String,
    pub selected_monitor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub slides: Vec<Slide>,
    pub current_slide_index: usize,
    pub is_blackout: bool,
    pub config: AppConfig,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            slides: Vec::new(),
            current_slide_index: 0,
            is_blackout: true,
            config: AppConfig {
                pin: String::new(),
                selected_monitor: String::new(),
            },
        }
    }
}

pub type SharedState = Arc<RwLock<AppState>>;