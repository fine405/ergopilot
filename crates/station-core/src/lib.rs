use ergopilot_protocol::{
    CommandEvent, CommandStatus, CommandView, DeviceAction, DeviceCommand, VerifiedOutcome,
    WorkstationSnapshot, SCHEMA_VERSION,
};
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use thiserror::Error;

pub const MIN_DESK_HEIGHT_MM: u16 = 620;
pub const MAX_DESK_HEIGHT_MM: u16 = 1_280;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DeviceExecution {
    Reported,
    OutcomeUnknown,
}

#[derive(Debug, Error)]
#[error("device adapter error: {message}")]
pub struct DeviceError {
    pub message: String,
}

impl DeviceError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

pub trait DeviceAdapter {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError>;

    fn apply(&mut self, action: &DeviceAction) -> Result<DeviceExecution, DeviceError>;
}

#[derive(Debug, Error)]
pub enum RuntimeError {
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
    #[error(transparent)]
    Device(#[from] DeviceError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error("command journal contains an unknown status: {0}")]
    CorruptJournal(String),
    #[error(
        "command expected workstation state version {expected}, but current version is {actual}"
    )]
    StaleState { expected: u64, actual: u64 },
    #[error("idempotency key {key} was already used for a different command")]
    IdempotencyConflict { key: String },
    #[error("desk height {requested} mm is outside the safe envelope {min}..={max} mm")]
    UnsafeDeskHeight { requested: u16, min: u16, max: u16 },
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
}

impl<D: DeviceAdapter> StationRuntime<D> {
    pub fn in_memory(device: D) -> Result<Self, RuntimeError> {
        Self::from_connection(Connection::open_in_memory()?, device)
    }

    pub fn open(path: impl AsRef<Path>, device: D) -> Result<Self, RuntimeError> {
        Self::from_connection(Connection::open(path)?, device)
    }

