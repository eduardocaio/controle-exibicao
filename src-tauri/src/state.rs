use serde::{Deserialize, Serialize};

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
    pub active: bool,
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
    pub response_options: Vec<String>,
    pub selected_response: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeetingTime {
    pub id: String,
    pub hour: u32,
    pub minute: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DaySchedule {
    pub day: String, // "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    pub label: String, // "Segunda", "Terça", etc.
    pub enabled: bool,
    pub times: Vec<MeetingTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleConfig {
    pub days: Vec<DaySchedule>,
}

impl Default for ScheduleConfig {
    fn default() -> Self {
        let day_names = [
            ("monday", "Segunda-feira"),
            ("tuesday", "Terça-feira"),
            ("wednesday", "Quarta-feira"),
            ("thursday", "Quinta-feira"),
            ("friday", "Sexta-feira"),
            ("saturday", "Sábado"),
            ("sunday", "Domingo"),
        ];
        
        let days = day_names.iter().map(|(day, label)| {
            DaySchedule {
                day: day.to_string(),
                label: label.to_string(),
                enabled: false,
                times: Vec::new(),
            }
        }).collect();

        ScheduleConfig { days }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CountdownState {
    pub running: bool,
    pub target_time: Option<String>, // "HH:MM"
    pub seconds_left: u64,
    pub label: String,
    pub stopped_manually: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppState {
    pub presentations: Vec<Presentation>,
    pub active_presentation_id: Option<String>,
    pub current_slide_index: usize,
    pub is_blackout: bool,
    pub timer: TimerState,
    pub water_requests: Vec<WaterRequest>,
    pub indicator_request: Option<IndicatorRequest>,
    pub operator_message: Option<OperatorMessage>,
    pub schedule_config: ScheduleConfig,
    pub countdown: CountdownState,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            presentations: Vec::new(),
            active_presentation_id: None,
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
            schedule_config: ScheduleConfig::default(),
            countdown: CountdownState {
                running: false,
                target_time: None,
                seconds_left: 0,
                label: String::new(),
                stopped_manually: false,
            },
        }
    }
}

pub type SharedState = std::sync::Arc<tokio::sync::RwLock<AppState>>;