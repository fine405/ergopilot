use ergopilot_protocol::CommandStatus;
use station_cli::{run_demo, DemoError};

#[test]
fn demo_exposes_normal_replay_and_restart_recovery_paths() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut output = Vec::new();

    let summary = run_demo(&database, &mut output).unwrap();
    let output = String::from_utf8(output).unwrap();

    assert_eq!(summary.first_status, CommandStatus::Succeeded);
    assert!(summary.replay_was_replayed);
    assert_eq!(summary.uncertain_status, CommandStatus::OutcomeUnknown);
    assert_eq!(summary.recovered_status, CommandStatus::Succeeded);
    assert_eq!(summary.movement_count, 2);
    assert!(output.contains("verified_succeeded"));
    assert!(output.contains("outcome_unknown"));
    assert!(output.contains("reconciled_succeeded"));
}

#[test]
fn demo_refuses_to_delete_an_unmarked_database() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("important.sqlite");
    std::fs::write(&database, b"user data").unwrap();

    let error = run_demo(&database, &mut Vec::new()).unwrap_err();

    assert!(matches!(error, DemoError::RefusingToOverwrite { .. }));
    assert_eq!(std::fs::read(database).unwrap(), b"user data");
}
