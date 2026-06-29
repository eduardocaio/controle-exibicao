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
    pub start_time: u64,
    pub accumulated: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaterRequest {
    pub id: String,
    pub timestamp: u64,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndicatorRequest {
    pub timestamp: u64,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperatorMessage {
    pub id: String,
    pub text: String,
    pub timestamp: u64,
    pub acknowledged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub slides: Vec<Slide>,
    pub current_slide_index: usize,
    pub is_blackout: bool,
    pub timer: TimerState,
    pub water_requests: Vec<WaterRequest>,
    pub indicator_request: Option<IndicatorRequest>,
    pub operator_message: Option<OperatorMessage>,
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
            water_requests: Vec::new(),
            indicator_request: None,
            operator_message: None,
        }
    }
}

pub type SharedState = std::sync::Arc<tokio::sync::RwLock<AppState>>;