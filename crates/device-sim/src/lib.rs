use ergopilot_protocol::{DeskMotionProgress, DeviceAction, DeviceCommand, WorkstationSnapshot};
use rusqlite::{params, Connection, TransactionBehavior};
use station_core::{DeviceAdapter, DeviceError, DeviceExecution};
use std::{path::Path, thread, time::Duration};
use thiserror::Error;

const MOTION_STEPS: u8 = 10;

#[derive(Debug, Error)]
pub enum SimulatorError {
    #[error(transparent)]
    Storage(#[from] rusqlite::Error),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NextFault {
    #[default]
    None,
    DeviceUnavailableBeforeDispatch,
    DeviceUnavailableBeforeEffect,
    LoseReportAfterEffect,
}

pub struct SqliteSimulator {
    connection: Connection,
    next_fault: NextFault,
    motion_step_delay: Duration,
}

impl SqliteSimulator {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SimulatorError> {
        let connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(2))?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS simulator_state (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                station_id TEXT NOT NULL,
                state_version INTEGER NOT NULL,
                desk_height_mm INTEGER NOT NULL,
                movement_count INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS simulator_motion (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                command_id TEXT NOT NULL UNIQUE,
                start_height_mm INTEGER NOT NULL,
                target_height_mm INTEGER NOT NULL,
                progress_percent INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS desk_motion_progress (
                sequence INTEGER PRIMARY KEY AUTOINCREMENT,
                command_id TEXT NOT NULL,
                progress_percent INTEGER NOT NULL,
                desk_height_mm INTEGER NOT NULL,
                at_ms INTEGER NOT NULL,
                UNIQUE(command_id, progress_percent)
            );

            INSERT OR IGNORE INTO simulator_state (
                singleton, station_id, state_version, desk_height_mm, movement_count
            ) VALUES (1, 'station-sim-1', 1, 720, 0);
            ",
        )?;

        Ok(Self {
            connection,
            next_fault: NextFault::None,
            motion_step_delay: Duration::ZERO,
        })
    }

    pub fn with_motion_step_delay(mut self, delay: Duration) -> Self {
        self.motion_step_delay = delay;
        self
    }

    pub fn set_next_fault(&mut self, fault: NextFault) {
        self.next_fault = fault;
    }

    fn read_snapshot(&self, observed_at_ms: u64) -> Result<WorkstationSnapshot, rusqlite::Error> {
        self.connection.query_row(
            "SELECT station_id, state_version, desk_height_mm, movement_count
             FROM simulator_state WHERE singleton = 1",
            [],
            |row| {
                Ok(WorkstationSnapshot {
                    schema_version: ergopilot_protocol::SCHEMA_VERSION,
                    station_id: row.get(0)?,
                    state_version: row.get(1)?,
                    observed_at_ms,
                    desk_height_mm: row.get(2)?,
                    movement_count: row.get(3)?,
                })
            },
        )
    }

    fn take_execution(&mut self) -> Result<DeviceExecution, DeviceError> {
        match std::mem::take(&mut self.next_fault) {
            NextFault::None => Ok(DeviceExecution::Reported),
            NextFault::DeviceUnavailableBeforeDispatch
            | NextFault::DeviceUnavailableBeforeEffect => Err(DeviceError::unavailable(
                "simulated device unavailable before effect",
            )),
            NextFault::LoseReportAfterEffect => Ok(DeviceExecution::OutcomeUnknown),
        }
    }

    fn apply_instant(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        let execution = self.take_execution()?;
        let updated = self
            .connection
            .execute(
                "UPDATE simulator_state
                 SET desk_height_mm = ?1,
                     state_version = state_version + 1,
                     movement_count = movement_count + 1
                 WHERE singleton = 1
                   AND state_version = ?2
                   AND NOT EXISTS (SELECT 1 FROM simulator_motion)",
                params![action.target_height_mm(), expected_state_version],
            )
            .map_err(storage_error)?;
        if updated == 0 {
            return Err(self.actuator_conflict(expected_state_version));
        }

        Ok(execution)
    }

    fn apply_progressive(
        &mut self,
        command: &DeviceCommand,
        started_at_ms: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        let execution = self.take_execution()?;
        let target_height_mm = command.action.target_height_mm();
        let start_height_mm = self.begin_motion(command, target_height_mm, started_at_ms)?;
        let step_delay_ms = u64::try_from(self.motion_step_delay.as_millis()).unwrap_or(u64::MAX);

        for step in 1..=MOTION_STEPS {
            if !self.motion_step_delay.is_zero() {
                thread::sleep(self.motion_step_delay);
            }
            let progress_percent = step * (100 / MOTION_STEPS);
            let desk_height_mm = interpolate_height(start_height_mm, target_height_mm, step);
            let at_ms = started_at_ms.saturating_add(step_delay_ms.saturating_mul(u64::from(step)));
            if self
                .persist_motion_step(&command.command_id, progress_percent, desk_height_mm, at_ms)
                .is_err()
            {
                return Ok(DeviceExecution::OutcomeUnknown);
            }
        }

        Ok(execution)
    }

