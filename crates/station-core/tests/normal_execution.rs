use ergopilot_protocol::{
    CommandStatus, DeviceAction, DeviceCommand, WorkstationSnapshot, SCHEMA_VERSION,
};
use station_core::{DeviceAdapter, DeviceError, DeviceExecution, RuntimeError, StationRuntime};

struct TestDevice {
    snapshot: WorkstationSnapshot,
    fail_before_effect: bool,
}

impl TestDevice {
    fn new() -> Self {
        Self {
            snapshot: WorkstationSnapshot {
                schema_version: SCHEMA_VERSION,
                station_id: "station-test".into(),
                state_version: 108,
                observed_at_ms: 0,
                desk_height_mm: 720,
                movement_count: 0,
            },
            fail_before_effect: false,
        }
    }

    fn unavailable() -> Self {
        Self {
            fail_before_effect: true,
            ..Self::new()
        }
    }
}

impl DeviceAdapter for TestDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.snapshot.observed_at_ms = observed_at_ms;
        Ok(self.snapshot.clone())
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        if self.fail_before_effect {
            return Err(DeviceError::new("device is unavailable before dispatch"));
        }
        if self.snapshot.state_version != expected_state_version {
            return Err(DeviceError::new("state version changed before effect"));
        }
        self.snapshot.desk_height_mm = action.target_height_mm();
        self.snapshot.state_version += 1;
        self.snapshot.movement_count += 1;
        Ok(DeviceExecution::Reported)
    }
}

fn desk_command() -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-desk-42".into(),
        task_run_id: "run-focus-17".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 108,
        idempotency_key: "run-focus-17:desk:step-2".into(),
        expires_at_ms: 2_000,
        trace_id: "trace-1".into(),
        policy_grant_id: "grant-once-9".into(),
    }
}

#[test]
fn desk_move_is_successful_only_after_the_observed_height_matches() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();

    let result = runtime.execute(desk_command(), 1_000).unwrap();

    assert_eq!(result.status, CommandStatus::Succeeded);
    assert_eq!(result.outcome.unwrap().desk_height_mm, 760);
    assert_eq!(runtime.snapshot(1_001).unwrap().desk_height_mm, 760);
}

#[test]
fn duplicate_delivery_replays_the_existing_result_without_moving_again() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let command = desk_command();

    let first = runtime.execute(command.clone(), 1_000).unwrap();
    let replay = runtime.execute(command, 1_100).unwrap();

    assert_eq!(first.status, CommandStatus::Succeeded);
    assert_eq!(replay.status, CommandStatus::Succeeded);
    assert!(replay.was_replayed);
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 1);
}

#[test]
fn command_based_on_a_stale_snapshot_is_rejected_before_the_device_moves() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let mut command = desk_command();
    command.expected_state_version = 107;

    let error = runtime.execute(command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::StaleState {
            expected: 107,
            actual: 108
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn reusing_an_idempotency_key_for_a_different_intent_is_rejected() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    runtime.execute(desk_command(), 1_000).unwrap();
    let mut conflicting = desk_command();
    conflicting.command_id = "cmd-desk-43".into();
    conflicting.action = DeviceAction::DeskMoveToHeight { height_mm: 800 };

    let error = runtime.execute(conflicting, 1_100).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::IdempotencyConflict { ref key }
            if key == "run-focus-17:desk:step-2"
    ));
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 1);
}

#[test]
fn desk_height_outside_the_device_envelope_is_rejected() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let mut command = desk_command();
    command.action = DeviceAction::DeskMoveToHeight { height_mm: 1_400 };

    let error = runtime.execute(command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::UnsafeDeskHeight {
            requested: 1_400,
            min: 620,
            max: 1_280
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn command_that_arrives_after_its_expiry_is_rejected() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let mut command = desk_command();
    command.expires_at_ms = 999;

    let error = runtime.execute(command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::ExpiredCommand {
            expires_at_ms: 999,
            now_ms: 1_000
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn successful_command_exposes_an_ordered_observable_timeline() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    runtime.execute(desk_command(), 1_000).unwrap();

    let events = runtime.events("cmd-desk-42").unwrap();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();

    assert_eq!(event_types, ["accepted", "executing", "verified_succeeded"]);
    assert!(events
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
}

#[test]
fn action_without_a_policy_grant_is_rejected_locally() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let mut command = desk_command();
    command.policy_grant_id.clear();

    let error = runtime.execute(command, 1_000).unwrap_err();

    assert!(matches!(error, RuntimeError::MissingPolicyGrant));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn unsupported_command_schema_is_rejected_before_the_device_moves() {
    let mut runtime = StationRuntime::in_memory(TestDevice::new()).unwrap();
    let mut command = desk_command();
    command.schema_version = SCHEMA_VERSION + 1;

    let error = runtime.execute(command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::UnsupportedSchemaVersion {
            expected: SCHEMA_VERSION,
            actual
        } if actual == SCHEMA_VERSION + 1
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn definite_device_failure_becomes_terminal_and_observable() {
    let mut runtime = StationRuntime::in_memory(TestDevice::unavailable()).unwrap();
    let command = desk_command();

    let error = runtime.execute(command.clone(), 1_000).unwrap_err();
    assert!(matches!(error, RuntimeError::Device(_)));

    let events = runtime.events(&command.command_id).unwrap();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(event_types, ["accepted", "executing", "execution_failed"]);

    let replay = runtime.execute(command, 1_100).unwrap();
    assert_eq!(replay.status, CommandStatus::Failed);
    assert!(replay.was_replayed);
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 0);
}
