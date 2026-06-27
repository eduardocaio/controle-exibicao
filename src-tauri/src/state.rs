use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Slide {
    pub id: String,
    pub filename: String,
    pub order: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerState {
    pub running: bool,
    pub start_time: u64,      // timestamp quando iniciou (ms)
    pub accumulated: u64,     // tempo acumulado antes de pausar (ms)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub slides: Vec<Slide>,
    pub current_slide_index: usize,
    pub is_blackout: bool,
    pub timer: TimerState,
    pub alert_water: bool,
    pub alert_indicator: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            slides: Vec::new(),
            current_slide_index: 0,
            is_blackout: true,
            timer: TimerState {
                running: false,
                start_time: 0,
                accumulated: 0,
            },
            alert_water: false,
            alert_indicator: false,
        }
    }
}

pub type SharedState = std::sync::Arc<tokio::sync::RwLock<AppState>>;