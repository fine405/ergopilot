use device_sim::SqliteSimulator;
use ergopilot_protocol::{CommandStatus, DeviceAction, PolicyOutcome, SCHEMA_VERSION};
use policy_core::PolicyAuthority;
use station_core::DeviceAdapter;
use task_runtime::{
    ApprovalStatus, SuspensionReason, TaskRunStatus, TaskRuntime, TaskRuntimeError, TaskSpec,
};

#[test]
fn desk_motion_waits_for_approval_without_moving_the_device() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let spec = TaskSpec::prepare_focus_session("task-focus-1", "user-1", 760);

    let run = runtime.start(spec, 1_000).unwrap();

    assert_eq!(run.status, TaskRunStatus::AwaitingApproval);
    assert!(run.approval.as_ref().unwrap().expires_at_ms > 1_000);
    assert_eq!(runtime.station_snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn approval_resumes_the_same_run_and_completes_the_device_action() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let spec = TaskSpec::prepare_focus_session("task-focus-2", "user-1", 760);
    let awaiting = runtime.start(spec, 1_000).unwrap();

    let completed = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    assert_eq!(completed.run_id, awaiting.run_id);
    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(
        completed.approval.as_ref().unwrap().status,
        ApprovalStatus::Approved
    );
    assert_eq!(
        completed.command.as_ref().unwrap().status,
        CommandStatus::Succeeded
    );
    let snapshot = runtime.station_snapshot(1_101).unwrap();
    assert_eq!(snapshot.desk_height_mm, 760);
    assert_eq!(snapshot.movement_count, 1);
}

#[test]
fn lumbar_motion_waits_for_approval_then_persists_verified_state() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let spec = TaskSpec::adjust_seated_support("task-lumbar-1", "user-1", 65);

    let awaiting = runtime.start(spec, 1_000).unwrap();
    let before = runtime.station_snapshot(1_001).unwrap();
    let completed = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();
    let after = runtime.station_snapshot(1_101).unwrap();

    assert_eq!(awaiting.status, TaskRunStatus::AwaitingApproval);
    assert_eq!(before.lumbar_support_percent, 35);
    assert_eq!(before.movement_count, 0);
    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert!(completed.desk_motion_progress.is_empty());
    assert_eq!(
        completed
            .command
            .as_ref()
            .unwrap()
            .outcome
            .as_ref()
            .unwrap()
            .lumbar_support_percent,
        65
    );
    assert_eq!(after.lumbar_support_percent, 65);
    assert_eq!(after.desk_height_mm, 720);
    assert_eq!(after.movement_count, 1);
}

#[test]
fn desk_motion_progress_is_ordered_and_survives_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-progress", "user-1", 820),
            1_000,
        )
        .unwrap();

    let completed = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    assert_eq!(completed.desk_motion_progress.len(), 11);
    assert_eq!(completed.desk_motion_progress[0].progress_percent, 0);
    assert_eq!(completed.desk_motion_progress[0].desk_height_mm, 720);
    assert_eq!(completed.desk_motion_progress[10].progress_percent, 100);
    assert_eq!(completed.desk_motion_progress[10].desk_height_mm, 820);
    assert!(completed
        .desk_motion_progress
        .windows(2)
        .all(|events| events[0].sequence < events[1].sequence
            && events[0].progress_percent < events[1].progress_percent));
    drop(runtime);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let restarted = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let restored = restarted.inspect(&awaiting.run_id).unwrap();

    assert_eq!(
        restored.desk_motion_progress,
        completed.desk_motion_progress
    );
}

fn policy_authority() -> PolicyAuthority {
    PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap()
}

#[test]
fn expired_approval_cannot_authorize_device_motion() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-expired", "user-1", 760),
            1_000,
        )
        .unwrap();
    let expires_at_ms = awaiting.approval.as_ref().unwrap().expires_at_ms;

    let error = runtime
        .approve(&awaiting.run_id, "user-1", expires_at_ms)
        .unwrap_err();

    assert!(matches!(
        error,
        TaskRuntimeError::ApprovalExpired {
            expires_at_ms: expired,
            now_ms
        } if expired == expires_at_ms && now_ms == expires_at_ms
    ));
    assert_eq!(
        runtime
            .inspect(&awaiting.run_id)
            .unwrap()
            .approval
            .unwrap()
            .status,
        ApprovalStatus::Expired
    );
    assert_eq!(
        runtime
            .station_snapshot(expires_at_ms + 1)
            .unwrap()
            .movement_count,
        0
    );
}

