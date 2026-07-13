use device_sim::{NextFault, SqliteSimulator};
use ergopilot_protocol::{DeviceAction, WorkstationSnapshot};
use policy_core::PolicyAuthority;
use station_core::{DeviceAdapter, DeviceError, DeviceExecution};
use std::panic::{catch_unwind, AssertUnwindSafe};
use task_runtime::{SuspensionReason, TaskRunStatus, TaskRuntime, TaskRuntimeError, TaskSpec};

struct CrashBeforeStationJournal {
    simulator: SqliteSimulator,
    snapshot_calls: usize,
}

struct ReadbackFailureDevice {
    snapshot: WorkstationSnapshot,
    fail_next_snapshot: bool,
}

struct ApplyFailureDevice {
    snapshot: WorkstationSnapshot,
}

impl ApplyFailureDevice {
    fn new() -> Self {
        Self {
            snapshot: WorkstationSnapshot {
                schema_version: ergopilot_protocol::SCHEMA_VERSION,
                station_id: "station-apply-failure".into(),
                state_version: 1,
                observed_at_ms: 0,
                desk_height_mm: 720,
                movement_count: 0,
            },
        }
    }
}

impl DeviceAdapter for ApplyFailureDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.snapshot.observed_at_ms = observed_at_ms;
        Ok(self.snapshot.clone())
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        Err(DeviceError::new("actuator unavailable before effect"))
    }
}

impl ReadbackFailureDevice {
    fn new() -> Self {
        Self {
            snapshot: WorkstationSnapshot {
                schema_version: ergopilot_protocol::SCHEMA_VERSION,
                station_id: "station-readback-failure".into(),
                state_version: 1,
                observed_at_ms: 0,
                desk_height_mm: 720,
                movement_count: 0,
            },
            fail_next_snapshot: false,
        }
    }
}

impl DeviceAdapter for ReadbackFailureDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        if std::mem::take(&mut self.fail_next_snapshot) {
            return Err(DeviceError::new("post-effect readback unavailable"));
        }
        self.snapshot.observed_at_ms = observed_at_ms;
        Ok(self.snapshot.clone())
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        assert_eq!(self.snapshot.state_version, expected_state_version);
        self.snapshot.desk_height_mm = action.target_height_mm();
        self.snapshot.state_version += 1;
        self.snapshot.movement_count += 1;
        self.fail_next_snapshot = true;
        Ok(DeviceExecution::Reported)
    }
}

impl DeviceAdapter for CrashBeforeStationJournal {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.snapshot_calls += 1;
        if self.snapshot_calls == 2 {
            panic!("simulated process crash before the station journal write");
        }
        self.simulator.snapshot(observed_at_ms)
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.simulator.apply(action, expected_state_version)
    }
}

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
            TaskSpec::prepare_focus_session("task-recovery-1", "user-1", 790),
            1_000,
        )
        .unwrap();
    let uncertain = first_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    assert_eq!(uncertain.status, TaskRunStatus::OutcomeUnknown);
    let resume_error = first_process.resume(&awaiting.run_id, 1_150).unwrap_err();
    assert!(matches!(
        resume_error,
        TaskRuntimeError::RunNotResumable { .. }
    ));
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

#[test]
fn task_run_resumes_after_device_unavailable_before_station_journal() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-unavailable-before-dispatch", "user-1", 795),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let mut unavailable_simulator = SqliteSimulator::open(&database).unwrap();
    unavailable_simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut unavailable_process =
        TaskRuntime::open(&database, unavailable_simulator, authority.clone()).unwrap();
    let suspended = unavailable_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();

    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    assert_eq!(
        suspended.suspension_reason,
        Some(SuspensionReason::DeviceUnavailable)
    );
    assert!(suspended.command.is_none());
    assert!(suspended.command_events.is_empty());
    assert_eq!(
        unavailable_process
            .station_snapshot(1_150)
            .unwrap()
            .movement_count,
        0
    );
    let reconcile_error = unavailable_process
        .reconcile(&awaiting.run_id, 1_175)
        .unwrap_err();
    assert!(matches!(
        reconcile_error,
        TaskRuntimeError::RunNotReconcilable { .. }
    ));
    drop(unavailable_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut recovered_process = TaskRuntime::open(&database, simulator, authority).unwrap();
    let completed = recovered_process.resume(&awaiting.run_id, 1_200).unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(completed.suspension_reason, None);
    assert_eq!(
        completed.events.last().unwrap().event_type.as_str(),
        "run_resumed"
    );
    let replayed = recovered_process.resume(&awaiting.run_id, 1_225).unwrap();
    assert_eq!(replayed, completed);
    assert_eq!(
        recovered_process
            .station_snapshot(1_250)
            .unwrap()
            .movement_count,
        1
    );
}

