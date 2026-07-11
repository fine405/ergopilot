use device_sim::SqliteSimulator;
use ergopilot_protocol::DeviceAction;
use station_core::{DeviceAdapter, DeviceExecution};

#[test]
fn simulated_physical_state_survives_a_process_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");

    let mut first_process = SqliteSimulator::open(&database).unwrap();
    let before = first_process.snapshot(1_000).unwrap();
    let report = first_process
        .apply(
            &DeviceAction::DeskMoveToHeight { height_mm: 760 },
            before.state_version,
        )
        .unwrap();
    assert_eq!(report, DeviceExecution::Reported);
    drop(first_process);

    let mut restarted_process = SqliteSimulator::open(&database).unwrap();
    let after = restarted_process.snapshot(1_100).unwrap();

    assert_eq!(before.desk_height_mm, 720);
    assert_eq!(after.desk_height_mm, 760);
    assert_eq!(after.state_version, before.state_version + 1);
    assert_eq!(after.movement_count, 1);
}
