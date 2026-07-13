use ergopilot_protocol::{
    CommandEvent, CommandEventType, CommandFailureReason, CommandStatus, CommandView,
    DeskMotionProgress, DeviceAction, DeviceCommand, PolicyGrant, VerifiedOutcome,
    WorkstationSnapshot, SCHEMA_VERSION,
};
use policy_core::{PolicyError, PolicyVerifier};
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, time::Duration};
use thiserror::Error;

pub use ergopilot_protocol::{
    MAX_DESK_HEIGHT_MM, MAX_LUMBAR_SUPPORT_PERCENT, MIN_DESK_HEIGHT_MM, MIN_LUMBAR_SUPPORT_PERCENT,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceExecution {
    Reported,
    OutcomeUnknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceErrorKind {
    Other,
    Unavailable,
    ActuatorFault,
}

#[derive(Debug, Error)]
#[error("device adapter error: {message}")]
pub struct DeviceError {
    pub message: String,
    kind: DeviceErrorKind,
}

impl DeviceError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: DeviceErrorKind::Other,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: DeviceErrorKind::Unavailable,
        }
    }

    pub fn actuator_fault(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            kind: DeviceErrorKind::ActuatorFault,
        }
    }

    pub fn kind(&self) -> DeviceErrorKind {
        self.kind
    }
}

pub trait DeviceAdapter {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError>;

    /// Applies an action only if the device is still at `expected_state_version`.
    /// The adapter owns this final compare-and-set check at the effect boundary.
    /// An error must mean no physical effect occurred, except for a structured
    /// actuator fault that reports a known partial effect. If the adapter cannot
    /// determine the physical outcome, it returns `DeviceExecution::OutcomeUnknown`.
    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError>;

    fn apply_command(
        &mut self,
        command: &DeviceCommand,
        started_at_ms: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        let _ = started_at_ms;
        self.apply(&command.action, command.expected_state_version)
    }

    fn desk_motion_progress(
        &self,
        command_id: &str,
    ) -> Result<Vec<DeskMotionProgress>, DeviceError> {
        let _ = command_id;
        Ok(Vec::new())
    }

    fn prepare_reconciliation(&mut self, command_id: &str) -> Result<(), DeviceError> {
        let _ = command_id;
        Ok(())
    }
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
    #[error(transparent)]
    Device(#[from] DeviceError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    Policy(#[from] PolicyError),
    #[error("command journal contains an unknown status: {0}")]
    CorruptJournal(String),
    #[error("command journal contains an unknown failure reason: {0}")]
    CorruptFailureReason(String),
    #[error("command journal contains an unknown event type: {0}")]
    CorruptEventType(String),
    #[error("command {command_id} is not pending reconciliation")]
    CommandNotPending { command_id: String },
    #[error(
        "command expected workstation state version {expected}, but current version is {actual}"
    )]
    StaleState { expected: u64, actual: u64 },
    #[error("idempotency key {key} was already used for a different command")]
    IdempotencyConflict { key: String },
    #[error("desk height {requested} mm is outside the safe envelope {min}..={max} mm")]
    UnsafeDeskHeight { requested: u16, min: u16, max: u16 },
    #[error("lumbar support {requested}% is outside the safe envelope {min}..={max}%")]
    UnsafeLumbarSupport { requested: u8, min: u8, max: u8 },
    #[error("{capability_id} contains values outside the safe device envelope")]
    UnsafeActionConfiguration { capability_id: &'static str },
    #[error("command expired at {expires_at_ms}, current time is {now_ms}")]
    ExpiredCommand { expires_at_ms: u64, now_ms: u64 },
    #[error("action command is missing a policy grant")]
    MissingPolicyGrant,
    #[error(
        "unsupported command schema version {actual}; this runtime accepts version {expected}"
    )]
    UnsupportedSchemaVersion { expected: u16, actual: u16 },
}

pub struct StationRuntime<D> {
    #[allow(dead_code)]
    connection: Connection,
    device: D,
    policy_verifier: PolicyVerifier,
}