#[test]
fn failed_post_effect_readback_keeps_the_task_uncertain_until_reconciliation() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut runtime =
        TaskRuntime::open(&database, ReadbackFailureDevice::new(), authority).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-readback-failure", "user-1", 790),
            1_000,
        )
        .unwrap();

    let uncertain = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    assert_eq!(uncertain.status, TaskRunStatus::OutcomeUnknown);
    let recovered = runtime.reconcile(&awaiting.run_id, 1_200).unwrap();
    assert_eq!(recovered.status, TaskRunStatus::Completed);
    assert_eq!(runtime.station_snapshot(1_201).unwrap().movement_count, 1);
}

#[test]
fn restart_dispatches_a_persisted_intent_if_the_station_journal_is_still_empty() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let authority = policy_authority();
    let mut first_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-recovery-before-journal", "user-1", 780),
            1_000,
        )
        .unwrap();

    let crashed = catch_unwind(AssertUnwindSafe(|| {
        first_process
            .approve(&awaiting.run_id, "user-1", 1_100)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(first_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let recovered = restarted.reconcile(&awaiting.run_id, 1_200).unwrap();

    assert_eq!(recovered.status, TaskRunStatus::Completed);
    assert_eq!(restarted.station_snapshot(1_201).unwrap().movement_count, 1);
}

#[test]
fn reconcile_suspends_a_persisted_intent_after_station_state_changes() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let authority = policy_authority();
    let mut first_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-recovery-stale-intent", "user-1", 780),
            1_000,
        )
        .unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        first_process
            .approve(&awaiting.run_id, "user-1", 1_100)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(first_process);

    let mut manual_control = SqliteSimulator::open(&database).unwrap();
    let before_manual_change = manual_control.snapshot(1_150).unwrap();
    manual_control
        .apply(
            &DeviceAction::DeskMoveToHeight { height_mm: 740 },
            before_manual_change.state_version,
        )
        .unwrap();

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let recovered = restarted.reconcile(&awaiting.run_id, 1_200).unwrap();

    assert_eq!(recovered.status, TaskRunStatus::Suspended);
    assert_eq!(
        recovered.suspension_reason,
        Some(SuspensionReason::StaleState)
    );
    let final_state = restarted.station_snapshot(1_201).unwrap();
    assert_eq!(final_state.desk_height_mm, 740);
    assert_eq!(final_state.movement_count, 1);
    let resume_error = restarted.resume(&awaiting.run_id, 1_202).unwrap_err();
    assert!(matches!(
        resume_error,
        TaskRuntimeError::RunNotResumable { .. }
    ));
}

#[test]
fn resumed_device_failure_is_persisted_on_the_task_during_the_same_reconciliation() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let authority = policy_authority();
    let mut first_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-recovery-device-failure", "user-1", 780),
            1_000,
        )
        .unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        first_process
            .approve(&awaiting.run_id, "user-1", 1_100)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(first_process);

    let mut restarted = TaskRuntime::open(&database, ApplyFailureDevice::new(), authority).unwrap();
    assert!(restarted.reconcile(&awaiting.run_id, 1_200).is_err());

    assert_eq!(
        restarted.inspect(&awaiting.run_id).unwrap().status,
        TaskRunStatus::Failed
    );
}

#[test]
fn expired_pre_dispatch_intent_suspends_without_moving_after_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let authority = policy_authority();
    let mut first_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-recovery-expired-intent", "user-1", 780),
            1_000,
        )
        .unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        first_process
            .approve(&awaiting.run_id, "user-1", 1_100)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(first_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let recovered = restarted.reconcile(&awaiting.run_id, 70_000).unwrap();

    assert_eq!(recovered.status, TaskRunStatus::Suspended);
    assert_eq!(recovered.suspension_reason, Some(SuspensionReason::Expired));
    assert_eq!(
        restarted.station_snapshot(70_001).unwrap().movement_count,
        0
    );
    let resume_error = restarted.resume(&awaiting.run_id, 70_002).unwrap_err();
    assert!(matches!(
        resume_error,
        TaskRuntimeError::RunNotResumable { .. }
    ));
}

#[test]
fn restart_adopts_a_terminal_station_result_after_the_task_result_save_fails() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let authority = policy_authority();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-recovery-after-terminal", "user-1", 800),
            1_000,
        )
        .unwrap();
    let fault_connection = rusqlite::Connection::open(&database).unwrap();
    fault_connection
        .execute_batch(
            r#"
            CREATE TRIGGER fail_completed_task_save
            BEFORE UPDATE ON task_runs
            WHEN instr(NEW.stored_json, '"status":"completed"') > 0
            BEGIN
                SELECT RAISE(ABORT, 'simulated crash before task result save');
            END;
            "#,
        )
        .unwrap();

    let error = first_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap_err();
    assert!(matches!(error, TaskRuntimeError::Storage(_)));
    drop(first_process);
    fault_connection
        .execute_batch("DROP TRIGGER fail_completed_task_save;")
        .unwrap();
    drop(fault_connection);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let recovered = restarted.reconcile(&awaiting.run_id, 70_000).unwrap();

    assert_eq!(recovered.status, TaskRunStatus::Completed);
    assert_eq!(
        restarted.station_snapshot(70_001).unwrap().movement_count,
        1
    );
}

fn policy_authority() -> PolicyAuthority {
    PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap()
}