#[test]
fn pending_approval_survives_restart_and_duplicate_approval_does_not_move_twice() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-focus-restart", "user-1", 780),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    assert_eq!(
        restarted.inspect(&awaiting.run_id).unwrap().status,
        TaskRunStatus::AwaitingApproval
    );

    let completed = restarted
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    let replayed_approval = restarted
        .approve(&awaiting.run_id, "user-1", 1_200)
        .unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(replayed_approval.status, TaskRunStatus::Completed);
    assert_eq!(restarted.station_snapshot(1_201).unwrap().movement_count, 1);
}

#[test]
fn completed_run_exposes_an_ordered_approval_and_execution_timeline() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-timeline", "user-1", 760),
            1_000,
        )
        .unwrap();

    let completed = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();
    let event_types: Vec<_> = completed
        .events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();

    assert_eq!(
        event_types,
        [
            "run_started",
            "approval_required",
            "approval_granted",
            "command_dispatched",
            "run_completed"
        ]
    );
    assert!(completed
        .events
        .windows(2)
        .all(|events| events[0].sequence < events[1].sequence));
}

#[test]
fn restarting_the_same_task_returns_its_existing_completed_run() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let spec = TaskSpec::prepare_focus_session("task-focus-idempotent", "user-1", 760);
    let awaiting = runtime.start(spec.clone(), 1_000).unwrap();
    runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    let replay = runtime.start(spec, 1_200).unwrap();

    assert_eq!(replay.status, TaskRunStatus::Completed);
    assert_eq!(runtime.station_snapshot(1_201).unwrap().movement_count, 1);
}

#[test]
fn a_different_user_cannot_approve_the_requesters_motion_task() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-owner", "user-owner", 760),
            1_000,
        )
        .unwrap();

    let error = runtime
        .approve(&awaiting.run_id, "user-other", 1_100)
        .unwrap_err();

    assert!(matches!(
        error,
        TaskRuntimeError::UnauthorizedApprover {
            ref expected,
            ref actual
        } if expected == "user-owner" && actual == "user-other"
    ));
    assert_eq!(runtime.station_snapshot(1_101).unwrap().movement_count, 0);
}

#[test]
fn unsafe_motion_is_denied_without_creating_an_approval() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();

    let denied = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-unsafe", "user-1", 1_400),
            1_000,
        )
        .unwrap();

    assert_eq!(denied.status, TaskRunStatus::Denied);
    assert!(denied.approval.is_none());
    assert_eq!(denied.policy_decision.outcome, PolicyOutcome::Deny);
    assert_eq!(
        denied.policy_decision.reason_code.as_deref(),
        Some("desk_height_out_of_range")
    );
    assert_eq!(runtime.station_snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn state_change_while_waiting_for_approval_suspends_the_old_plan() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-focus-stale", "user-1", 780),
            1_000,
        )
        .unwrap();
    let mut manual_control = SqliteSimulator::open(&database).unwrap();
    let before_manual_change = manual_control.snapshot(1_050).unwrap();
    manual_control
        .apply(
            &DeviceAction::DeskMoveToHeight { height_mm: 740 },
            before_manual_change.state_version,
        )
        .unwrap();

    let suspended = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    assert_eq!(
        suspended.suspension_reason,
        Some(SuspensionReason::StaleState)
    );
    assert_eq!(
        suspended.events.last().unwrap().event_type.as_str(),
        "run_suspended"
    );
    let final_state = runtime.station_snapshot(1_101).unwrap();
    assert_eq!(final_state.desk_height_mm, 740);
    assert_eq!(final_state.movement_count, 1);
}

#[test]
fn unsupported_task_schema_is_rejected_before_a_run_is_created() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let mut spec = TaskSpec::prepare_focus_session("task-future-schema", "user-1", 760);
    spec.schema_version = SCHEMA_VERSION + 1;

    let error = runtime.start(spec, 1_000).unwrap_err();

    assert!(matches!(
        error,
        TaskRuntimeError::UnsupportedTaskSchemaVersion {
            expected: SCHEMA_VERSION,
            actual
        } if actual == SCHEMA_VERSION + 1
    ));
    assert_eq!(runtime.station_snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn task_without_a_planned_step_is_rejected_before_policy_evaluation() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let mut spec = TaskSpec::prepare_focus_session("task-empty-plan", "user-1", 760);
    spec.steps.clear();

    let error = runtime.start(spec, 1_000).unwrap_err();

    assert!(matches!(error, TaskRuntimeError::InvalidTaskSpec { .. }));
    assert_eq!(runtime.station_snapshot(1_001).unwrap().movement_count, 0);
}
