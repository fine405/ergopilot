use ergopilot_protocol::{
    CommandStatus, DeviceAction, DeviceCommand, PolicyGrant, WorkstationSnapshot, SCHEMA_VERSION,
};
use policy_core::{GrantRequest, PolicyAuthority};
use station_core::{DeviceAdapter, DeviceError, DeviceExecution, StationRuntime};
use std::panic::{catch_unwind, AssertUnwindSafe};

struct CrashBeforeEffect;

impl DeviceAdapter for CrashBeforeEffect {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        Ok(snapshot(observed_at_ms))
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        panic!("simulated process crash before the device effect")
    }
}

struct UnchangedDevice;

impl DeviceAdapter for UnchangedDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        Ok(snapshot(observed_at_ms))
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        unreachable!("reconciliation must not blindly retry an uncertain action")
    }
}

#[test]
fn restart_turns_interrupted_execution_into_an_observable_uncertain_outcome() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let command = command();
    let authority = policy_authority();
    let grant = grant_for(&authority, &command);
    let mut first_process =
        StationRuntime::open(&database, CrashBeforeEffect, authority.verifier()).unwrap();

    let crashed = catch_unwind(AssertUnwindSafe(|| {
        let _ = first_process.execute(command.clone(), &grant, 1_000);
    }));
    assert!(crashed.is_err());
    drop(first_process);

    let mut restarted =
        StationRuntime::open(&database, UnchangedDevice, authority.verifier()).unwrap();
    let recovered = restarted.reconcile_pending(1_100).unwrap();

    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].status, CommandStatus::OutcomeUnknown);
    let event_types: Vec<_> = restarted
        .events(&command.command_id)
        .unwrap()
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(
        event_types,
        ["accepted", "executing", "reconciliation_pending"]
    );
}

fn snapshot(observed_at_ms: u64) -> WorkstationSnapshot {
    WorkstationSnapshot {
        schema_version: SCHEMA_VERSION,
        station_id: "station-test".into(),
        state_version: 108,
        observed_at_ms,
        desk_height_mm: 720,
        lumbar_support_percent: 35,
        movement_count: 0,
        ..WorkstationSnapshot::default()
    }
}

fn command() -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-crash-1".into(),
        task_run_id: "run-crash-1".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 108,
        idempotency_key: "run-crash-1:desk:step-1".into(),
        expires_at_ms: 2_000,
        trace_id: "trace-crash-1".into(),
        policy_grant_id: "grant-crash-1".into(),
    }
}

fn policy_authority() -> PolicyAuthority {
    PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap()
}

fn grant_for(authority: &PolicyAuthority, command: &DeviceCommand) -> PolicyGrant {
    authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 900,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap()
}
