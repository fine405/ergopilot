use device_sim::SqliteSimulator;
use ergopilot_protocol::DeviceAction;
use rusqlite::Connection;
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

#[test]
fn simulated_lumbar_support_survives_a_process_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");

    let mut first_process = SqliteSimulator::open(&database).unwrap();
    let before = first_process.snapshot(1_000).unwrap();
    let report = first_process
        .apply(
            &DeviceAction::ChairSetLumbarSupport { level_percent: 65 },
            before.state_version,
        )
        .unwrap();
    drop(first_process);

    let mut restarted_process = SqliteSimulator::open(&database).unwrap();
    let after = restarted_process.snapshot(1_100).unwrap();

    assert_eq!(report, DeviceExecution::Reported);
    assert_eq!(before.lumbar_support_percent, 35);
    assert_eq!(after.lumbar_support_percent, 65);
    assert_eq!(after.desk_height_mm, before.desk_height_mm);
    assert_eq!(after.state_version, before.state_version + 1);
    assert_eq!(after.movement_count, 1);
}

#[test]
fn existing_desk_state_is_migrated_with_default_lumbar_support() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let legacy = Connection::open(&database).unwrap();
    legacy
        .execute_batch(
            "CREATE TABLE simulator_state (
                singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
                station_id TEXT NOT NULL,
                state_version INTEGER NOT NULL,
                desk_height_mm INTEGER NOT NULL,
                movement_count INTEGER NOT NULL
            );
            INSERT INTO simulator_state (
                singleton, station_id, state_version, desk_height_mm, movement_count
            ) VALUES (1, 'station-existing', 7, 810, 4);",
        )
        .unwrap();
    drop(legacy);

    let mut migrated = SqliteSimulator::open(&database).unwrap();
    let snapshot = migrated.snapshot(1_000).unwrap();

    assert_eq!(snapshot.station_id, "station-existing");
    assert_eq!(snapshot.state_version, 7);
    assert_eq!(snapshot.desk_height_mm, 810);
    assert_eq!(snapshot.lumbar_support_percent, 35);
    assert_eq!(snapshot.movement_count, 4);
}
