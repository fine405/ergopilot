use device_sim::SqliteSimulator;
use ergopilot_protocol::{
    ChairErgonomics, DeviceAction, DeviceCommand, LightConfiguration, ReminderConfiguration,
    SCHEMA_VERSION,
};
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
    assert_eq!(snapshot.seat_height_mm, 470);
    assert_eq!(snapshot.light_color_temperature_k, 4_300);
    assert!(snapshot.reminder_enabled);
    assert_eq!(snapshot.movement_count, 4);
}

#[test]
fn default_sedentary_reminder_starts_once_and_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");

    let mut first_process = SqliteSimulator::open(&database).unwrap();
    let first = first_process.snapshot(1_000).unwrap();
    let later = first_process.snapshot(1_500).unwrap();
    drop(first_process);

    let mut restarted = SqliteSimulator::open(&database).unwrap();
    let after_restart = restarted.snapshot(2_000).unwrap();

    assert!(first.reminder_enabled);
    assert_eq!(first.reminder_started_at_ms, 1_000);
    assert_eq!(later.reminder_started_at_ms, 1_000);
    assert_eq!(after_restart.reminder_started_at_ms, 1_000);
}

#[test]
fn complete_ergonomic_environment_survives_a_process_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    let mut version = simulator.snapshot(1_000).unwrap().state_version;
    let actions = [
        DeviceAction::ChairAdjustErgonomics(ChairErgonomics {
            seat_height_mm: 490,
            seat_depth_mm: 470,
            lumbar_support_percent: 70,
            armrest_height_mm: 260,
            armrest_depth_mm: 20,
            armrest_width_mm: 500,
            armrest_angle_deg: -10,
            recline_angle_deg: 125,
            recline_resistance_percent: 40,
            recline_locked: false,
            headrest_height_mm: 80,
            headrest_angle_deg: 12,
        }),
        DeviceAction::LightConfigure(LightConfiguration {
            brightness_percent: 35,
            color_temperature_k: 3_000,
        }),
        DeviceAction::ReminderConfigure(ReminderConfiguration {
            enabled: true,
            interval_minutes: 30,
        }),
    ];
    for (index, action) in actions.into_iter().enumerate() {
        let command = DeviceCommand {
            schema_version: SCHEMA_VERSION,
            command_id: format!("command-{index}"),
            task_run_id: "run-profile".into(),
            action,
            expected_state_version: version,
            idempotency_key: format!("run-profile:{index}"),
            expires_at_ms: 10_000,
            trace_id: "trace-profile".into(),
            policy_grant_id: format!("grant-{index}"),
        };
        simulator
            .apply_command(&command, 1_100 + index as u64)
            .unwrap();
        version += 1;
    }
    drop(simulator);

    let mut restarted = SqliteSimulator::open(&database).unwrap();
    let snapshot = restarted.snapshot(1_200).unwrap();

    assert_eq!(snapshot.seat_height_mm, 490);
    assert_eq!(snapshot.seat_depth_mm, 470);
    assert_eq!(snapshot.recline_angle_deg, 125);
    assert!(!snapshot.recline_locked);
    assert_eq!(snapshot.light_brightness_percent, 35);
    assert_eq!(snapshot.light_color_temperature_k, 3_000);
    assert_eq!(snapshot.reminder_interval_minutes, 30);
    assert_eq!(snapshot.reminder_started_at_ms, 1_102);
}
