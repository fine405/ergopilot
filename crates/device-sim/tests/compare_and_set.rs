use device_sim::SqliteSimulator;
use ergopilot_protocol::DeviceAction;
use station_core::DeviceAdapter;

#[test]
fn actuator_rechecks_the_expected_version_at_the_effect_boundary() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut stale_caller = SqliteSimulator::open(&database).unwrap();
    let observed = stale_caller.snapshot(1_000).unwrap();
    let mut winning_caller = SqliteSimulator::open(&database).unwrap();

    winning_caller
        .apply(
            &DeviceAction::DeskMoveToHeight { height_mm: 760 },
            observed.state_version,
        )
        .unwrap();
    let error = stale_caller
        .apply(
            &DeviceAction::DeskMoveToHeight { height_mm: 800 },
            observed.state_version,
        )
        .unwrap_err();

    assert!(error.message.contains("expected state version"));
    let final_state = stale_caller.snapshot(1_100).unwrap();
    assert_eq!(final_state.desk_height_mm, 760);
    assert_eq!(final_state.movement_count, 1);
}