    fn from_connection(connection: Connection, device: D) -> Result<Self, RuntimeError> {
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS commands (
                command_id TEXT PRIMARY KEY,
                idempotency_key TEXT NOT NULL UNIQUE,
                command_json TEXT NOT NULL,
                status TEXT NOT NULL,
                outcome_json TEXT,
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

        Ok(Self { connection, device })
    }

    pub fn execute(
        &mut self,
        command: DeviceCommand,
        now_ms: u64,
    ) -> Result<CommandView, RuntimeError> {
        if command.schema_version != SCHEMA_VERSION {
            return Err(RuntimeError::UnsupportedSchemaVersion {
                expected: SCHEMA_VERSION,
                actual: command.schema_version,
            });
        }

        let command_json = serde_json::to_string(&command)?;
        let existing = self
            .connection
            .query_row(
                "SELECT command_id, command_json, status, outcome_json
                 FROM commands WHERE idempotency_key = ?1",
                params![&command.idempotency_key],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, Option<String>>(3)?,
                    ))
                },
            )
            .optional()?;

        if let Some((command_id, stored_command_json, status, outcome_json)) = existing {
            if stored_command_json == command_json {
                return Ok(CommandView {
                    command_id,
                    idempotency_key: command.idempotency_key,
                    status: command_status_from_db(&status)?,
                    outcome: outcome_json
                        .as_deref()
                        .map(serde_json::from_str)
                        .transpose()?,
                    was_replayed: true,
                });
            }

            return Err(RuntimeError::IdempotencyConflict {
                key: command.idempotency_key,
            });
        }

        if command.policy_grant_id.trim().is_empty() {
            return Err(RuntimeError::MissingPolicyGrant);
        }

        if command.expires_at_ms <= now_ms {
            return Err(RuntimeError::ExpiredCommand {
                expires_at_ms: command.expires_at_ms,
                now_ms,
            });
        }

        let requested_height = command.action.target_height_mm();
        if !(MIN_DESK_HEIGHT_MM..=MAX_DESK_HEIGHT_MM).contains(&requested_height) {
            return Err(RuntimeError::UnsafeDeskHeight {
                requested: requested_height,
                min: MIN_DESK_HEIGHT_MM,
                max: MAX_DESK_HEIGHT_MM,
            });
        }

        let initial_snapshot = self.device.snapshot(now_ms)?;
        if command.expected_state_version != initial_snapshot.state_version {
            return Err(RuntimeError::StaleState {
                expected: command.expected_state_version,
                actual: initial_snapshot.state_version,
            });
        }

        self.connection.execute(
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
        self.append_event(&command.command_id, "accepted", now_ms)?;
        self.connection.execute(
            "UPDATE commands SET status = 'executing', updated_at_ms = ?2
             WHERE command_id = ?1",
            params![&command.command_id, now_ms],
        )?;
        self.append_event(&command.command_id, "executing", now_ms)?;

        let execution = self.device.apply(&command.action)?;
        if execution == DeviceExecution::OutcomeUnknown {
            self.connection.execute(
                "UPDATE commands SET status = 'outcome_unknown', updated_at_ms = ?2
                 WHERE command_id = ?1",
                params![&command.command_id, now_ms],
            )?;
            self.append_event(&command.command_id, "outcome_unknown", now_ms)?;
            return Ok(CommandView {
                command_id: command.command_id,
                idempotency_key: command.idempotency_key,
                status: CommandStatus::OutcomeUnknown,
                outcome: None,
                was_replayed: false,
            });
        }

        let observed = self.device.snapshot(now_ms)?;
        let verified = observed.desk_height_mm == command.action.target_height_mm();
        let status = if verified {
            CommandStatus::Succeeded
        } else {
            CommandStatus::Failed
        };
        let outcome = verified.then_some(VerifiedOutcome {
            state_version: observed.state_version,
            desk_height_mm: observed.desk_height_mm,
            verified_at_ms: now_ms,
        });
        let outcome_json = outcome.as_ref().map(serde_json::to_string).transpose()?;
        let status_text = if verified { "succeeded" } else { "failed" };

        self.connection.execute(
            "UPDATE commands
             SET status = ?2, outcome_json = ?3, updated_at_ms = ?4
             WHERE command_id = ?1",
            params![&command.command_id, status_text, outcome_json, now_ms],
        )?;
        self.append_event(
            &command.command_id,
            if verified {
                "verified_succeeded"
            } else {
                "verification_failed"
            },
            now_ms,
        )?;

        Ok(CommandView {
            command_id: command.command_id,
            idempotency_key: command.idempotency_key,
            status,
            outcome,
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
            Ok(CommandEvent {
                sequence: row.get(0)?,
                command_id: row.get(1)?,
                event_type: row.get(2)?,
                at_ms: row.get(3)?,
            })
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
        for (command_id, idempotency_key, command_json, status_text) in pending {
            let command: DeviceCommand = serde_json::from_str(&command_json)?;
            let observed = self.device.snapshot(now_ms)?;

            if observed.desk_height_mm == command.action.target_height_mm() {
                let outcome = VerifiedOutcome {
                    state_version: observed.state_version,
                    desk_height_mm: observed.desk_height_mm,
                    verified_at_ms: now_ms,
                };
                let outcome_json = serde_json::to_string(&outcome)?;
                self.connection.execute(
                    "UPDATE commands
                     SET status = 'succeeded', outcome_json = ?2, updated_at_ms = ?3
                     WHERE command_id = ?1",
                    params![&command_id, outcome_json, now_ms],
                )?;
                self.append_event(&command_id, "reconciled_succeeded", now_ms)?;
                reconciled.push(CommandView {
                    command_id,
                    idempotency_key,
                    status: CommandStatus::Succeeded,
                    outcome: Some(outcome),
                    was_replayed: false,
                });
            } else {
                reconciled.push(CommandView {
                    command_id,
                    idempotency_key,
                    status: command_status_from_db(&status_text)?,
                    outcome: None,
                    was_replayed: false,
                });
            }
        }

        Ok(reconciled)
    }

    fn append_event(
        &self,
        command_id: &str,
        event_type: &str,
        at_ms: u64,
    ) -> Result<(), RuntimeError> {
        self.connection.execute(
            "INSERT INTO command_events (command_id, event_type, at_ms)
             VALUES (?1, ?2, ?3)",
            params![command_id, event_type, at_ms],
        )?;
        Ok(())
    }
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