impl<D: DeviceAdapter> StationRuntime<D> {
    pub fn in_memory(device: D, policy_verifier: PolicyVerifier) -> Result<Self, RuntimeError> {
        Self::from_connection(Connection::open_in_memory()?, device, policy_verifier)
    }

    pub fn open(
        path: impl AsRef<Path>,
        device: D,
        policy_verifier: PolicyVerifier,
    ) -> Result<Self, RuntimeError> {
        Self::from_connection(Connection::open(path)?, device, policy_verifier)
    }

    fn from_connection(
        connection: Connection,
        device: D,
        policy_verifier: PolicyVerifier,
    ) -> Result<Self, RuntimeError> {
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS commands (
                command_id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                command_json TEXT NOT NULL,
                status TEXT NOT NULL,
                outcome_json TEXT,
                failure_reason TEXT,
                created_at_ms INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS command_events (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                command_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                at_ms INTEGER NOT NULL
            );
            ",
        )?;
        let has_failure_reason = {
            let mut statement = connection.prepare("PRAGMA table_info(commands)")?;
            let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
            columns
                .collect::<Result<Vec<_>, _>>()?
                .iter()
                .any(|column| column == "failure_reason")
        };
        if !has_failure_reason {
            connection.execute("ALTER TABLE commands ADD COLUMN failure_reason TEXT", [])?;
        }

        Ok(Self {
            connection,
            device,
            policy_verifier,
        })
    }

    pub fn execute(
        &mut self,
        command: DeviceCommand,
        grant: &PolicyGrant,
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        if command.schema_version != SCHEMA_VERSION {
            return Err(RuntimeError::UnsupportedSchemaVersion {
                expected: SCHEMA_VERSION,
                actual: command.schema_version,
            });
        }

        let command_json = serde_json::to_string(&command)?;
        if let Some(existing) = self.existing_command_view(&command, &command_json)? {
            return Ok(existing);
        }

        if command.policy_grant_id.trim().is_empty() {
            return Err(RuntimeError::MissingPolicyGrant);
        }
        self.policy_verifier.verify(grant, &command, now_ms)?;
        self.execute_new(command, command_json, now_ms)
    }

    /// Returns the journaled view only when the supplied command is byte-for-byte
    /// equivalent to the persisted command behind its idempotency key.
    pub fn inspect_command(
        &self,
        command: &DeviceCommand,
    ) -> Result<Option<CommandView>, RuntimeError> {
        if command.schema_version != SCHEMA_VERSION {
            return Err(RuntimeError::UnsupportedSchemaVersion {
                expected: SCHEMA_VERSION,
                actual: command.schema_version,
            });
        }
        let command_json = serde_json::to_string(command)?;
        self.existing_command_view(command, &command_json)
    }

    /// Resumes an exact, durably planned command after an orchestrator restart.
    ///
    /// Existing terminal results are returned without re-authorizing or repeating
    /// an effect. Existing uncertain commands are reconciled from observed state.
    /// Only a command absent from the station journal enters the normal, fully
    /// authorized execution path.
    pub fn resume_command(
        &mut self,
        command: DeviceCommand,
        grant: &PolicyGrant,
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        let command_view = self.execute(command, grant, now_ms)?;
        if command_view.status.is_terminal() {
            return Ok(command_view);
        }
        self.reconcile_command(&command_view.command_id, now_ms)
    }

