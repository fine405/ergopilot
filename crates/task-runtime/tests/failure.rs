use ergopilot_protocol::{DeviceAction, WorkstationSnapshot, SCHEMA_VERSION};
use policy_core::PolicyAuthority;
use station_core::{DeviceAdapter, DeviceError, DeviceExecution};
use task_runtime::{TaskRunStatus, TaskRuntime, TaskSpec};

struct UnavailableDevice;

impl DeviceAdapter for UnavailableDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        Ok(WorkstationSnapshot {
            schema_version: SCHEMA_VERSION,
            station_id: "station-unavailable".into(),
            state_version: 1,
            observed_at_ms,
            desk_height_mm: 720,
            lumbar_support_percent: 35,
            movement_count: 0,
            ..WorkstationSnapshot::default()
        })
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        Err(DeviceError::new("device unavailable before effect"))
    }
}

struct OfflineDevice;

impl DeviceAdapter for OfflineDevice {
    fn snapshot(&mut self, _observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        Err(DeviceError::new("all sensors offline"))
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        unreachable!("denied task must not reach the actuator")
    }
}

#[test]
fn definite_device_failure_is_persisted_on_the_task_run() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = TaskRuntime::open(&database, UnavailableDevice, authority).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-device-failure", "user-1", 760),
            1_000,
        )
        .unwrap();

    assert!(runtime.approve(&awaiting.run_id, "user-1", 1_100).is_err());

    let failed = runtime.inspect(&awaiting.run_id).unwrap();
    assert_eq!(failed.status, TaskRunStatus::Failed);
    assert_eq!(
        failed.events.last().unwrap().event_type.as_str(),
        "run_failed"
    );
}

#[test]
fn deterministic_policy_can_deny_unsafe_input_while_the_device_is_offline() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = TaskRuntime::open(&database, OfflineDevice, authority).unwrap();

    let denied = runtime
        .start(
            TaskSpec::prepare_focus_session("task-offline-deny", "user-1", 1_400),
            1_000,
        )
        .unwrap();

    assert_eq!(denied.status, TaskRunStatus::Denied);
}
