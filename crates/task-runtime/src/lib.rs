use ergopilot_protocol::{
    CommandEvent, CommandStatus, CommandView, DeviceAction, DeviceCommand, PolicyDecision,
    PolicyGrant, PolicyOutcome, WorkstationSnapshot, SCHEMA_VERSION,
};
use policy_core::{GrantRequest, PolicyAuthority, PolicyError};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use station_core::{DeviceAdapter, DeviceErrorKind, RuntimeError, StationRuntime};
use std::path::Path;
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskGoal {
    PrepareFocusSession,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuspensionReason {
    DeviceUnavailable,
    StaleState,
    Expired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Expired,
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
    RunResumed,
    RunSuspended,
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
            Self::RunResumed => "run_resumed",
            Self::RunSuspended => "run_suspended",
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
    #[error("task run {run_id} is not awaiting approval")]
    RunNotApprovable { run_id: String },
    #[error("task run {run_id} has no matching pending device command")]
    PendingCommandNotFound { run_id: String },
    #[error("task run {run_id} is suspended and cannot be reconciled")]
    RunNotReconcilable { run_id: String },
    #[error("task run {run_id} is not resumable")]
    RunNotResumable { run_id: String },
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
    view: TaskRunView,
    command: Option<DeviceCommand>,
    grant: Option<PolicyGrant>,
}

impl<D: DeviceAdapter> TaskRuntime<D> {
    pub fn open(
        path: impl AsRef<Path>,
        device: D,
        policy_authority: PolicyAuthority,
    ) -> Result<Self, TaskRuntimeError> {
        let path = path.as_ref();
        let connection = Connection::open(path)?;
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
        let action = spec.steps[0].action.clone();
        let policy_decision = self.policy_authority.evaluate(&action);
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
                view: view.clone(),
                command: None,
                grant: None,
            },
            now_ms,
        )?;
        Ok(view)
    }

    pub fn inspect(&self, run_id: &str) -> Result<TaskRunView, TaskRuntimeError> {
        Ok(self.load_run(run_id)?.view)
    }

    pub fn approve(
        &mut self,
        run_id: &str,
        approved_by: &str,
        now_ms: u64,
    ) -> Result<TaskRunView, TaskRuntimeError> {
        let mut stored = self.load_run(run_id)?;
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
            return Ok(stored.view);
        }
        if stored.view.status == TaskRunStatus::Denied {
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
        if expires_at_ms <= now_ms && stored.command.is_none() {
            if let Some(approval) = &mut stored.view.approval {
                approval.status = ApprovalStatus::Expired;
            }
            append_event(&mut stored.view, TaskEventType::ApprovalExpired, now_ms);
            self.save_run(&stored, now_ms)?;
            return Err(TaskRuntimeError::ApprovalExpired {
                expires_at_ms,
                now_ms,
            });
        }

        if stored.command.is_none() && stored.grant.is_none() {
            let command = command_for(&stored, run_id, expires_at_ms)?;
            let grant = self.policy_authority.issue(GrantRequest {
                grant_id: command.policy_grant_id.clone(),
                task_run_id: command.task_run_id.clone(),
                command_id: command.command_id.clone(),
                action: command.action.clone(),
                expected_state_version: command.expected_state_version,
                issued_at_ms: now_ms,
                expires_at_ms: command.expires_at_ms,
                rule_ids: stored.view.policy_decision.rule_ids.clone(),
            })?;
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
            self.save_run(&stored, now_ms)?;
        }

        let (command, grant) = match (&stored.command, &stored.grant) {
            (Some(command), Some(grant)) => (command.clone(), grant.clone()),
            _ => {
                return Err(TaskRuntimeError::CorruptRun {
                    run_id: run_id.into(),
                })
            }
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
                let unavailable = matches!(
                    &error,
                    RuntimeError::Device(device_error)
                        if device_error.kind() == DeviceErrorKind::Unavailable
                );
                if let Some(command_view) = self.station.inspect_command(&command)? {
                    device_error = Some(error);
                    command_view
                } else if unavailable {
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
        let (status, event_type) = match command_view.status {
            CommandStatus::Succeeded => (TaskRunStatus::Completed, TaskEventType::RunCompleted),
            CommandStatus::Accepted | CommandStatus::Executing | CommandStatus::OutcomeUnknown => {
                (TaskRunStatus::OutcomeUnknown, TaskEventType::OutcomeUnknown)
            }
            CommandStatus::Failed => (TaskRunStatus::Failed, TaskEventType::RunFailed),
        };
        stored.view.status = status;
        stored.view.suspension_reason = None;
        stored.view.command = Some(command_view);
        self.refresh_command_events(&mut stored)?;
        append_event(&mut stored.view, event_type, now_ms);
        self.save_run(&stored, now_ms)?;
        if status == TaskRunStatus::Failed {
            if let Some(error) = device_error {
                return Err(error.into());
            }
        }
        Ok(stored.view)
    }

    pub fn station_snapshot(
        &mut self,
        observed_at_ms: u64,
    ) -> Result<WorkstationSnapshot, TaskRuntimeError> {
        Ok(self.station.snapshot(observed_at_ms)?)
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
        let stored = self.load_run(run_id)?;
        if matches!(
            stored.view.status,
            TaskRunStatus::Completed | TaskRunStatus::Failed | TaskRunStatus::Denied
        ) {
            return Ok(stored.view);
        }
        if stored.view.status != TaskRunStatus::Suspended
            || stored.view.suspension_reason != Some(SuspensionReason::DeviceUnavailable)
        {
            return Err(TaskRuntimeError::RunNotResumable {
                run_id: run_id.into(),
            });
        }
        self.continue_run(stored, now_ms, TaskEventType::RunResumed)
    }

    fn continue_run(
        &mut self,
        mut stored: StoredRun,
        now_ms: u64,
        completed_event: TaskEventType,
    ) -> Result<TaskRunView, TaskRuntimeError> {
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
                stored.view.status = TaskRunStatus::Suspended;
                stored.view.suspension_reason = Some(SuspensionReason::StaleState);
                append_event_once(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                self.save_run(&stored, now_ms)?;
                return Ok(stored.view);
            }
            Err(
                RuntimeError::ExpiredCommand { .. }
                | RuntimeError::Policy(PolicyError::Expired { .. }),
            ) => {
                stored.view.status = TaskRunStatus::Suspended;
                stored.view.suspension_reason = Some(SuspensionReason::Expired);
                append_event_once(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                self.save_run(&stored, now_ms)?;
                return Ok(stored.view);
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
                    stored.view.status = TaskRunStatus::Suspended;
                    stored.view.suspension_reason = Some(SuspensionReason::DeviceUnavailable);
                    append_event_once(&mut stored.view, TaskEventType::RunSuspended, now_ms);
                    self.save_run(&stored, now_ms)?;
                    return Ok(stored.view);
                } else {
                    return Err(error.into());
                }
            }
            Err(error) => return Err(error.into()),
        };

        let (status, event_type) = match command_view.status {
            CommandStatus::Succeeded => (TaskRunStatus::Completed, completed_event),
            CommandStatus::Failed => (TaskRunStatus::Failed, TaskEventType::RunFailed),
            CommandStatus::Accepted | CommandStatus::Executing | CommandStatus::OutcomeUnknown => {
                (TaskRunStatus::OutcomeUnknown, TaskEventType::OutcomeUnknown)
            }
        };
        stored.view.status = status;
        stored.view.suspension_reason = None;
        stored.view.command = Some(command_view);
        self.refresh_command_events(&mut stored)?;
        append_event_once(&mut stored.view, event_type, now_ms);
        self.save_run(&stored, now_ms)?;
        if status == TaskRunStatus::Failed {
            if let Some(error) = device_error {
                return Err(error.into());
            }
        }
        Ok(stored.view)
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
        .first()
        .ok_or(TaskRuntimeError::InvalidTaskSpec {
            reason: "at least one planned step is required",
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
    if spec.steps.len() != 1 {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "the current runtime requires exactly one planned step",
        });
    }
    if spec.steps[0].step_id.trim().is_empty() {
        return Err(TaskRuntimeError::InvalidTaskSpec {
            reason: "stepId must not be empty",
        });
    }
    Ok(())
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
