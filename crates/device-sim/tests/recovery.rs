use device_sim::{NextFault, SqliteSimulator};
use ergopilot_protocol::{CommandStatus, DeviceAction, DeviceCommand, SCHEMA_VERSION};
use station_core::{DeviceAdapter, StationRuntime};

fn command(expected_state_version: u64) -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-recovery-1".into(),
        task_run_id: "run-recovery-1".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version,
        idempotency_key: "run-recovery-1:desk:step-1".into(),
        expires_at_ms: 10_000,
        trace_id: "trace-recovery-1".into(),
        policy_grant_id: "grant-recovery-1".into(),
    }
}

#[test]
fn restart_reconciles_an_effect_that_happened_before_the_terminal_ack() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    let initial = simulator.snapshot(1_000).unwrap();
    simulator.set_next_fault(NextFault::LoseReportAfterEffect);
    let mut first_process = StationRuntime::open(&database, simulator).unwrap();

    let uncertain = first_process
        .execute(command(initial.state_version), 1_100)
        .unwrap();
    assert_eq!(uncertain.status, CommandStatus::OutcomeUnknown);
    drop(first_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted_process = StationRuntime::open(&database, simulator).unwrap();
    let recovered = restarted_process.reconcile_pending(1_200).unwrap();

    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].status, CommandStatus::Succeeded);
    assert_eq!(recovered[0].outcome.as_ref().unwrap().desk_height_mm, 760);

    let replay = restarted_process
        .execute(command(initial.state_version), 1_300)
        .unwrap();
    assert!(replay.was_replayed);
    assert_eq!(restarted_process.snapshot(1_301).unwrap().movement_count, 1);
}