    fn existing_command_view(
        &self,
        command: &DeviceCommand,
        command_json: &str,
    ) -> Result<Option<CommandView>, RuntimeError> {
        let existing = self
            .connection
            .query_row(
                "SELECT command_id, command_json, status, outcome_json, failure_reason
                 FROM commands WHERE idempotency_key = ?1",
                params![&command.idempotency_key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;

        if let Some((command_id, stored_command_json, status, outcome_json, failure_reason)) =
            existing
        {
            if stored_command_json == command_json {
                return Ok(Some(CommandView {
                    command_id,
                    idempotency_key: command.idempotency_key.clone(),
                    status: command_status_from_db(&status)?,
                    outcome: outcome_json
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()?,
                    failure_reason: failure_reason
                        .as_deref()
                        .map(command_failure_reason_from_db)
                        .transpose()?,
                    was_replayed: true,
                }));
            }

            return Err(RuntimeError::IdempotencyConflict {
                key: command.idempotency_key.clone(),
            });
        }

        Ok(None)
    }

    fn execute_new(
        &mut self,
        command: DeviceCommand,
        command_json: String,
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        if command.expires_at_ms <= now_ms {
            return Err(RuntimeError::ExpiredCommand {
                expires_at_ms: command.expires_at_ms,
                now_ms,
            });
        }

        match &command.action {
            DeviceAction::DeskMoveToHeight { height_mm }
                if !(MIN_DESK_HEIGHT_MM..=MAX_DESK_HEIGHT_MM).contains(height_mm) =>
            {
                return Err(RuntimeError::UnsafeDeskHeight {
                    requested: *height_mm,
                    min: MIN_DESK_HEIGHT_MM,
                    max: MAX_DESK_HEIGHT_MM,
                });
            }
            DeviceAction::ChairSetLumbarSupport { level_percent }
                if !(MIN_LUMBAR_SUPPORT_PERCENT..=MAX_LUMBAR_SUPPORT_PERCENT)
                    .contains(level_percent) =>
            {
                return Err(RuntimeError::UnsafeLumbarSupport {
                    requested: *level_percent,
                    min: MIN_LUMBAR_SUPPORT_PERCENT,
                    max: MAX_LUMBAR_SUPPORT_PERCENT,
                });
            }
            DeviceAction::ChairAdjustErgonomics(configuration)
                if !configuration.is_within_safe_envelope() =>
            {
                return Err(RuntimeError::UnsafeActionConfiguration {
                    capability_id: command.action.capability_id(),
                });
            }
            DeviceAction::LightConfigure(configuration)
                if !configuration.is_within_safe_envelope() =>
            {
                return Err(RuntimeError::UnsafeActionConfiguration {
                    capability_id: command.action.capability_id(),
                });
            }
            DeviceAction::ReminderConfigure(configuration)
                if !configuration.is_within_safe_envelope() =>
            {
                return Err(RuntimeError::UnsafeActionConfiguration {
                    capability_id: command.action.capability_id(),
                });
            }
            _ => {}
        }

        let initial_snapshot = self.device.snapshot(now_ms)?;
        if command.expected_state_version != initial_snapshot.state_version {
            return Err(RuntimeError::StaleState {
                expected: command.expected_state_version,
                actual: initial_snapshot.state_version,
            });
        }

        self.persist_started(&command, &command_json, now_ms)?;

        let execution = match self.device.apply_command(&command, now_ms) {
            Ok(execution) => execution,
            Err(error) => {
                let failure_reason = (error.kind() == DeviceErrorKind::ActuatorFault)
                    .then_some(CommandFailureReason::ActuatorFault);
                self.transition_with_event(
                    &command.command_id,
                    "failed",
                    None,
                    failure_reason,
                    CommandEventType::ExecutionFailed,
                    now_ms,
                )?;
                return Err(RuntimeError::Device(error));
            }
        };
        if execution == DeviceExecution::OutcomeUnknown {
            self.transition_with_event(
                &command.command_id,
                "outcome_unknown",
                None,
                None,
                CommandEventType::OutcomeUnknown,
                now_ms,
            )?;
            return Ok(CommandView {
                command_id: command.command_id,
                idempotency_key: command.idempotency_key,
                status: CommandStatus::OutcomeUnknown,
                outcome: None,
                failure_reason: None,
                was_replayed: false,
            });
        }

        let observed = match self.device.snapshot(now_ms) {
            Ok(observed) => observed,
            Err(error) => {
                self.transition_with_event(
                    &command.command_id,
                    "outcome_unknown",
                    None,
                    None,
                    CommandEventType::OutcomeUnknown,
                    now_ms,
                )?;
                return Err(RuntimeError::Device(error));
            }
        };
        let verified = command.action.is_satisfied_by(&observed);
        let status = if verified {
            CommandStatus::Succeeded
        } else {
            CommandStatus::Failed
        };
        let outcome = verified.then_some(VerifiedOutcome::from_snapshot(&observed, now_ms));
        let outcome_json = outcome.as_ref().map(serde_json::to_string).transpose()?;
        let status_text = if verified { "succeeded" } else { "failed" };

        self.transition_with_event(
            &command.command_id,
            status_text,
            outcome_json.as_deref(),
            None,
            if verified {
                CommandEventType::VerifiedSucceeded
            } else {
                CommandEventType::VerificationFailed
            },
            now_ms,
        )?;

        Ok(CommandView {
            command_id: command.command_id,
            idempotency_key: command.idempotency_key,
            status,
            outcome,
            failure_reason: None,
            was_replayed: false,
        })
    }

    pub fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, RuntimeError> {
        Ok(self.device.snapshot(observed_at_ms)?)
    }

    pub fn events(&self, command_id: &str) -> Result<Vec<CommandEvent>, RuntimeError> {
        let mut statement = self.connection.prepare(
            "SELECT sequence, command_id, event_type, at_ms
             FROM command_events
             WHERE command_id = ?1
             ORDER BY sequence ASC",
        )?;
        let rows = statement.query_map(params![command_id], |row| {
            Ok((
                row.get::<_, u64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(|(sequence, command_id, event_type, at_ms)| {
                Ok(CommandEvent {
                    sequence,
                    command_id,
                    event_type: command_event_type_from_db(&event_type)?,
                    at_ms,
                })
            })
            .collect()
    }

    pub fn desk_motion_progress(
        &self,
        command_id: &str,
    ) -> Result<Vec<DeskMotionProgress>, RuntimeError> {
        Ok(self.device.desk_motion_progress(command_id)?)
    }

    /// Clears adapter-owned transient state for a terminal command. This does
    /// not authorize or dispatch a replacement action.
    pub fn prepare_command_recovery(&mut self, command_id: &str) -> Result<(), RuntimeError> {
        self.device.prepare_reconciliation(command_id)?;
        Ok(())
    }

    pub fn reconcile_pending(&mut self, now_ms: u64) -> Result<Vec<CommandView>, RuntimeError> {
        let pending = {
            let mut statement = self.connection.prepare(
                "SELECT command_id, idempotency_key, command_json, status
                 FROM commands
                 WHERE status IN ('accepted', 'executing', 'outcome_unknown')
                 ORDER BY created_at_ms ASC",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let mut reconciled = Vec::with_capacity(pending.len());
        for record in pending {
            reconciled.push(self.reconcile_record(record, now_ms)?);
        }

        Ok(reconciled)
    }

    pub fn reconcile_command(
        &mut self,
        command_id: &str,
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        let record = self
            .connection
            .query_row(
                "SELECT command_id, idempotency_key, command_json, status
                 FROM commands
                 WHERE command_id = ?1
                   AND status IN ('accepted', 'executing', 'outcome_unknown')",
                params![command_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| RuntimeError::CommandNotPending {
                command_id: command_id.into(),
            })?;
        self.reconcile_record(record, now_ms)
    }

    fn reconcile_record(
        &mut self,
        (command_id, idempotency_key, command_json, status_text): (String, String, String, String),
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        let command: DeviceCommand = serde_json::from_str(&command_json)?;
        self.device.prepare_reconciliation(&command_id)?;
        let observed = self.device.snapshot(now_ms)?;

        if command.action.is_satisfied_by(&observed) {
            let outcome = VerifiedOutcome::from_snapshot(&observed, now_ms);
            let outcome_json = serde_json::to_string(&outcome)?;
            self.transition_with_event(
                &command_id,
                "succeeded",
                Some(&outcome_json),
                None,
                CommandEventType::ReconciledSucceeded,
                now_ms,
            )?;
            Ok(CommandView {
                command_id,
                idempotency_key,
                status: CommandStatus::Succeeded,
                outcome: Some(outcome),
                failure_reason: None,
                was_replayed: false,
            })
        } else {
            let previous_status = command_status_from_db(&status_text)?;
            let status = if matches!(
                previous_status,
                CommandStatus::Accepted | CommandStatus::Executing
            ) {
                self.transition_with_event(
                    &command_id,
                    "outcome_unknown",
                    None,
                    None,
                    CommandEventType::ReconciliationPending,
                    now_ms,
                )?;
                CommandStatus::OutcomeUnknown
            } else {
                previous_status
            };
            Ok(CommandView {
                command_id,
                idempotency_key,
                status,
                outcome: None,
                failure_reason: None,
                was_replayed: false,
            })
        }
    }

    fn persist_started(
        &mut self,
        command: &DeviceCommand,
        command_json: &str,
        now_ms: u64,
    ) -> Result<(), RuntimeError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "INSERT INTO commands (
                command_id, idempotency_key, command_json, status,
                created_at_ms, updated_at_ms
            ) VALUES (?1, ?2, ?3, 'accepted', ?4, ?4)",
            params![
                &command.command_id,
                &command.idempotency_key,
                command_json,
                now_ms
            ],
        )?;
        append_event(
            &transaction,
            &command.command_id,
            CommandEventType::Accepted,
            now_ms,
        )?;
        transaction.execute(
            "UPDATE commands SET status = 'executing', updated_at_ms = ?2
             WHERE command_id = ?1",
            params![&command.command_id, now_ms],
        )?;
        append_event(
            &transaction,
            &command.command_id,
            CommandEventType::Executing,
            now_ms,
        )?;
        transaction.commit()?;
        Ok(())
    }

    fn transition_with_event(
        &mut self,
        command_id: &str,
        status: &str,
        outcome_json: Option<&str>,
        failure_reason: Option<CommandFailureReason>,
        event_type: CommandEventType,
        at_ms: u64,
    ) -> Result<(), RuntimeError> {
        let transaction = self.connection.transaction()?;
        transaction.execute(
            "UPDATE commands
             SET status = ?2, outcome_json = ?3, failure_reason = ?4, updated_at_ms = ?5
             WHERE command_id = ?1",
            params![
                command_id,
                status,
                outcome_json,
                failure_reason.map(command_failure_reason_as_db),
                at_ms
            ],
        )?;
        append_event(&transaction, command_id, event_type, at_ms)?;
        transaction.commit()?;
        Ok(())
    }
}

fn append_event(
    connection: &Connection,
    command_id: &str,
    event_type: CommandEventType,
    at_ms: u64,
) -> Result<(), rusqlite::Error> {
    connection.execute(
        "INSERT INTO command_events (command_id, event_type, at_ms)
             VALUES (?1, ?2, ?3)",
        params![command_id, event_type.as_str(), at_ms],
    )?;
    Ok(())
}

fn command_status_from_db(status: &str) -> Result<CommandStatus, RuntimeError> {
    match status {
        "accepted" => Ok(CommandStatus::Accepted),
        "executing" => Ok(CommandStatus::Executing),
        "outcome_unknown" => Ok(CommandStatus::OutcomeUnknown),
        "succeeded" => Ok(CommandStatus::Succeeded),
        "failed" => Ok(CommandStatus::Failed),
        other => Err(RuntimeError::CorruptJournal(other.to_owned())),
    }
}

fn command_failure_reason_as_db(reason: CommandFailureReason) -> &'static str {
    match reason {
        CommandFailureReason::ActuatorFault => "actuator_fault",
    }
}

fn command_failure_reason_from_db(reason: &str) -> Result<CommandFailureReason, RuntimeError> {
    match reason {
        "actuator_fault" => Ok(CommandFailureReason::ActuatorFault),
        other => Err(RuntimeError::CorruptFailureReason(other.to_owned())),
    }
}

fn command_event_type_from_db(event_type: &str) -> Result<CommandEventType, RuntimeError> {
    match event_type {
        "accepted" => Ok(CommandEventType::Accepted),
        "executing" => Ok(CommandEventType::Executing),
        "outcome_unknown" => Ok(CommandEventType::OutcomeUnknown),
        "verified_succeeded" => Ok(CommandEventType::VerifiedSucceeded),
        "verification_failed" => Ok(CommandEventType::VerificationFailed),
        "execution_failed" => Ok(CommandEventType::ExecutionFailed),
        "reconciliation_pending" => Ok(CommandEventType::ReconciliationPending),
        "reconciled_succeeded" => Ok(CommandEventType::ReconciledSucceeded),
        other => Err(RuntimeError::CorruptEventType(other.to_owned())),
    }
}
