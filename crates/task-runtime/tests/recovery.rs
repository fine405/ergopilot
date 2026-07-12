use device_sim::{NextFault, SqliteSimulator};
use policy_core::PolicyAuthority;
use task_runtime::{TaskGoal, TaskRunStatus, TaskRuntime, TaskSpec};

#[test]
fn task_run_reconciles_ack_loss_after_restart_without_repeating_the_effect() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::LoseReportAfterEffect);
    let authority = policy_authority();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec {
                task_id: "task-recovery-1".into(),
                requested_by: "user-1".into(),
                goal: TaskGoal::PrepareFocusSession {
                    desk_height_mm: 790,
                },
            },
            1_000,
        )
        .unwrap();
    let uncertain = first_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    assert_eq!(uncertain.status, TaskRunStatus::OutcomeUnknown);
    drop(first_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let recovered = restarted.reconcile(&awaiting.run_id, 1_200).unwrap();

    assert_eq!(recovered.status, TaskRunStatus::Completed);
    assert_eq!(restarted.station_snapshot(1_201).unwrap().movement_count, 1);
    assert_eq!(
        recovered.events.last().unwrap().event_type.as_str(),
        "run_reconciled"
    );
}

fn policy_authority() -> PolicyAuthority {
    PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap()
}
