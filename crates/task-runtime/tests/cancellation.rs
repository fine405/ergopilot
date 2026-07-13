use device_sim::{NextFault, SqliteSimulator};
use policy_core::PolicyAuthority;
use std::{
    sync::{Arc, Barrier},
    thread,
};
use task_runtime::{
    ApprovalStatus, TaskEventType, TaskRunStatus, TaskRuntime, TaskRuntimeError, TaskSpec,
};

#[test]
fn requester_can_cancel_pending_approval_and_replay_after_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-cancel-1", "user-1", 780),
            1_000,
        )
        .unwrap();

    let cancelled = runtime.cancel(&awaiting.run_id, "user-1", 1_100).unwrap();

    assert_eq!(cancelled.status, TaskRunStatus::Cancelled);
    assert_eq!(
        cancelled.approval.as_ref().unwrap().status,
        ApprovalStatus::Cancelled
    );
    assert_eq!(
        cancelled.events.last().unwrap().event_type,
        TaskEventType::RunCancelled
    );
    assert!(cancelled.command.is_none());
    assert_eq!(runtime.station_snapshot(1_101).unwrap().movement_count, 0);
    let event_count = cancelled.events.len();
    drop(runtime);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let replayed = restarted.cancel(&awaiting.run_id, "user-1", 1_200).unwrap();

    assert_eq!(replayed.status, TaskRunStatus::Cancelled);
    assert_eq!(replayed.events.len(), event_count);
    assert!(matches!(
        restarted.approve(&awaiting.run_id, "user-1", 1_300),
        Err(TaskRuntimeError::RunNotApprovable { .. })
    ));
    assert_eq!(restarted.station_snapshot(1_301).unwrap().movement_count, 0);
}

#[test]
fn a_different_user_cannot_cancel_the_requesters_run() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-cancel-owner", "user-owner", 780),
            1_000,
        )
        .unwrap();

    let error = runtime
        .cancel(&awaiting.run_id, "user-other", 1_100)
        .unwrap_err();

    assert!(matches!(
        error,
        TaskRuntimeError::UnauthorizedCanceller {
            ref expected,
            ref actual,
        } if expected == "user-owner" && actual == "user-other"
    ));
    assert_eq!(
        runtime.inspect(&awaiting.run_id).unwrap().status,
        TaskRunStatus::AwaitingApproval
    );
    assert_eq!(runtime.station_snapshot(1_101).unwrap().movement_count, 0);
}

#[test]
fn a_suspended_run_cannot_claim_cancellation_without_device_arbitration() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-cancel-suspended", "user-1", 780),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let suspended = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();
    assert_eq!(suspended.status, TaskRunStatus::Suspended);

    assert!(matches!(
        runtime.cancel(&awaiting.run_id, "user-1", 1_200),
        Err(TaskRuntimeError::RunNotCancellable { .. })
    ));
    assert_eq!(
        runtime.inspect(&awaiting.run_id).unwrap().status,
        TaskRunStatus::Suspended
    );
    assert_eq!(runtime.station_snapshot(1_201).unwrap().movement_count, 0);
}

#[test]
fn concurrent_approval_and_cancellation_have_one_durable_winner() {
    for iteration in 0..20 {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("station.sqlite");
        let simulator = SqliteSimulator::open(&database).unwrap();
        let mut setup = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
        let awaiting = setup
            .start(
                TaskSpec::prepare_focus_session(
                    format!("task-cancel-race-{iteration}"),
                    "user-1",
                    780,
                ),
                1_000,
            )
            .unwrap();
        drop(setup);

        let barrier = Arc::new(Barrier::new(2));
        let approve_database = database.clone();
        let approve_run_id = awaiting.run_id.clone();
        let approve_barrier = Arc::clone(&barrier);
        let approve = thread::spawn(move || {
            let simulator = SqliteSimulator::open(&approve_database).unwrap();
            let mut runtime =
                TaskRuntime::open(&approve_database, simulator, policy_authority()).unwrap();
            approve_barrier.wait();
            match runtime.approve(&approve_run_id, "user-1", 1_100) {
                Ok(view) => {
                    assert_eq!(view.status, TaskRunStatus::Completed);
                    true
                }
                Err(TaskRuntimeError::RunNotApprovable { .. }) => false,
                result => panic!("unexpected approval result: {result:?}"),
            }
        });

        let cancel_database = database.clone();
        let cancel_run_id = awaiting.run_id.clone();
        let cancel = thread::spawn(move || {
            let simulator = SqliteSimulator::open(&cancel_database).unwrap();
            let mut runtime =
                TaskRuntime::open(&cancel_database, simulator, policy_authority()).unwrap();
            barrier.wait();
            match runtime.cancel(&cancel_run_id, "user-1", 1_100) {
                Ok(view) => {
                    assert_eq!(view.status, TaskRunStatus::Cancelled);
                    true
                }
                Err(TaskRuntimeError::RunNotCancellable { .. }) => false,
                result => panic!("unexpected cancellation result: {result:?}"),
            }
        });

        let approval_won = approve.join().unwrap();
        let cancellation_won = cancel.join().unwrap();
        assert_ne!(approval_won, cancellation_won);

        let simulator = SqliteSimulator::open(&database).unwrap();
        let mut inspect = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
        let final_run = inspect.inspect(&awaiting.run_id).unwrap();
        let snapshot = inspect.station_snapshot(1_200).unwrap();
        if cancellation_won {
            assert_eq!(final_run.status, TaskRunStatus::Cancelled);
            assert_eq!(snapshot.movement_count, 0);
        } else {
            assert_eq!(final_run.status, TaskRunStatus::Completed);
            assert_eq!(snapshot.movement_count, 1);
        }
    }
}

fn policy_authority() -> PolicyAuthority {
    PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap()
}
