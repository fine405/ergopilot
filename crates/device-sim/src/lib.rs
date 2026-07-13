use ergopilot_protocol::{DeviceAction, WorkstationSnapshot};
use rusqlite::{params, Connection};
use station_core::{DeviceAdapter, DeviceError, DeviceExecution};
use std::path::Path;
use thiserror::Error;

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
}

impl SqliteSimulator {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, SimulatorError> {
        let connection = Connection::open(path)?;
        connection.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS simulator_state (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                station_id TEXT NOT NULL,
                state_version INTEGER NOT NULL,
                desk_height_mm INTEGER NOT NULL,
                movement_count INTEGER NOT NULL
            );

            INSERT OR IGNORE INTO simulator_state (
                singleton, station_id, state_version, desk_height_mm, movement_count
            ) VALUES (1, 'station-sim-1', 1, 720, 0);
            ",
        )?;

        Ok(Self {
            connection,
            next_fault: NextFault::None,
        })
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
}

impl DeviceAdapter for SqliteSimulator {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        if self.next_fault == NextFault::DeviceUnavailableBeforeDispatch {
            self.next_fault = NextFault::None;
            return Err(DeviceError::unavailable(
                "simulated device unavailable before dispatch",
            ));
        }
        self.read_snapshot(observed_at_ms)
            .map_err(|error| DeviceError::new(error.to_string()))
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        let execution = match std::mem::take(&mut self.next_fault) {
            NextFault::None => DeviceExecution::Reported,
            NextFault::DeviceUnavailableBeforeDispatch
            | NextFault::DeviceUnavailableBeforeEffect => {
                return Err(DeviceError::unavailable(
                    "simulated device unavailable before effect",
                ));
            }
            NextFault::LoseReportAfterEffect => DeviceExecution::OutcomeUnknown,
        };
        let updated = self
            .connection
            .execute(
                "UPDATE simulator_state
                 SET desk_height_mm = ?1,
                     state_version = state_version + 1,
                     movement_count = movement_count + 1
                 WHERE singleton = 1 AND state_version = ?2",
                params![action.target_height_mm(), expected_state_version],
            )
            .map_err(|error| DeviceError::new(error.to_string()))?;
        if updated == 0 {
            let actual = self
                .read_snapshot(0)
                .map_err(|error| DeviceError::new(error.to_string()))?
                .state_version;
            return Err(DeviceError::new(format!(
                "expected state version {expected_state_version}, but actuator is at {actual}"
            )));
        }

        Ok(execution)
    }
}
