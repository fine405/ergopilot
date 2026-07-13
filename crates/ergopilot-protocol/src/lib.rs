use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: u16 = 1;
pub const MIN_DESK_HEIGHT_MM: u16 = 620;
pub const MAX_DESK_HEIGHT_MM: u16 = 1_280;
pub const MIN_LUMBAR_SUPPORT_PERCENT: u8 = 0;
pub const MAX_LUMBAR_SUPPORT_PERCENT: u8 = 100;
pub const DEFAULT_LUMBAR_SUPPORT_PERCENT: u8 = 35;

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
}

impl DeviceAction {
    pub fn capability_id(&self) -> &'static str {
        match self {
            Self::DeskMoveToHeight { .. } => "desk.move_to_height",
            Self::ChairSetLumbarSupport { .. } => "chair.set_lumbar_support",
        }
    }

    pub fn target_height_mm(&self) -> Option<u16> {
        match self {
            Self::DeskMoveToHeight { height_mm } => Some(*height_mm),
            Self::ChairSetLumbarSupport { .. } => None,
        }
    }

    pub fn target_lumbar_support_percent(&self) -> Option<u8> {
        match self {
            Self::DeskMoveToHeight { .. } => None,
            Self::ChairSetLumbarSupport { level_percent } => Some(*level_percent),
        }
    }

    pub fn is_satisfied_by(&self, snapshot: &WorkstationSnapshot) -> bool {
        match self {
            Self::DeskMoveToHeight { height_mm } => snapshot.desk_height_mm == *height_mm,
            Self::ChairSetLumbarSupport { level_percent } => {
                snapshot.lumbar_support_percent == *level_percent
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
    pub movement_count: u64,
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
    pub verified_at_ms: u64,
}

const fn default_lumbar_support_percent() -> u8 {
    DEFAULT_LUMBAR_SUPPORT_PERCENT
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandView {
    pub command_id: String,
    pub idempotency_key: String,
    pub status: CommandStatus,
    pub outcome: Option<VerifiedOutcome>,
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
