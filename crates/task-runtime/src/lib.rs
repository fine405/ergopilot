use ergopilot_protocol::{
    CommandEvent, CommandFailureReason, CommandStatus, CommandView, DeskMotionProgress,
    DeviceAction, DeviceCommand, PolicyDecision, PolicyGrant, PolicyOutcome, WorkstationSnapshot,
    SCHEMA_VERSION,
};
use policy_core::{GrantRequest, PolicyAuthority, PolicyError};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use station_core::{DeviceAdapter, DeviceErrorKind, RuntimeError, StationRuntime};
use std::{path::Path, time::Duration};
use thiserror::Error;

const MAX_RECOVERY_ATTEMPTS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskGoal {
    PrepareFocusSession,
    AdjustSeatedSupport,
    RelieveNeckDiscomfort,
    RestoreProfile,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InterruptionPolicy {
    Normal,
    CriticalOnly,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskConstraints {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interruption_policy: Option<InterruptionPolicy>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedStep {
    pub step_id: String,
    pub action: DeviceAction,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSpec {
    pub schema_version: u16,
    pub task_id: String,
    pub goal: TaskGoal,
    pub requested_by: String,
    pub constraints: TaskConstraints,
    pub assumptions: Vec<String>,
    pub steps: Vec<PlannedStep>,
}

impl TaskSpec {
    pub fn prepare_focus_session(
        task_id: impl Into<String>,
        requested_by: impl Into<String>,
        desk_height_mm: u16,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            task_id: task_id.into(),
            goal: TaskGoal::PrepareFocusSession,
            requested_by: requested_by.into(),
            constraints: TaskConstraints::default(),
            assumptions: Vec::new(),
            steps: vec![PlannedStep {
                step_id: "desk-1".into(),
                action: DeviceAction::DeskMoveToHeight {
                    height_mm: desk_height_mm,
                },
            }],
        }
    }

    pub fn adjust_seated_support(
        task_id: impl Into<String>,
        requested_by: impl Into<String>,
        lumbar_support_percent: u8,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            task_id: task_id.into(),
            goal: TaskGoal::AdjustSeatedSupport,
            requested_by: requested_by.into(),
            constraints: TaskConstraints::default(),
            assumptions: Vec::new(),
            steps: vec![PlannedStep {
                step_id: "chair-1".into(),
                action: DeviceAction::ChairSetLumbarSupport {
                    level_percent: lumbar_support_percent,
                },
            }],
        }
    }

    pub fn restore_profile(
        task_id: impl Into<String>,
        requested_by: impl Into<String>,
        desk_height_mm: u16,
        lumbar_support_percent: u8,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            task_id: task_id.into(),
            goal: TaskGoal::RestoreProfile,
            requested_by: requested_by.into(),
            constraints: TaskConstraints::default(),
            assumptions: Vec::new(),
            steps: vec![
                PlannedStep {
                    step_id: "desk-1".into(),
                    action: DeviceAction::DeskMoveToHeight {
                        height_mm: desk_height_mm,
                    },
                },
                PlannedStep {
                    step_id: "chair-1".into(),
                    action: DeviceAction::ChairSetLumbarSupport {
                        level_percent: lumbar_support_percent,
                    },
                },
            ],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskRunStatus {
    AwaitingApproval,
    Executing,
    Completed,
    OutcomeUnknown,
    Failed,
    Denied,
    Suspended,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuspensionReason {
    DeviceUnavailable,
    ActuatorFault,
    StaleState,
    Expired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Expired,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalView {
    pub approval_id: String,
    pub expires_at_ms: u64,
    pub status: ApprovalStatus,
    pub approved_by: Option<String>,
    pub approved_at_ms: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskEventType {
    RunStarted,
    ApprovalRequired,
    ApprovalGranted,
    ApprovalExpired,
    CommandDispatched,
    RunCompleted,
    OutcomeUnknown,
    RunFailed,
    PolicyDenied,
    RunReconciled,
    RunResumeAttempted,
    RunResumed,
    RunSuspended,
    RunCancelled,
}

impl TaskEventType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::RunStarted => "run_started",
            Self::ApprovalRequired => "approval_required",
            Self::ApprovalGranted => "approval_granted",
            Self::ApprovalExpired => "approval_expired",
            Self::CommandDispatched => "command_dispatched",
            Self::RunCompleted => "run_completed",
            Self::OutcomeUnknown => "outcome_unknown",
            Self::RunFailed => "run_failed",
            Self::PolicyDenied => "policy_denied",
            Self::RunReconciled => "run_reconciled",
            Self::RunResumeAttempted => "run_resume_attempted",
            Self::RunResumed => "run_resumed",
            Self::RunSuspended => "run_suspended",
            Self::RunCancelled => "run_cancelled",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub sequence: u64,
    pub event_type: TaskEventType,
    pub at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletedTaskStep {
    pub step_id: String,
    pub command: CommandView,
    pub command_events: Vec<CommandEvent>,
    pub desk_motion_progress: Vec<DeskMotionProgress>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskRunView {
    pub run_id: String,
    pub task_id: String,
    pub task: TaskSpec,
    pub status: TaskRunStatus,
    #[serde(default)]
    pub suspension_reason: Option<SuspensionReason>,
    pub approval: Option<ApprovalView>,
    pub command: Option<CommandView>,
    #[serde(default)]
    pub command_events: Vec<CommandEvent>,
    #[serde(default)]
    pub desk_motion_progress: Vec<DeskMotionProgress>,
    #[serde(default)]
    pub completed_steps: Vec<CompletedTaskStep>,
    #[serde(default)]
    pub command_attempts: Vec<CompletedTaskStep>,
    pub events: Vec<TaskEvent>,
    pub policy_decision: PolicyDecision,
}

#[derive(Debug, Error)]
pub enum TaskRuntimeError {
    #[error(transparent)]
    Station(#[from] RuntimeError),
    #[error(transparent)]
    Policy(#[from] PolicyError),
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error("task run {run_id} was not found")]
    RunNotFound { run_id: String },
    #[error("task run {run_id} contains inconsistent persisted command state")]
    CorruptRun { run_id: String },
    #[error("task id {task_id} was already used for a different specification")]
    TaskIdConflict { task_id: String },
    #[error("unsupported task schema version {actual}; this runtime accepts version {expected}")]
    UnsupportedTaskSchemaVersion { expected: u16, actual: u16 },
    #[error("invalid task specification: {reason}")]
    InvalidTaskSpec { reason: &'static str },
    #[error("approval belongs to {expected}, but was submitted by {actual}")]
    UnauthorizedApprover { expected: String, actual: String },
    #[error("task cancellation belongs to {expected}, but was submitted by {actual}")]
    UnauthorizedCanceller { expected: String, actual: String },
    #[error("task run {run_id} is not awaiting approval")]
    RunNotApprovable { run_id: String },
    #[error("task run {run_id} has no matching pending device command")]
    PendingCommandNotFound { run_id: String },
    #[error("task run {run_id} is suspended and cannot be reconciled")]
    RunNotReconcilable { run_id: String },
    #[error("task run {run_id} is not resumable")]
    RunNotResumable { run_id: String },
    #[error("task run {run_id} is not cancellable")]
    RunNotCancellable { run_id: String },
    #[error("task run {run_id} exhausted its {max_attempts} recovery attempts")]
    RecoveryBudgetExhausted { run_id: String, max_attempts: usize },
    #[error("automatic allow is not implemented for this task goal")]
    UnsupportedAutomaticAllow,
    #[error("approval expired at {expires_at_ms}, current time is {now_ms}")]
    ApprovalExpired { expires_at_ms: u64, now_ms: u64 },
}

pub struct TaskRuntime<D> {
    connection: Connection,
    station: StationRuntime<D>,
    policy_authority: PolicyAuthority,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredRun {
    expected_state_version: Option<u64>,
    #[serde(default)]
    current_step_index: usize,
    view: TaskRunView,
    command: Option<DeviceCommand>,
    grant: Option<PolicyGrant>,
}

enum ContinuationUpdate {
    Suspended(SuspensionReason),
    ActuatorFault {
        command: CommandView,
        command_events: Vec<CommandEvent>,
        desk_motion_progress: Vec<DeskMotionProgress>,
    },
    CommandResult {
        status: TaskRunStatus,
        event_type: TaskEventType,
        command: CommandView,
        command_events: Vec<CommandEvent>,
        desk_motion_progress: Vec<DeskMotionProgress>,
    },
}

impl<D: DeviceAdapter> TaskRuntime<D> {
    pub fn open(
        path: impl AsRef<Path>,
        device: D,
        policy_authority: PolicyAuthority,
    ) -> Result<Self, TaskRuntimeError> {
        let path = path.as_ref();
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS task_runs (
                run_id TEXT PRIMARY KEY,
                stored_json TEXT NOT NULL,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );
            ",
        )?;
        let station = StationRuntime::open(path, device, policy_authority.verifier())?;

        Ok(Self {
            connection,
            station,
            policy_authority,
        })
    }

    pub fn start(&mut self, spec: TaskSpec, now_ms: u64) -> Result<TaskRunView, TaskRuntimeError> {
        validate_task_spec(&spec)?;
        let run_id = format!("run-{}", spec.task_id);
        if let Some(existing) = self.try_load_run(&run_id)? {
            if existing.view.task == spec {
                return Ok(existing.view);
            }
            return Err(TaskRuntimeError::TaskIdConflict {
                task_id: spec.task_id,
            });
        }
        let policy_decision = evaluate_task_policy(&self.policy_authority, &spec);
        let (status, approval, second_event, expected_state_version) = match policy_decision.outcome
        {
            PolicyOutcome::RequireApproval => (
                TaskRunStatus::AwaitingApproval,
                Some(ApprovalView {
                    approval_id: format!("approval-{run_id}"),
                    expires_at_ms: now_ms + 60_000,
                    status: ApprovalStatus::Pending,
                    approved_by: None,
                    approved_at_ms: None,
                }),
                TaskEventType::ApprovalRequired,
                Some(self.station.snapshot(now_ms)?.state_version),
            ),
            PolicyOutcome::Deny => (
                TaskRunStatus::Denied,
                None,
                TaskEventType::PolicyDenied,
                None,
            ),
            PolicyOutcome::Allow => return Err(TaskRuntimeError::UnsupportedAutomaticAllow),
        };
        let view = TaskRunView {
            run_id: run_id.clone(),
            task_id: spec.task_id.clone(),
            task: spec,
            status,
            suspension_reason: None,
            approval,
            command: None,
            command_events: Vec::new(),
            desk_motion_progress: Vec::new(),
            completed_steps: Vec::new(),
            command_attempts: Vec::new(),
            events: vec![
                TaskEvent {
                    sequence: 1,
                    event_type: TaskEventType::RunStarted,
                    at_ms: now_ms,
                },
                TaskEvent {
                    sequence: 2,
                    event_type: second_event,
                    at_ms: now_ms,
                },
            ],
            policy_decision,
        };
        self.save_run(
            &StoredRun {
                expected_state_version,
                current_step_index: 0,
                view: view.clone(),
                command: None,
                grant: None,
            },
            now_ms,
        )?;
        Ok(view)
    }

    pub fn inspect(&self, run_id: &str) -> Result<TaskRunView, TaskRuntimeError> {
        let mut stored = self.load_run(run_id)?;
        self.refresh_command_events(&mut stored)?;
        Ok(stored.view)
    }

    pub fn approve(
        &mut self,
        run_id: &str,
        approved_by: &str,
        now_ms: u64,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        let stored = self.prepare_approval(run_id, approved_by, now_ms)?;
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Suspended
        ) {
            return Ok(stored.view);
        }

        self.execute_approved_steps(stored, now_ms, TaskEventType::RunCompleted)
    }

    fn execute_approved_steps(
        &mut self,
        mut stored: StoredRun,
        now_ms: u64,
        completed_event: TaskEventType,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        loop {
            let run_id = stored.view.run_id.clone();
            let (command, grant) = match (&stored.command, &stored.grant) {
                (Some(command), Some(grant)) => (command.clone(), grant.clone()),
                _ => return Err(TaskRuntimeError::CorruptRun { run_id }),
            };
            let mut device_error = None;
            let command_view = match self.station.execute(command.clone(), &grant, now_ms) {
                Ok(command_view) => command_view,
                Err(RuntimeError::StaleState { .. }) => {
                    stored.view.status = TaskRunStatus::Suspended;
                    stored.view.suspension_reason = Some(SuspensionReason::StaleState);
                    append_event(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                    self.save_run(&stored, now_ms)?;
                    return Ok(stored.view);
                }
                Err(error @ RuntimeError::Device(_)) => {
                    let device_error_kind = match &error {
                        RuntimeError::Device(device_error) => device_error.kind(),
                        _ => unreachable!("matched RuntimeError::Device"),
                    };
                    if let Some(command_view) = self.station.inspect_command(&command)? {
                        if device_error_kind == DeviceErrorKind::ActuatorFault
                            || command_is_actuator_fault(&command_view)
                        {
                            stored.view.status = TaskRunStatus::Suspended;
                            stored.view.suspension_reason = Some(SuspensionReason::ActuatorFault);
                            stored.view.command = Some(command_view);
                            self.refresh_command_events(&mut stored)?;
                            record_current_command_attempt(&mut stored)?;
                            append_event(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                            self.save_run(&stored, now_ms)?;
                            return Ok(stored.view);
                        }
                        device_error = Some(error);
                        command_view
                    } else if device_error_kind == DeviceErrorKind::Unavailable {
                        stored.view.status = TaskRunStatus::Suspended;
                        stored.view.suspension_reason = Some(SuspensionReason::DeviceUnavailable);
                        append_event(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                        self.save_run(&stored, now_ms)?;
                        return Ok(stored.view);
                    } else {
                        stored.view.status = TaskRunStatus::Failed;
                        append_event(&mut stored.view, TaskEventType::RunFailed, now_ms);
                        self.save_run(&stored, now_ms)?;
                        return Err(error.into());
                    }
                }
                Err(error) => return Err(error.into()),
            };
            if command_is_actuator_fault(&command_view) {
                stored.view.status = TaskRunStatus::Suspended;
                stored.view.suspension_reason = Some(SuspensionReason::ActuatorFault);
                stored.view.command = Some(command_view);
                self.refresh_command_events(&mut stored)?;
                record_current_command_attempt(&mut stored)?;
                append_event(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                self.save_run(&stored, now_ms)?;
                return Ok(stored.view);
            }
            let (status, event_type) = task_outcome(command_view.status, completed_event);
            stored.view.status = status;
            stored.view.suspension_reason = None;
            stored.view.command = Some(command_view);
            self.refresh_command_events(&mut stored)?;

            if status == TaskRunStatus::Completed {
                record_completed_step(&mut stored)?;
                if prepare_next_step(&self.policy_authority, &mut stored, now_ms)? {
                    self.save_run(&stored, now_ms)?;
                    continue;
                }
            }

            append_event(&mut stored.view, event_type, now_ms);
            self.save_run(&stored, now_ms)?;
            if status == TaskRunStatus::Failed {
                if let Some(error) = device_error {
                    return Err(error.into());
                }
            }
            return Ok(stored.view);
        }
    }

    pub fn cancel(
        &mut self,
        run_id: &str,
        cancelled_by: &str,
        now_ms: u64,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored_json = transaction
            .query_row(
                "SELECT stored_json FROM task_runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| TaskRuntimeError::RunNotFound {
                run_id: run_id.into(),
            })?;
        let mut stored = deserialize_stored_run(run_id, &stored_json)?;
        if stored.view.task.requested_by != cancelled_by {
            return Err(TaskRuntimeError::UnauthorizedCanceller {
                expected: stored.view.task.requested_by.clone(),
                actual: cancelled_by.into(),
            });
        }
        if stored.view.status == TaskRunStatus::Cancelled {
            transaction.commit()?;
            return Ok(stored.view);
        }
        if stored.view.status != TaskRunStatus::AwaitingApproval {
            return Err(TaskRuntimeError::RunNotCancellable {
                run_id: run_id.into(),
            });
        }
        if stored.command.is_some() || stored.grant.is_some() {
            return Err(TaskRuntimeError::CorruptRun {
                run_id: run_id.into(),
            });
        }
        stored.view.status = TaskRunStatus::Cancelled;
        stored.view.suspension_reason = None;
        stored
            .view
            .approval
            .as_mut()
            .ok_or_else(|| TaskRuntimeError::CorruptRun {
                run_id: run_id.into(),
            })?
            .status = ApprovalStatus::Cancelled;
        append_event(&mut stored.view, TaskEventType::RunCancelled, now_ms);
        let stored_json = serde_json::to_string(&stored)?;
        transaction.execute(
            "UPDATE task_runs
             SET stored_json = ?1, updated_at_ms = ?2
             WHERE run_id = ?3",
            params![stored_json, now_ms, run_id],
        )?;
        transaction.commit()?;
        Ok(stored.view)
    }

    pub fn station_snapshot(
        &mut self,
        observed_at_ms: u64,
    ) -> Result<WorkstationSnapshot, TaskRuntimeError> {
        Ok(self.station.snapshot(observed_at_ms)?)
    }

    fn prepare_approval(
        &mut self,
        run_id: &str,
        approved_by: &str,
        now_ms: u64,
    ) -> Result<StoredRun, TaskRuntimeError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored_json = transaction
            .query_row(
                "SELECT stored_json FROM task_runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| TaskRuntimeError::RunNotFound {
                run_id: run_id.into(),
            })?;
        let mut stored = deserialize_stored_run(run_id, &stored_json)?;
        if stored.view.task.requested_by != approved_by {
            return Err(TaskRuntimeError::UnauthorizedApprover {
                expected: stored.view.task.requested_by.clone(),
                actual: approved_by.into(),
            });
        }
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Suspended
        ) {
            transaction.commit()?;
            return Ok(stored);
        }
        if matches!(
            stored.view.status,
            TaskRunStatus::Denied | TaskRunStatus::Cancelled
        ) {
            return Err(TaskRuntimeError::RunNotApprovable {
                run_id: run_id.into(),
            });
        }

        let expires_at_ms = stored
            .view
            .approval
            .as_ref()
            .map(|approval| approval.expires_at_ms)
            .ok_or_else(|| TaskRuntimeError::CorruptRun {
                run_id: run_id.into(),
            })?;
        let expired = expires_at_ms <= now_ms && stored.command.is_none();
        let should_save = if expired {
            if let Some(approval) = &mut stored.view.approval {
                approval.status = ApprovalStatus::Expired;
            }
            append_event(&mut stored.view, TaskEventType::ApprovalExpired, now_ms);
            true
        } else if stored.command.is_none() && stored.grant.is_none() {
            let command = command_for(&stored, run_id, expires_at_ms)?;
            let grant = issue_grant(&self.policy_authority, &command, now_ms)?;
            if let Some(approval) = &mut stored.view.approval {
                approval.status = ApprovalStatus::Approved;
                approval.approved_by = Some(approved_by.into());
                approval.approved_at_ms = Some(now_ms);
            }
            append_event(&mut stored.view, TaskEventType::ApprovalGranted, now_ms);
            append_event(&mut stored.view, TaskEventType::CommandDispatched, now_ms);
            stored.view.status = TaskRunStatus::Executing;
            stored.command = Some(command);
            stored.grant = Some(grant);
            true
        } else {
            false
        };
        if should_save {
            let stored_json = serde_json::to_string(&stored)?;
            transaction.execute(
                "UPDATE task_runs
                 SET stored_json = ?1, updated_at_ms = ?2
                 WHERE run_id = ?3",
                params![stored_json, now_ms, run_id],
            )?;
        }
        transaction.commit()?;
        if expired {
            return Err(TaskRuntimeError::ApprovalExpired {
                expires_at_ms,
                now_ms,
            });
        }
        Ok(stored)
    }

    pub fn reconcile(
        &mut self,
        run_id: &str,
        now_ms: u64,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        let stored = self.load_run(run_id)?;
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Denied
        ) {
            return Ok(stored.view);
        }
        if stored.view.status == TaskRunStatus::Suspended {
            return Err(TaskRuntimeError::RunNotReconcilable {
                run_id: run_id.into(),
            });
        }
        self.continue_run(stored, now_ms, TaskEventType::RunReconciled)
    }

    pub fn resume(&mut self, run_id: &str, now_ms: u64) -> Result<TaskRunView, TaskRuntimeError> {
        let current = self.load_run(run_id)?;
        if matches!(
            current.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Denied
        ) {
            return Ok(current.view);
        }
        let suspension_reason = current.view.suspension_reason;
        if current.view.status != TaskRunStatus::Suspended
            || !matches!(
                suspension_reason,
                Some(SuspensionReason::DeviceUnavailable | SuspensionReason::ActuatorFault)
            )
        {
            return Err(TaskRuntimeError::RunNotResumable {
                run_id: run_id.into(),
            });
        }
        if suspension_reason == Some(SuspensionReason::ActuatorFault) {
            let (stored, reserved) = self.reserve_actuator_recovery(&current, now_ms)?;
            if !reserved {
                return Ok(stored.view);
            }
            return self.execute_approved_steps(stored, now_ms, TaskEventType::RunResumed);
        }
        if let Some(command) = &current.command {
            if let Some(command_view) = self.station.inspect_command(command)? {
                let (status, event_type) =
                    task_outcome(command_view.status, TaskEventType::RunResumed);
                let command_events = self.station.events(&command.command_id)?;
                let desk_motion_progress =
                    self.station.desk_motion_progress(&command.command_id)?;
                let (view, update_applied) = self.commit_continuation_update(
                    run_id,
                    current.view.status,
                    current.view.suspension_reason,
                    ContinuationUpdate::CommandResult {
                        status,
                        event_type,
                        command: command_view,
                        command_events,
                        desk_motion_progress,
                    },
                    now_ms,
                )?;
                if update_applied && view.status == TaskRunStatus::Executing {
                    let stored = self.load_run(run_id)?;
                    return self.execute_approved_steps(stored, now_ms, TaskEventType::RunResumed);
                }
                return Ok(view);
            }
        }
        let mut stored = self.reserve_resume_attempt(run_id, now_ms)?;
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Denied
        ) {
            self.refresh_command_events(&mut stored)?;
            return Ok(stored.view);
        }
        self.continue_run(stored, now_ms, TaskEventType::RunResumed)
    }

    fn reserve_resume_attempt(
        &mut self,
        run_id: &str,
        now_ms: u64,
    ) -> Result<StoredRun, TaskRuntimeError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored_json = transaction
            .query_row(
                "SELECT stored_json FROM task_runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| TaskRuntimeError::RunNotFound {
                run_id: run_id.into(),
            })?;
        let mut stored = deserialize_stored_run(run_id, &stored_json)?;
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Denied
        ) {
            transaction.commit()?;
            return Ok(stored);
        }
        if stored.view.status != TaskRunStatus::Suspended
            || stored.view.suspension_reason != Some(SuspensionReason::DeviceUnavailable)
        {
            return Err(TaskRuntimeError::RunNotResumable {
                run_id: run_id.into(),
            });
        }
        let attempt_count = stored
            .view
            .events
            .iter()
            .filter(|event| event.event_type == TaskEventType::RunResumeAttempted)
            .count();
        if attempt_count >= MAX_RECOVERY_ATTEMPTS {
            return Err(TaskRuntimeError::RecoveryBudgetExhausted {
                run_id: run_id.into(),
                max_attempts: MAX_RECOVERY_ATTEMPTS,
            });
        }
        append_event(&mut stored.view, TaskEventType::RunResumeAttempted, now_ms);
        let stored_json = serde_json::to_string(&stored)?;
        transaction.execute(
            "UPDATE task_runs
             SET stored_json = ?1, updated_at_ms = ?2
             WHERE run_id = ?3",
            params![stored_json, now_ms, run_id],
        )?;
        transaction.commit()?;
        Ok(stored)
    }

    fn reserve_actuator_recovery(
        &mut self,
        current: &StoredRun,
        now_ms: u64,
    ) -> Result<(StoredRun, bool), TaskRuntimeError> {
        let run_id = current.view.run_id.clone();
        let failed_command_id = current
            .command
            .as_ref()
            .map(|command| command.command_id.clone())
            .ok_or_else(|| TaskRuntimeError::PendingCommandNotFound {
                run_id: run_id.clone(),
            })?;
        let expires_at_ms = current
            .view
            .approval
            .as_ref()
            .map(|approval| approval.expires_at_ms)
            .ok_or_else(|| TaskRuntimeError::CorruptRun {
                run_id: run_id.clone(),
            })?;
        self.station.prepare_command_recovery(&failed_command_id)?;
        let observed_state_version = if expires_at_ms > now_ms {
            Some(self.station.snapshot(now_ms)?.state_version)
        } else {
            None
        };

        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored_json = transaction
            .query_row(
                "SELECT stored_json FROM task_runs WHERE run_id = ?1",
                params![&run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| TaskRuntimeError::RunNotFound {
                run_id: run_id.clone(),
            })?;
        let mut stored = deserialize_stored_run(&run_id, &stored_json)?;
        if stored.view.status != TaskRunStatus::Suspended
            || stored.view.suspension_reason != Some(SuspensionReason::ActuatorFault)
        {
            transaction.commit()?;
            return Ok((stored, false));
        }
        let attempt_count = stored
            .view
            .events
            .iter()
            .filter(|event| event.event_type == TaskEventType::RunResumeAttempted)
            .count();
        if attempt_count >= MAX_RECOVERY_ATTEMPTS {
            return Err(TaskRuntimeError::RecoveryBudgetExhausted {
                run_id,
                max_attempts: MAX_RECOVERY_ATTEMPTS,
            });
        }
        append_event(&mut stored.view, TaskEventType::RunResumeAttempted, now_ms);
        if expires_at_ms <= now_ms {
            stored.view.suspension_reason = Some(SuspensionReason::Expired);
            append_event(&mut stored.view, TaskEventType::RunSuspended, now_ms);
            let stored_json = serde_json::to_string(&stored)?;
            transaction.execute(
                "UPDATE task_runs
                 SET stored_json = ?1, updated_at_ms = ?2
                 WHERE run_id = ?3",
                params![stored_json, now_ms, &run_id],
            )?;
            transaction.commit()?;
            return Ok((stored, false));
        }

        stored.expected_state_version = observed_state_version;
        let recovery_attempt = attempt_count + 1;
        let mut command = command_for(&stored, &run_id, expires_at_ms)?;
        command.command_id = format!("{}-recovery-{recovery_attempt}", command.command_id);
        command.idempotency_key =
            format!("{}-recovery-{recovery_attempt}", command.idempotency_key);
        command.policy_grant_id =
            format!("{}-recovery-{recovery_attempt}", command.policy_grant_id);
        let grant = issue_grant(&self.policy_authority, &command, now_ms)?;
        stored.command = Some(command);
        stored.grant = Some(grant);
        stored.view.status = TaskRunStatus::Executing;
        stored.view.suspension_reason = None;
        record_current_command_attempt(&mut stored)?;
        stored.view.command = None;
        stored.view.command_events.clear();
        stored.view.desk_motion_progress.clear();
        append_event(&mut stored.view, TaskEventType::CommandDispatched, now_ms);
        let stored_json = serde_json::to_string(&stored)?;
        transaction.execute(
            "UPDATE task_runs
             SET stored_json = ?1, updated_at_ms = ?2
             WHERE run_id = ?3",
            params![stored_json, now_ms, &run_id],
        )?;
        transaction.commit()?;
        Ok((stored, true))
    }

    fn continue_run(
        &mut self,
        stored: StoredRun,
        now_ms: u64,
        completed_event: TaskEventType,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        let run_id = stored.view.run_id.clone();
        let expected_status = stored.view.status;
        let expected_reason = stored.view.suspension_reason;
        let (command, grant) = match (&stored.command, &stored.grant) {
            (Some(command), Some(grant)) => (command.clone(), grant.clone()),
            _ => {
                return Err(TaskRuntimeError::PendingCommandNotFound {
                    run_id: stored.view.run_id.clone(),
                })
            }
        };
        let mut device_error = None;
        let command_view = match self.station.resume_command(command.clone(), &grant, now_ms) {
            Ok(command_view) => command_view,
            Err(RuntimeError::StaleState { .. }) => {
                let (view, _) = self.commit_continuation_update(
                    &run_id,
                    expected_status,
                    expected_reason,
                    ContinuationUpdate::Suspended(SuspensionReason::StaleState),
                    now_ms,
                )?;
                return Ok(view);
            }
            Err(
                RuntimeError::ExpiredCommand { .. }
                | RuntimeError::Policy(PolicyError::Expired { .. }),
            ) => {
                let (view, _) = self.commit_continuation_update(
                    &run_id,
                    expected_status,
                    expected_reason,
                    ContinuationUpdate::Suspended(SuspensionReason::Expired),
                    now_ms,
                )?;
                return Ok(view);
            }
            Err(error @ RuntimeError::Device(_)) => {
                let unavailable = matches!(
                    &error,
                    RuntimeError::Device(device_error)
                        if device_error.kind() == DeviceErrorKind::Unavailable
                );
                if let Some(command_view) = self.station.inspect_command(&command)? {
                    device_error = Some(error);
                    command_view
                } else if unavailable {
                    let (view, _) = self.commit_continuation_update(
                        &run_id,
                        expected_status,
                        expected_reason,
                        ContinuationUpdate::Suspended(SuspensionReason::DeviceUnavailable),
                        now_ms,
                    )?;
                    return Ok(view);
                } else {
                    return Err(error.into());
                }
            }
            Err(error) => return Err(error.into()),
        };

        if command_is_actuator_fault(&command_view) {
            let command_events = self.station.events(&command.command_id)?;
            let desk_motion_progress = self.station.desk_motion_progress(&command.command_id)?;
            let (view, _) = self.commit_continuation_update(
                &run_id,
                expected_status,
                expected_reason,
                ContinuationUpdate::ActuatorFault {
                    command: command_view,
                    command_events,
                    desk_motion_progress,
                },
                now_ms,
            )?;
            return Ok(view);
        }

        let (status, event_type) = task_outcome(command_view.status, completed_event);
        let command_events = self.station.events(&command.command_id)?;
        let desk_motion_progress = self.station.desk_motion_progress(&command.command_id)?;
        let (view, update_applied) = self.commit_continuation_update(
            &run_id,
            expected_status,
            expected_reason,
            ContinuationUpdate::CommandResult {
                status,
                event_type,
                command: command_view,
                command_events,
                desk_motion_progress,
            },
            now_ms,
        )?;
        if update_applied && view.status == TaskRunStatus::Executing {
            let stored = self.load_run(&run_id)?;
            return self.execute_approved_steps(stored, now_ms, completed_event);
        }
        if update_applied && status == TaskRunStatus::Failed {
            if let Some(error) = device_error {
                return Err(error.into());
            }
        }
        Ok(view)
    }

    fn commit_continuation_update(
        &mut self,
        run_id: &str,
        expected_status: TaskRunStatus,
        expected_reason: Option<SuspensionReason>,
        update: ContinuationUpdate,
        now_ms: u64,
    ) -> Result<(TaskRunView, bool), TaskRuntimeError> {
        let policy_authority = self.policy_authority.clone();
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let stored_json = transaction.query_row(
            "SELECT stored_json FROM task_runs WHERE run_id = ?1",
            params![run_id],
            |row| row.get::<_, String>(0),
        )?;
        let mut stored = deserialize_stored_run(run_id, &stored_json)?;
        if stored.view.status != expected_status || stored.view.suspension_reason != expected_reason
        {
            transaction.commit()?;
            return Ok((stored.view, false));
        }
        match update {
            ContinuationUpdate::Suspended(reason) => {
                stored.view.status = TaskRunStatus::Suspended;
                stored.view.suspension_reason = Some(reason);
                append_event_once(&mut stored.view, TaskEventType::RunSuspended, now_ms);
            }
            ContinuationUpdate::ActuatorFault {
                command,
                command_events,
                desk_motion_progress,
            } => {
                stored.view.status = TaskRunStatus::Suspended;
                stored.view.suspension_reason = Some(SuspensionReason::ActuatorFault);
                stored.view.command = Some(command);
                stored.view.command_events = command_events;
                stored.view.desk_motion_progress = desk_motion_progress;
                record_current_command_attempt(&mut stored)?;
                append_event_once(&mut stored.view, TaskEventType::RunSuspended, now_ms);
            }
            ContinuationUpdate::CommandResult {
                status,
                event_type,
                command,
                command_events,
                desk_motion_progress,
            } => {
                stored.view.status = status;
                stored.view.suspension_reason = None;
                stored.view.command = Some(command);
                stored.view.command_events = command_events;
                stored.view.desk_motion_progress = desk_motion_progress;
                if status == TaskRunStatus::Completed {
                    record_completed_step(&mut stored)?;
                    if !prepare_next_step(&policy_authority, &mut stored, now_ms)? {
                        append_event_once(&mut stored.view, event_type, now_ms);
                    }
                } else {
                    append_event_once(&mut stored.view, event_type, now_ms);
                }
            }
        }
        let stored_json = serde_json::to_string(&stored)?;
        transaction.execute(
            "UPDATE task_runs
             SET stored_json = ?1, updated_at_ms = ?2
             WHERE run_id = ?3",
            params![stored_json, now_ms, run_id],
        )?;
        transaction.commit()?;
        Ok((stored.view, true))
    }

    fn load_run(&self, run_id: &str) -> Result<StoredRun, TaskRuntimeError> {
        self.try_load_run(run_id)?
            .ok_or_else(|| TaskRuntimeError::RunNotFound {
                run_id: run_id.into(),
            })
    }

    fn try_load_run(&self, run_id: &str) -> Result<Option<StoredRun>, TaskRuntimeError> {
        let stored_json = self
            .connection
            .query_row(
                "SELECT stored_json FROM task_runs WHERE run_id = ?1",
                params![run_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        let mut stored = stored_json
            .map(|stored_json| deserialize_stored_run(run_id, &stored_json))
            .transpose()?;
        if let Some(stored) = &mut stored {
            self.refresh_command_events(stored)?;
        }
        Ok(stored)
    }

    fn refresh_command_events(&self, stored: &mut StoredRun) -> Result<(), TaskRuntimeError> {
        if let Some(command) = &stored.command {
            stored.view.command_events = self.station.events(&command.command_id)?;
            stored.view.desk_motion_progress =
                self.station.desk_motion_progress(&command.command_id)?;
        }
        Ok(())
    }

    fn save_run(&self, run: &StoredRun, now_ms: u64) -> Result<(), TaskRuntimeError> {
        let stored_json = serde_json::to_string(run)?;
        self.connection.execute(
            "INSERT INTO task_runs (run_id, stored_json, created_at_ms, updated_at_ms)
             VALUES (?1, ?2, ?3, ?3)
             ON CONFLICT(run_id) DO UPDATE SET
                 stored_json = excluded.stored_json,
                 updated_at_ms = excluded.updated_at_ms",
            params![&run.view.run_id, stored_json, now_ms],
        )?;
        Ok(())
    }
}

fn deserialize_stored_run(run_id: &str, stored_json: &str) -> Result<StoredRun, TaskRuntimeError> {
    let mut value: serde_json::Value = serde_json::from_str(stored_json)?;
    let task_is_missing = value
        .get("view")
        .and_then(|view| view.get("task"))
        .is_none();
    if task_is_missing {
        let legacy_spec =
            value
                .get("spec")
                .cloned()
                .ok_or_else(|| TaskRuntimeError::CorruptRun {
                    run_id: run_id.into(),
                })?;
        let view = value
            .get_mut("view")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or_else(|| TaskRuntimeError::CorruptRun {
                run_id: run_id.into(),
            })?;
        view.insert("task".into(), legacy_spec);
    }
    Ok(serde_json::from_value(value)?)
}

fn command_for(
    stored: &StoredRun,
    run_id: &str,
    expires_at_ms: u64,
) -> Result<DeviceCommand, TaskRuntimeError> {
    let step = stored
        .view
        .task
        .steps
        .get(stored.current_step_index)
        .ok_or(TaskRuntimeError::InvalidTaskSpec {
            reason: "current planned step does not exist",
        })?;
    let action = step.action.clone();
    let expected_state_version =
        stored
            .expected_state_version
            .ok_or_else(|| TaskRuntimeError::CorruptRun {
                run_id: run_id.into(),
            })?;
    Ok(DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: format!("cmd-{run_id}-{}", step.step_id),
        task_run_id: run_id.into(),
        action,
        expected_state_version,
        idempotency_key: format!("{run_id}:{}", step.step_id),
        expires_at_ms,
        trace_id: format!("trace-{run_id}"),
        policy_grant_id: format!("grant-{run_id}-{}", step.step_id),
    })
}

fn issue_grant(
    authority: &PolicyAuthority,
    command: &DeviceCommand,
    now_ms: u64,
) -> Result<PolicyGrant, TaskRuntimeError> {
    let decision = authority.evaluate(&command.action);
    Ok(authority.issue(GrantRequest {
        grant_id: command.policy_grant_id.clone(),
        task_run_id: command.task_run_id.clone(),
        command_id: command.command_id.clone(),
        action: command.action.clone(),
        expected_state_version: command.expected_state_version,
        issued_at_ms: now_ms,
        expires_at_ms: command.expires_at_ms,
        rule_ids: decision.rule_ids,
    })?)
}

fn record_completed_step(stored: &mut StoredRun) -> Result<(), TaskRuntimeError> {
    let step = stored
        .view
        .task
        .steps
        .get(stored.current_step_index)
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;
    if stored
        .view
        .completed_steps
        .iter()
        .any(|completed| completed.step_id == step.step_id)
    {
        return Ok(());
    }
    let command = stored
        .view
        .command
        .clone()
        .filter(|command| command.status == CommandStatus::Succeeded)
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;
    stored.view.completed_steps.push(CompletedTaskStep {
        step_id: step.step_id.clone(),
        command,
        command_events: stored.view.command_events.clone(),
        desk_motion_progress: stored.view.desk_motion_progress.clone(),
    });
    Ok(())
}

fn record_current_command_attempt(stored: &mut StoredRun) -> Result<(), TaskRuntimeError> {
    let command = stored
        .view
        .command
        .clone()
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;
    if stored
        .view
        .command_attempts
        .iter()
        .any(|attempt| attempt.command.command_id == command.command_id)
    {
        return Ok(());
    }
    let step_id = stored
        .view
        .task
        .steps
        .get(stored.current_step_index)
        .map(|step| step.step_id.clone())
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;
    stored.view.command_attempts.push(CompletedTaskStep {
        step_id,
        command,
        command_events: stored.view.command_events.clone(),
        desk_motion_progress: stored.view.desk_motion_progress.clone(),
    });
    Ok(())
}

fn command_is_actuator_fault(command: &CommandView) -> bool {
    command.status == CommandStatus::Failed
        && command.failure_reason == Some(CommandFailureReason::ActuatorFault)
}

fn prepare_next_step(
    authority: &PolicyAuthority,
    stored: &mut StoredRun,
    now_ms: u64,
) -> Result<bool, TaskRuntimeError> {
    let next_step_index = stored.current_step_index + 1;
    if next_step_index >= stored.view.task.steps.len() {
        return Ok(false);
    }
    let state_version = stored
        .view
        .command
        .as_ref()
        .and_then(|command| command.outcome.as_ref())
        .map(|outcome| outcome.state_version)
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;
    let expires_at_ms = stored
        .view
        .approval
        .as_ref()
        .map(|approval| approval.expires_at_ms)
        .ok_or_else(|| TaskRuntimeError::CorruptRun {
            run_id: stored.view.run_id.clone(),
        })?;

    stored.current_step_index = next_step_index;
    stored.expected_state_version = Some(state_version);
    let command = command_for(stored, &stored.view.run_id, expires_at_ms)?;
    let grant = issue_grant(authority, &command, now_ms)?;
    stored.command = Some(command);
    stored.grant = Some(grant);
    stored.view.status = TaskRunStatus::Executing;
    stored.view.suspension_reason = None;
    stored.view.command = None;
    stored.view.command_events.clear();
    stored.view.desk_motion_progress.clear();
    append_event(&mut stored.view, TaskEventType::CommandDispatched, now_ms);
    Ok(true)
}

fn validate_task_spec(spec: &TaskSpec) -> Result<(), TaskRuntimeError> {
    if spec.schema_version != SCHEMA_VERSION {
        return Err(TaskRuntimeError::UnsupportedTaskSchemaVersion {
            expected: SCHEMA_VERSION,
            actual: spec.schema_version,
        });
    }
    if spec.task_id.trim().is_empty() {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "taskId must not be empty",
        });
    }
    if spec.requested_by.trim().is_empty() {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "requestedBy must not be empty",
        });
    }
    if spec.steps.is_empty() || spec.steps.len() > 2 {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "the current runtime accepts one or two planned steps",
        });
    }
    if spec.goal == TaskGoal::RestoreProfile && spec.steps.len() != 2 {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "restore_profile requires exactly two planned steps",
        });
    }
    if spec.steps.iter().any(|step| step.step_id.trim().is_empty()) {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "stepId must not be empty",
        });
    }
    if spec.steps.len() == 2
        && (spec.goal != TaskGoal::RestoreProfile
            || !matches!(spec.steps[0].action, DeviceAction::DeskMoveToHeight { .. })
            || !matches!(
                spec.steps[1].action,
                DeviceAction::ChairSetLumbarSupport { .. }
            ))
    {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "restore_profile requires desk then lumbar steps",
        });
    }
    if spec.steps.len() == 2 && spec.steps[0].step_id == spec.steps[1].step_id {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "stepId values must be unique",
        });
    }
    Ok(())
}

