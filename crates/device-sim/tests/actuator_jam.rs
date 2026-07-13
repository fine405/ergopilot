use device_sim::{NextFault, SqliteSimulator};
use ergopilot_protocol::{DeviceAction, DeviceCommand, WorkstationSnapshot, SCHEMA_VERSION};
use station_core::{DeviceAdapter, DeviceErrorKind};

#[test]
fn actuator_jam_persists_the_known_partial_effect() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    let initial = simulator.snapshot(1_000).unwrap();
    let command = DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-jam-60".into(),
        task_run_id: "run-jam-60".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 820 },
        expected_state_version: initial.state_version,
        idempotency_key: "run-jam-60:desk-1".into(),
        expires_at_ms: 60_000,
        trace_id: "trace-jam-60".into(),
        policy_grant_id: "grant-jam-60".into(),
    };
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));

    let error = simulator.apply_command(&command, 1_100).unwrap_err();
    let jammed = simulator.snapshot(1_200).unwrap();
    let progress = simulator.desk_motion_progress(&command.command_id).unwrap();

    assert_eq!(error.kind(), DeviceErrorKind::ActuatorFault);
    assert_eq!(jammed.desk_height_mm, 780);
    assert_eq!(jammed.state_version, initial.state_version + 1);
    assert_eq!(jammed.movement_count, 1);
    assert_eq!(progress.last().unwrap().progress_percent, 60);
    assert_eq!(progress.last().unwrap().desk_height_mm, 780);
}

#[test]
fn actuator_jam_fault_is_rejected_for_instant_chair_actions_without_claiming_partial_effect() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    let initial = simulator.snapshot(1_000).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));

    let error = simulator
        .apply(
            &DeviceAction::ChairSetLumbarSupport { level_percent: 65 },
            initial.state_version,
        )
        .unwrap_err();
    let unchanged = simulator.snapshot(1_100).unwrap();

    assert_eq!(error.kind(), DeviceErrorKind::Other);
    assert_eq!(
        unchanged,
        WorkstationSnapshot {
            observed_at_ms: 1_100,
            ..initial
        }
    );
}