    fn begin_motion(
        &mut self,
        command: &DeviceCommand,
        target_height_mm: u16,
        started_at_ms: u64,
    ) -> Result<u16, DeviceError> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let (state_version, start_height_mm) = transaction
            .query_row(
                "SELECT state_version, desk_height_mm
                 FROM simulator_state WHERE singleton = 1",
                [],
                |row| Ok((row.get::<_, u64>(0)?, row.get::<_, u16>(1)?)),
            )
            .map_err(storage_error)?;
        let active_motion = transaction
            .query_row("SELECT EXISTS(SELECT 1 FROM simulator_motion)", [], |row| {
                row.get::<_, bool>(0)
            })
            .map_err(storage_error)?;
        if active_motion {
            return Err(DeviceError::unavailable(
                "simulated desk already has an active motion",
            ));
        }
        if state_version != command.expected_state_version {
            return Err(DeviceError::new(format!(
                "expected state version {}, but actuator is at {state_version}",
                command.expected_state_version
            )));
        }
        transaction
            .execute(
                "INSERT INTO simulator_motion (
                    singleton, command_id, start_height_mm,
                    target_height_mm, progress_percent
                 ) VALUES (1, ?1, ?2, ?3, 0)",
                params![&command.command_id, start_height_mm, target_height_mm],
            )
            .map_err(storage_error)?;
        transaction
            .execute(
                "INSERT INTO desk_motion_progress (
                    command_id, progress_percent, desk_height_mm, at_ms
                 ) VALUES (?1, 0, ?2, ?3)",
                params![&command.command_id, start_height_mm, started_at_ms],
            )
            .map_err(storage_error)?;
        transaction.commit().map_err(storage_error)?;
        Ok(start_height_mm)
    }

    fn persist_motion_step(
        &mut self,
        command_id: &str,
        progress_percent: u8,
        desk_height_mm: u16,
        at_ms: u64,
    ) -> Result<(), rusqlite::Error> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let final_step = progress_percent == 100;
        let first_step = progress_percent == 100 / MOTION_STEPS;
        let updated = transaction.execute(
            "UPDATE simulator_state
             SET desk_height_mm = ?1,
                 state_version = state_version + ?2,
                 movement_count = movement_count + ?3
             WHERE singleton = 1
               AND EXISTS (
                   SELECT 1 FROM simulator_motion
                   WHERE singleton = 1 AND command_id = ?4
               )",
            params![
                desk_height_mm,
                u8::from(final_step),
                u8::from(first_step),
                command_id
            ],
        )?;
        if updated == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        transaction.execute(
            "INSERT INTO desk_motion_progress (
                command_id, progress_percent, desk_height_mm, at_ms
             ) VALUES (?1, ?2, ?3, ?4)",
            params![command_id, progress_percent, desk_height_mm, at_ms],
        )?;
        if final_step {
            transaction.execute(
                "DELETE FROM simulator_motion
                 WHERE singleton = 1 AND command_id = ?1",
                params![command_id],
            )?;
        } else {
            transaction.execute(
                "UPDATE simulator_motion SET progress_percent = ?2
                 WHERE singleton = 1 AND command_id = ?1",
                params![command_id, progress_percent],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    fn actuator_conflict(&self, expected_state_version: u64) -> DeviceError {
        let active_motion = self
            .connection
            .query_row("SELECT EXISTS(SELECT 1 FROM simulator_motion)", [], |row| {
                row.get::<_, bool>(0)
            })
            .unwrap_or(false);
        if active_motion {
            return DeviceError::unavailable("simulated desk already has an active motion");
        }
        let actual = self
            .read_snapshot(0)
            .map(|snapshot| snapshot.state_version)
            .unwrap_or_default();
        DeviceError::new(format!(
            "expected state version {expected_state_version}, but actuator is at {actual}"
        ))
    }
}

impl DeviceAdapter for SqliteSimulator {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        if self.next_fault == NextFault::DeviceUnavailableBeforeDispatch {
            self.next_fault = NextFault::None;
            return Err(DeviceError::unavailable(
                "simulated device unavailable before dispatch",
            ));
        }
        self.read_snapshot(observed_at_ms).map_err(storage_error)
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.apply_instant(action, expected_state_version)
    }

    fn apply_command(
        &mut self,
        command: &DeviceCommand,
        started_at_ms: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.apply_progressive(command, started_at_ms)
    }

    fn desk_motion_progress(
        &self,
        command_id: &str,
    ) -> Result<Vec<DeskMotionProgress>, DeviceError> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT sequence, command_id, progress_percent, desk_height_mm, at_ms
                 FROM desk_motion_progress
                 WHERE command_id = ?1
                 ORDER BY sequence ASC",
            )
            .map_err(storage_error)?;
        let rows = statement
            .query_map(params![command_id], |row| {
                Ok(DeskMotionProgress {
                    sequence: row.get(0)?,
                    command_id: row.get(1)?,
                    progress_percent: row.get(2)?,
                    desk_height_mm: row.get(3)?,
                    at_ms: row.get(4)?,
                })
            })
            .map_err(storage_error)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(storage_error)
    }

    fn prepare_reconciliation(&mut self, command_id: &str) -> Result<(), DeviceError> {
        self.connection
            .execute(
                "DELETE FROM simulator_motion WHERE command_id = ?1",
                params![command_id],
            )
            .map_err(storage_error)?;
        Ok(())
    }
}

fn interpolate_height(start_height_mm: u16, target_height_mm: u16, step: u8) -> u16 {
    let start = i32::from(start_height_mm);
    let distance = i32::from(target_height_mm) - start;
    let height = start + distance * i32::from(step) / i32::from(MOTION_STEPS);
    u16::try_from(height).expect("safe desk height interpolation must remain within u16")
}

fn storage_error(error: rusqlite::Error) -> DeviceError {
    DeviceError::new(error.to_string())
}