fn evaluate_task_policy(authority: &PolicyAuthority, spec: &TaskSpec) -> PolicyDecision {
    let decisions: Vec<_> = spec
        .steps
        .iter()
        .map(|step| authority.evaluate(&step.action))
        .collect();
    if let Some(denied) = decisions
        .iter()
        .find(|decision| decision.outcome == PolicyOutcome::Deny)
    {
        return denied.clone();
    }
    let rule_ids = decisions
        .iter()
        .flat_map(|decision| decision.rule_ids.iter().cloned())
        .collect();
    if decisions
        .iter()
        .any(|decision| decision.outcome == PolicyOutcome::RequireApproval)
    {
        PolicyDecision {
            outcome: PolicyOutcome::RequireApproval,
            rule_ids,
            reason_code: None,
        }
    } else {
        PolicyDecision {
            outcome: PolicyOutcome::Allow,
            rule_ids,
            reason_code: None,
        }
    }
}

fn task_outcome(
    command_status: CommandStatus,
    completed_event: TaskEventType,
) -> (TaskRunStatus, TaskEventType) {
    match command_status {
        CommandStatus::Succeeded => (TaskRunStatus::Completed, completed_event),
        CommandStatus::Failed => (TaskRunStatus::Failed, TaskEventType::RunFailed),
        CommandStatus::Accepted | CommandStatus::Executing | CommandStatus::OutcomeUnknown => {
            (TaskRunStatus::OutcomeUnknown, TaskEventType::OutcomeUnknown)
        }
    }
}

fn append_event(view: &mut TaskRunView, event_type: TaskEventType, at_ms: u64) {
    let sequence = view
        .events
        .last()
        .map(|event| event.sequence + 1)
        .unwrap_or(1);
    view.events.push(TaskEvent {
        sequence,
        event_type,
        at_ms,
    });
}

fn append_event_once(view: &mut TaskRunView, event_type: TaskEventType, at_ms: u64) {
    if view
        .events
        .last()
        .map(|event| event.event_type != event_type)
        .unwrap_or(true)
    {
        append_event(view, event_type, at_ms);
    }
}
