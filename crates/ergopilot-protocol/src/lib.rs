use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u16 = 1;
pub const MIN_DESK_HEIGHT_MM: u16 = 620;
pub const MAX_DESK_HEIGHT_MM: u16 = 1_280;
pub const MIN_LUMBAR_SUPPORT_PERCENT: u8 = 0;
pub const MAX_LUMBAR_SUPPORT_PERCENT: u8 = 100;
pub const DEFAULT_LUMBAR_SUPPORT_PERCENT: u8 = 35;
pub const MIN_SEAT_HEIGHT_MM: u16 = 420;
pub const MAX_SEAT_HEIGHT_MM: u16 = 550;
pub const DEFAULT_SEAT_HEIGHT_MM: u16 = 470;
pub const MIN_SEAT_DEPTH_MM: u16 = 380;
pub const MAX_SEAT_DEPTH_MM: u16 = 520;
pub const DEFAULT_SEAT_DEPTH_MM: u16 = 450;
pub const MIN_ARMREST_HEIGHT_MM: u16 = 180;
pub const MAX_ARMREST_HEIGHT_MM: u16 = 310;
pub const DEFAULT_ARMREST_HEIGHT_MM: u16 = 240;
pub const MIN_ARMREST_DEPTH_MM: i16 = -60;
pub const MAX_ARMREST_DEPTH_MM: i16 = 60;
pub const DEFAULT_ARMREST_DEPTH_MM: i16 = 0;
pub const MIN_ARMREST_WIDTH_MM: u16 = 420;
pub const MAX_ARMREST_WIDTH_MM: u16 = 560;
pub const DEFAULT_ARMREST_WIDTH_MM: u16 = 480;
pub const MIN_ARMREST_ANGLE_DEG: i16 = -30;
pub const MAX_ARMREST_ANGLE_DEG: i16 = 30;
pub const DEFAULT_ARMREST_ANGLE_DEG: i16 = 0;
pub const MIN_RECLINE_ANGLE_DEG: u16 = 110;
pub const MAX_RECLINE_ANGLE_DEG: u16 = 135;
pub const DEFAULT_RECLINE_ANGLE_DEG: u16 = 110;
pub const DEFAULT_RECLINE_RESISTANCE_PERCENT: u8 = 55;
pub const MIN_HEADREST_HEIGHT_MM: u16 = 0;
pub const MAX_HEADREST_HEIGHT_MM: u16 = 120;
pub const DEFAULT_HEADREST_HEIGHT_MM: u16 = 50;
pub const MIN_HEADREST_ANGLE_DEG: i16 = -30;
pub const MAX_HEADREST_ANGLE_DEG: i16 = 30;
pub const DEFAULT_HEADREST_ANGLE_DEG: i16 = 0;
pub const MIN_LIGHT_COLOR_TEMPERATURE_K: u16 = 2_700;
pub const MAX_LIGHT_COLOR_TEMPERATURE_K: u16 = 6_500;
pub const DEFAULT_LIGHT_BRIGHTNESS_PERCENT: u8 = 70;
pub const DEFAULT_LIGHT_COLOR_TEMPERATURE_K: u16 = 4_300;
pub const MIN_REMINDER_INTERVAL_MINUTES: u16 = 20;
pub const MAX_REMINDER_INTERVAL_MINUTES: u16 = 180;
pub const DEFAULT_REMINDER_INTERVAL_MINUTES: u16 = 45;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChairErgonomics {
    pub seat_height_mm: u16,
    pub seat_depth_mm: u16,
    pub lumbar_support_percent: u8,
    pub armrest_height_mm: u16,
    pub armrest_depth_mm: i16,
    pub armrest_width_mm: u16,
    pub armrest_angle_deg: i16,
    pub recline_angle_deg: u16,
    pub recline_resistance_percent: u8,
    pub recline_locked: bool,
    pub headrest_height_mm: u16,
    pub headrest_angle_deg: i16,
}

