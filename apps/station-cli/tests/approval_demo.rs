use station_cli::run_approval_demo;
use task_runtime::TaskRunStatus;

#[test]
fn approval_demo_runs_the_persistent_human_in_the_loop_flow() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("approval.sqlite");
    let mut output = Vec::new();

    let summary = run_approval_demo(&database, &mut output).unwrap();
    let output = String::from_utf8(output).unwrap();

    assert_eq!(summary.before_approval, TaskRunStatus::AwaitingApproval);
    assert_eq!(summary.after_approval, TaskRunStatus::Completed);
    assert_eq!(summary.movement_count, 1);
    assert!(output.contains("approval_required"));
    assert!(output.contains("approval_granted"));
    assert!(output.contains("desk.motion.requires_approval"));
    assert!(output.contains("run_completed"));
}