impl ChairErgonomics {
    pub fn is_within_safe_envelope(&self) -> bool {
        (MIN_SEAT_HEIGHT_MM..=MAX_SEAT_HEIGHT_MM).contains(&self.seat_height_mm)
            && (MIN_SEAT_DEPTH_MM..=MAX_SEAT_DEPTH_MM).contains(&self.seat_depth_mm)
            && (MIN_LUMBAR_SUPPORT_PERCENT..=MAX_LUMBAR_SUPPORT_PERCENT)
                .contains(&self.lumbar_support_percent)
            && (MIN_ARMREST_HEIGHT_MM..=MAX_ARMREST_HEIGHT_MM).contains(&self.armrest_height_mm)
            && (MIN_ARMREST_DEPTH_MM..=MAX_ARMREST_DEPTH_MM).contains(&self.armrest_depth_mm)
            && (MIN_ARMREST_WIDTH_MM..=MAX_ARMREST_WIDTH_MM).contains(&self.armrest_width_mm)
            && (MIN_ARMREST_ANGLE_DEG..=MAX_ARMREST_ANGLE_DEG).contains(&self.armrest_angle_deg)
            && (MIN_RECLINE_ANGLE_DEG..=MAX_RECLINE_ANGLE_DEG).contains(&self.recline_angle_deg)
            && self.recline_resistance_percent <= 100
            && (MIN_HEADREST_HEIGHT_MM..=MAX_HEADREST_HEIGHT_MM).contains(&self.headrest_height_mm)
            && (MIN_HEADREST_ANGLE_DEG..=MAX_HEADREST_ANGLE_DEG).contains(&self.headrest_angle_deg)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LightConfiguration {
    pub brightness_percent: u8,
    pub color_temperature_k: u16,
}

impl LightConfiguration {
    pub fn is_within_safe_envelope(&self) -> bool {
        self.brightness_percent <= 100
            && (MIN_LIGHT_COLOR_TEMPERATURE_K..=MAX_LIGHT_COLOR_TEMPERATURE_K)
                .contains(&self.color_temperature_k)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderConfiguration {
    pub enabled: bool,
    pub interval_minutes: u16,
}

impl ReminderConfiguration {
    pub fn is_within_safe_envelope(&self) -> bool {
        (MIN_REMINDER_INTERVAL_MINUTES..=MAX_REMINDER_INTERVAL_MINUTES)
            .contains(&self.interval_minutes)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationConfiguration {
    pub desk_height_mm: u16,
    pub chair: ChairErgonomics,
    pub light: LightConfiguration,
    pub reminder: ReminderConfiguration,
}

impl WorkstationConfiguration {
    pub fn is_within_safe_envelope(&self) -> bool {
        (MIN_DESK_HEIGHT_MM..=MAX_DESK_HEIGHT_MM).contains(&self.desk_height_mm)
            && self.chair.is_within_safe_envelope()
            && self.light.is_within_safe_envelope()
            && self.reminder.is_within_safe_envelope()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationProfile {
    pub schema_version: u16,
    pub id: String,
    pub name: String,
    pub configuration: WorkstationConfiguration,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkstationProfileRequest {
    pub id: String,
    pub name: String,
    pub configuration: WorkstationConfiguration,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "input")]
pub enum DeviceAction {
    #[serde(rename = "desk.move_to_height")]
    DeskMoveToHeight {
        #[serde(rename = "heightMm")]
        height_mm: u16,
    },
    #[serde(rename = "chair.set_lumbar_support")]
    ChairSetLumbarSupport {
        #[serde(rename = "levelPercent")]
        level_percent: u8,
    },
    #[serde(rename = "chair.adjust_ergonomics")]
    ChairAdjustErgonomics(ChairErgonomics),
    #[serde(rename = "light.configure")]
    LightConfigure(LightConfiguration),
    #[serde(rename = "reminder.configure")]
    ReminderConfigure(ReminderConfiguration),
}

impl DeviceAction {
    pub fn capability_id(&self) -> &'static str {
        match self {
            Self::DeskMoveToHeight { .. } => "desk.move_to_height",
            Self::ChairSetLumbarSupport { .. } => "chair.set_lumbar_support",
            Self::ChairAdjustErgonomics(_) => "chair.adjust_ergonomics",
            Self::LightConfigure(_) => "light.configure",
            Self::ReminderConfigure(_) => "reminder.configure",
        }
    }

    pub fn target_height_mm(&self) -> Option<u16> {
        match self {
            Self::DeskMoveToHeight { height_mm } => Some(*height_mm),
            Self::ChairSetLumbarSupport { .. }
            | Self::ChairAdjustErgonomics(_)
            | Self::LightConfigure(_)
            | Self::ReminderConfigure(_) => None,
        }
    }

    pub fn target_lumbar_support_percent(&self) -> Option<u8> {
        match self {
            Self::DeskMoveToHeight { .. }
            | Self::ChairAdjustErgonomics(_)
            | Self::LightConfigure(_)
            | Self::ReminderConfigure(_) => None,
            Self::ChairSetLumbarSupport { level_percent } => Some(*level_percent),
        }
    }

    pub fn is_satisfied_by(&self, snapshot: &WorkstationSnapshot) -> bool {
        match self {
            Self::DeskMoveToHeight { height_mm } => snapshot.desk_height_mm == *height_mm,
            Self::ChairSetLumbarSupport { level_percent } => {
                snapshot.lumbar_support_percent == *level_percent
            }
            Self::ChairAdjustErgonomics(configuration) => {
                snapshot.seat_height_mm == configuration.seat_height_mm
                    && snapshot.seat_depth_mm == configuration.seat_depth_mm
                    && snapshot.lumbar_support_percent == configuration.lumbar_support_percent
                    && snapshot.armrest_height_mm == configuration.armrest_height_mm
                    && snapshot.armrest_depth_mm == configuration.armrest_depth_mm
                    && snapshot.armrest_width_mm == configuration.armrest_width_mm
                    && snapshot.armrest_angle_deg == configuration.armrest_angle_deg
                    && snapshot.recline_angle_deg == configuration.recline_angle_deg
                    && snapshot.recline_resistance_percent
                        == configuration.recline_resistance_percent
                    && snapshot.recline_locked == configuration.recline_locked
                    && snapshot.headrest_height_mm == configuration.headrest_height_mm
                    && snapshot.headrest_angle_deg == configuration.headrest_angle_deg
            }
            Self::LightConfigure(configuration) => {
                snapshot.light_brightness_percent == configuration.brightness_percent
                    && snapshot.light_color_temperature_k == configuration.color_temperature_k
            }
            Self::ReminderConfigure(configuration) => {
                snapshot.reminder_enabled == configuration.enabled
                    && snapshot.reminder_interval_minutes == configuration.interval_minutes
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCommand {
    pub schema_version: u16,
    pub command_id: String,
    pub task_run_id: String,
    pub action: DeviceAction,
    pub expected_state_version: u64,
    pub idempotency_key: String,
    pub expires_at_ms: u64,
    pub trace_id: String,
    pub policy_grant_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyGrant {
    pub schema_version: u16,
    pub grant_id: String,
    pub task_run_id: String,
    pub command_id: String,
    pub action: DeviceAction,
    pub expected_state_version: u64,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub rule_ids: Vec<String>,
    pub signature: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyOutcome {
    Allow,
    RequireApproval,
    Deny,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub outcome: PolicyOutcome,
    pub rule_ids: Vec<String>,
    pub reason_code: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkstationSnapshot {
    pub schema_version: u16,
    pub station_id: String,
    pub state_version: u64,
    pub observed_at_ms: u64,
    pub desk_height_mm: u16,
    #[serde(default = "default_lumbar_support_percent")]
    pub lumbar_support_percent: u8,
    #[serde(default = "default_seat_height_mm")]
    pub seat_height_mm: u16,
    #[serde(default = "default_seat_depth_mm")]
    pub seat_depth_mm: u16,
    #[serde(default = "default_armrest_height_mm")]
    pub armrest_height_mm: u16,
    #[serde(default)]
    pub armrest_depth_mm: i16,
    #[serde(default = "default_armrest_width_mm")]
    pub armrest_width_mm: u16,
    #[serde(default)]
    pub armrest_angle_deg: i16,
    #[serde(default = "default_recline_angle_deg")]
    pub recline_angle_deg: u16,
    #[serde(default = "default_recline_resistance_percent")]
    pub recline_resistance_percent: u8,
    #[serde(default = "default_true")]
    pub recline_locked: bool,
    #[serde(default = "default_headrest_height_mm")]
    pub headrest_height_mm: u16,
    #[serde(default)]
    pub headrest_angle_deg: i16,
    #[serde(default = "default_light_brightness_percent")]
    pub light_brightness_percent: u8,
    #[serde(default = "default_light_color_temperature_k")]
    pub light_color_temperature_k: u16,
    #[serde(default = "default_true")]
    pub reminder_enabled: bool,
    #[serde(default = "default_reminder_interval_minutes")]
    pub reminder_interval_minutes: u16,
    #[serde(default)]
    pub reminder_started_at_ms: u64,
    pub movement_count: u64,
}

impl Default for WorkstationSnapshot {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            station_id: String::new(),
            state_version: 0,
            observed_at_ms: 0,
            desk_height_mm: 720,
            lumbar_support_percent: DEFAULT_LUMBAR_SUPPORT_PERCENT,
            seat_height_mm: DEFAULT_SEAT_HEIGHT_MM,
            seat_depth_mm: DEFAULT_SEAT_DEPTH_MM,
            armrest_height_mm: DEFAULT_ARMREST_HEIGHT_MM,
            armrest_depth_mm: DEFAULT_ARMREST_DEPTH_MM,
            armrest_width_mm: DEFAULT_ARMREST_WIDTH_MM,
            armrest_angle_deg: DEFAULT_ARMREST_ANGLE_DEG,
            recline_angle_deg: DEFAULT_RECLINE_ANGLE_DEG,
            recline_resistance_percent: DEFAULT_RECLINE_RESISTANCE_PERCENT,
            recline_locked: true,
            headrest_height_mm: DEFAULT_HEADREST_HEIGHT_MM,
            headrest_angle_deg: DEFAULT_HEADREST_ANGLE_DEG,
            light_brightness_percent: DEFAULT_LIGHT_BRIGHTNESS_PERCENT,
            light_color_temperature_k: DEFAULT_LIGHT_COLOR_TEMPERATURE_K,
            reminder_enabled: true,
            reminder_interval_minutes: DEFAULT_REMINDER_INTERVAL_MINUTES,
            reminder_started_at_ms: 0,
            movement_count: 0,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeskMotionProgress {
    pub sequence: u64,
    pub command_id: String,
    pub progress_percent: u8,
    pub desk_height_mm: u16,
    pub at_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandStatus {
    Accepted,
    Executing,
    OutcomeUnknown,
    Succeeded,
    Failed,
}

impl CommandStatus {
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Succeeded | Self::Failed)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedOutcome {
    pub state_version: u64,
    pub desk_height_mm: u16,
    #[serde(default = "default_lumbar_support_percent")]
    pub lumbar_support_percent: u8,
    #[serde(default = "default_seat_height_mm")]
    pub seat_height_mm: u16,
    #[serde(default = "default_seat_depth_mm")]
    pub seat_depth_mm: u16,
    #[serde(default = "default_armrest_height_mm")]
    pub armrest_height_mm: u16,
    #[serde(default)]
    pub armrest_depth_mm: i16,
    #[serde(default = "default_armrest_width_mm")]
    pub armrest_width_mm: u16,
    #[serde(default)]
    pub armrest_angle_deg: i16,
    #[serde(default = "default_recline_angle_deg")]
    pub recline_angle_deg: u16,
    #[serde(default = "default_recline_resistance_percent")]
    pub recline_resistance_percent: u8,
    #[serde(default = "default_true")]
    pub recline_locked: bool,
    #[serde(default = "default_headrest_height_mm")]
    pub headrest_height_mm: u16,
    #[serde(default)]
    pub headrest_angle_deg: i16,
    #[serde(default = "default_light_brightness_percent")]
    pub light_brightness_percent: u8,
    #[serde(default = "default_light_color_temperature_k")]
    pub light_color_temperature_k: u16,
    #[serde(default = "default_true")]
    pub reminder_enabled: bool,
    #[serde(default = "default_reminder_interval_minutes")]
    pub reminder_interval_minutes: u16,
    #[serde(default)]
    pub reminder_started_at_ms: u64,
    pub verified_at_ms: u64,
}

impl VerifiedOutcome {
    pub fn from_snapshot(snapshot: &WorkstationSnapshot, verified_at_ms: u64) -> Self {
        Self {
            state_version: snapshot.state_version,
            desk_height_mm: snapshot.desk_height_mm,
            lumbar_support_percent: snapshot.lumbar_support_percent,
            seat_height_mm: snapshot.seat_height_mm,
            seat_depth_mm: snapshot.seat_depth_mm,
            armrest_height_mm: snapshot.armrest_height_mm,
            armrest_depth_mm: snapshot.armrest_depth_mm,
            armrest_width_mm: snapshot.armrest_width_mm,
            armrest_angle_deg: snapshot.armrest_angle_deg,
            recline_angle_deg: snapshot.recline_angle_deg,
            recline_resistance_percent: snapshot.recline_resistance_percent,
            recline_locked: snapshot.recline_locked,
            headrest_height_mm: snapshot.headrest_height_mm,
            headrest_angle_deg: snapshot.headrest_angle_deg,
            light_brightness_percent: snapshot.light_brightness_percent,
            light_color_temperature_k: snapshot.light_color_temperature_k,
            reminder_enabled: snapshot.reminder_enabled,
            reminder_interval_minutes: snapshot.reminder_interval_minutes,
            reminder_started_at_ms: snapshot.reminder_started_at_ms,
            verified_at_ms,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandFailureReason {
    ActuatorFault,
}

const fn default_lumbar_support_percent() -> u8 {
    DEFAULT_LUMBAR_SUPPORT_PERCENT
}

const fn default_seat_height_mm() -> u16 {
    DEFAULT_SEAT_HEIGHT_MM
}

const fn default_seat_depth_mm() -> u16 {
    DEFAULT_SEAT_DEPTH_MM
}

const fn default_armrest_height_mm() -> u16 {
    DEFAULT_ARMREST_HEIGHT_MM
}

const fn default_armrest_width_mm() -> u16 {
    DEFAULT_ARMREST_WIDTH_MM
}

const fn default_recline_angle_deg() -> u16 {
    DEFAULT_RECLINE_ANGLE_DEG
}

const fn default_recline_resistance_percent() -> u8 {
    DEFAULT_RECLINE_RESISTANCE_PERCENT
}

const fn default_headrest_height_mm() -> u16 {
    DEFAULT_HEADREST_HEIGHT_MM
}

const fn default_light_brightness_percent() -> u8 {
    DEFAULT_LIGHT_BRIGHTNESS_PERCENT
}

const fn default_light_color_temperature_k() -> u16 {
    DEFAULT_LIGHT_COLOR_TEMPERATURE_K
}

const fn default_reminder_interval_minutes() -> u16 {
    DEFAULT_REMINDER_INTERVAL_MINUTES
}

const fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandView {
    pub command_id: String,
    pub idempotency_key: String,
    pub status: CommandStatus,
    pub outcome: Option<VerifiedOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<CommandFailureReason>,
    pub was_replayed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandEvent {
    pub sequence: u64,
    pub command_id: String,
    pub event_type: CommandEventType,
    pub at_ms: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommandEventType {
    Accepted,
    Executing,
    OutcomeUnknown,
    VerifiedSucceeded,
    VerificationFailed,
    ExecutionFailed,
    ReconciliationPending,
    ReconciledSucceeded,
}

impl CommandEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accepted => "accepted",
            Self::Executing => "executing",
            Self::OutcomeUnknown => "outcome_unknown",
            Self::VerifiedSucceeded => "verified_succeeded",
            Self::VerificationFailed => "verification_failed",
            Self::ExecutionFailed => "execution_failed",
            Self::ReconciliationPending => "reconciliation_pending",
            Self::ReconciledSucceeded => "reconciled_succeeded",
        }
    }
}
