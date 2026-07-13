use device_sim::{NextFault, SqliteSimulator};
use ergopilot_protocol::{
    CommandFailureReason, CommandStatus, DeskMotionProgress, DeviceAction, DeviceCommand,
    WorkstationSnapshot,
};
use policy_core::PolicyAuthority;
use station_core::{DeviceAdapter, DeviceError, DeviceExecution};
use std::{
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, Barrier},
    thread,
};
use task_runtime::{
    SuspensionReason, TaskEventType, TaskRunStatus, TaskRuntime, TaskRuntimeError, TaskSpec,
};

struct CrashBeforeStationJournal {
    simulator: SqliteSimulator,
    snapshot_calls: usize,
}

struct CrashBeforeSecondStationJournal {
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

struct CrashOnSnapshot;

struct CrashBeforeRecoveryClear {
    simulator: SqliteSimulator,
}

struct BlockingSimulator {
    simulator: SqliteSimulator,
    entered: Arc<Barrier>,
    release: Arc<Barrier>,
    block_next_snapshot: bool,
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
                lumbar_support_percent: 35,
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
                lumbar_support_percent: 35,
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
        match action {
            DeviceAction::DeskMoveToHeight { height_mm } => {
                self.snapshot.desk_height_mm = *height_mm;
            }
            DeviceAction::ChairSetLumbarSupport { level_percent } => {
                self.snapshot.lumbar_support_percent = *level_percent;
            }
        }
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

    fn prepare_reconciliation(&mut self, command_id: &str) -> Result<(), DeviceError> {
        self.simulator.prepare_reconciliation(command_id)
    }
}

impl DeviceAdapter for CrashBeforeSecondStationJournal {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.snapshot_calls += 1;
        if self.snapshot_calls == 4 {
            panic!("simulated crash before the second station journal write");
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

impl DeviceAdapter for CrashOnSnapshot {
    fn snapshot(&mut self, _observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        panic!("simulated crash after reserving the resume attempt");
    }

    fn apply(
        &mut self,
        _action: &DeviceAction,
        _expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        unreachable!("snapshot must run before apply");
    }
}

impl DeviceAdapter for CrashBeforeRecoveryClear {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.simulator.snapshot(observed_at_ms)
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.simulator.apply(action, expected_state_version)
    }

    fn apply_command(
        &mut self,
        command: &DeviceCommand,
        started_at_ms: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.simulator.apply_command(command, started_at_ms)
    }

    fn desk_motion_progress(
        &self,
        command_id: &str,
    ) -> Result<Vec<DeskMotionProgress>, DeviceError> {
        self.simulator.desk_motion_progress(command_id)
    }

    fn prepare_reconciliation(&mut self, _command_id: &str) -> Result<(), DeviceError> {
        panic!("simulated process crash before clearing the actuator interlock");
    }
}

impl DeviceAdapter for BlockingSimulator {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        if std::mem::take(&mut self.block_next_snapshot) {
            self.entered.wait();
            self.release.wait();
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

    fn apply_command(
        &mut self,
        command: &DeviceCommand,
        started_at_ms: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        self.simulator.apply_command(command, started_at_ms)
    }

    fn desk_motion_progress(
        &self,
        command_id: &str,
    ) -> Result<Vec<DeskMotionProgress>, DeviceError> {
        self.simulator.desk_motion_progress(command_id)
    }

    fn prepare_reconciliation(&mut self, command_id: &str) -> Result<(), DeviceError> {
        self.simulator.prepare_reconciliation(command_id)
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
    let resume_error = first_process
        .resume(&awaiting.run_id, "operator-1", 1_150)
        .unwrap_err();
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
fn actuator_jam_suspends_then_resumes_from_observed_partial_state() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut jammed_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = jammed_process
        .start(
            TaskSpec::prepare_focus_session("task-actuator-jam", "user-1", 820),
            1_000,
        )
        .unwrap();

    let suspended = jammed_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    let partial = jammed_process.station_snapshot(1_150).unwrap();

    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    assert_eq!(
        suspended.suspension_reason,
        Some(SuspensionReason::ActuatorFault)
    );
    assert_eq!(
        suspended.command.as_ref().unwrap().status,
        CommandStatus::Failed
    );
    assert_eq!(
        suspended.command.as_ref().unwrap().failure_reason,
        Some(CommandFailureReason::ActuatorFault)
    );
    assert_eq!(
        suspended
            .desk_motion_progress
            .last()
            .unwrap()
            .progress_percent,
        60
    );
    assert_eq!(partial.desk_height_mm, 780);
    assert_eq!(partial.movement_count, 1);
    drop(jammed_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut recovered = TaskRuntime::open(&database, simulator, authority).unwrap();
    let completed = recovered
        .resume(&awaiting.run_id, "operator-42", 1_200)
        .unwrap();
    let final_snapshot = recovered.station_snapshot(1_250).unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(completed.suspension_reason, None);
    assert_eq!(
        completed.command.as_ref().unwrap().status,
        CommandStatus::Succeeded
    );
    assert_eq!(
        completed.events.last().unwrap().event_type.as_str(),
        "run_resumed"
    );
    let failed_attempt = completed.command_attempts.first().unwrap();
    assert_eq!(failed_attempt.command.status, CommandStatus::Failed);
    assert_eq!(
        failed_attempt.command.failure_reason,
        Some(CommandFailureReason::ActuatorFault)
    );
    assert_eq!(
        failed_attempt
            .desk_motion_progress
            .last()
            .unwrap()
            .progress_percent,
        60
    );
    assert_eq!(final_snapshot.desk_height_mm, 820);
    assert_eq!(final_snapshot.movement_count, 2);
    drop(recovered);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let restarted = TaskRuntime::open(&database, simulator, policy_authority()).unwrap();
    let persisted = restarted.inspect(&awaiting.run_id).unwrap();
    let recovery_attempt = persisted
        .events
        .iter()
        .find(|event| event.event_type == TaskEventType::RunResumeAttempted)
        .unwrap();
    assert_eq!(recovery_attempt.actor_id.as_deref(), Some("operator-42"));
}

#[test]
fn actuator_recovery_actor_is_durable_before_the_interlock_is_cleared() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-audited-recovery-clear", "user-1", 820),
            1_000,
        )
        .unwrap();
    runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();
    drop(runtime);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut crashing = TaskRuntime::open(
        &database,
        CrashBeforeRecoveryClear { simulator },
        authority.clone(),
    )
    .unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        crashing
            .resume(&awaiting.run_id, "operator-42", 1_200)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(crashing);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let persisted = restarted.inspect(&awaiting.run_id).unwrap();
    let recovery_attempts: Vec<_> = persisted
        .events
        .iter()
        .filter(|event| event.event_type == TaskEventType::RunResumeAttempted)
        .collect();
    assert_eq!(recovery_attempts.len(), 1);
    assert_eq!(
        recovery_attempts[0].actor_id.as_deref(),
        Some("operator-42")
    );

    let completed = restarted
        .resume(&awaiting.run_id, "operator-99", 1_300)
        .unwrap();
    assert_eq!(completed.status, TaskRunStatus::Completed);
    let recovery_attempts: Vec<_> = completed
        .events
        .iter()
        .filter(|event| event.event_type == TaskEventType::RunResumeAttempted)
        .collect();
    assert_eq!(recovery_attempts.len(), 1);
    assert_eq!(
        recovery_attempts[0].actor_id.as_deref(),
        Some("operator-42")
    );
}

#[test]
fn expired_actuator_recovery_clears_the_interlock_without_authorizing_more_motion() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut runtime = TaskRuntime::open(&database, simulator, authority).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-expired-actuator-jam", "user-1", 820),
            1_000,
        )
        .unwrap();
    runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();

    let expired = runtime
        .resume(&awaiting.run_id, "operator-1", 61_001)
        .unwrap();
    let after_clear = runtime.station_snapshot(61_002).unwrap();

    assert_eq!(expired.status, TaskRunStatus::Suspended);
    assert_eq!(expired.suspension_reason, Some(SuspensionReason::Expired));
    assert_eq!(expired.command_attempts.len(), 1);
    assert_eq!(after_clear.movement_count, 1);
    assert_eq!(after_clear.desk_height_mm, 780);

    let fresh = runtime
        .start(
            TaskSpec::prepare_focus_session("task-after-expired-jam", "user-1", 800),
            62_000,
        )
        .unwrap();
    let completed = runtime.approve(&fresh.run_id, "user-1", 62_100).unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(runtime.station_snapshot(62_200).unwrap().movement_count, 2);
}

#[test]
fn restart_recovers_actuator_fault_recorded_before_task_suspension_was_saved() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-crash-after-actuator-jam", "user-1", 820),
            1_000,
        )
        .unwrap();
    let fault_connection = rusqlite::Connection::open(&database).unwrap();
    fault_connection
        .execute_batch(
            r#"
            CREATE TRIGGER fail_actuator_suspension_save
            BEFORE UPDATE ON task_runs
            WHEN instr(NEW.stored_json, '"suspensionReason":"actuator_fault"') > 0
            BEGIN
                SELECT RAISE(ABORT, 'simulated crash before actuator suspension save');
            END;
            "#,
        )
        .unwrap();

    assert!(matches!(
        first_process.approve(&awaiting.run_id, "user-1", 1_100),
        Err(TaskRuntimeError::Storage(_))
    ));
    drop(first_process);
    fault_connection
        .execute_batch("DROP TRIGGER fail_actuator_suspension_save;")
        .unwrap();
    drop(fault_connection);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let suspended = restarted.reconcile(&awaiting.run_id, 1_200).unwrap();

    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    assert_eq!(
        suspended.suspension_reason,
        Some(SuspensionReason::ActuatorFault)
    );
    assert_eq!(suspended.command_attempts.len(), 1);
    assert_eq!(restarted.station_snapshot(1_201).unwrap().movement_count, 1);

    let completed = restarted
        .resume(&awaiting.run_id, "operator-1", 1_300)
        .unwrap();
    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(completed.command_attempts.len(), 1);
    assert_eq!(restarted.station_snapshot(1_301).unwrap().movement_count, 2);
}

#[test]
fn concurrent_actuator_recovery_dispatches_only_one_replacement_command() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut jammed_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = jammed_process
        .start(
            TaskSpec::prepare_focus_session("task-concurrent-actuator-jam", "user-1", 820),
            1_000,
        )
        .unwrap();
    let suspended = jammed_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    drop(jammed_process);

    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let blocked_database = database.clone();
    let blocked_run_id = awaiting.run_id.clone();
    let blocked_entered = Arc::clone(&entered);
    let blocked_release = Arc::clone(&release);
    let blocked_resume = thread::spawn(move || {
        let simulator = SqliteSimulator::open(&blocked_database).unwrap();
        let device = BlockingSimulator {
            simulator,
            entered: blocked_entered,
            release: blocked_release,
            block_next_snapshot: true,
        };
        let mut runtime = TaskRuntime::open(&blocked_database, device, policy_authority()).unwrap();
        runtime
            .resume(&blocked_run_id, "operator-1", 1_200)
            .unwrap()
    });
    entered.wait();

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut concurrent = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let completed = concurrent
        .resume(&awaiting.run_id, "operator-1", 1_250)
        .unwrap();
    assert_eq!(completed.status, TaskRunStatus::Completed);

    release.wait();
    let blocked_result = blocked_resume.join().unwrap();
    assert_eq!(blocked_result.status, TaskRunStatus::Completed);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut inspected = TaskRuntime::open(&database, simulator, authority).unwrap();
    let final_run = inspected.inspect(&awaiting.run_id).unwrap();
    assert_eq!(final_run.status, TaskRunStatus::Completed);
    assert_eq!(
        final_run
            .events
            .iter()
            .filter(|event| event.event_type == TaskEventType::RunResumeAttempted)
            .count(),
        1
    );
    assert_eq!(inspected.station_snapshot(1_300).unwrap().movement_count, 2);
}

#[test]
fn three_recovery_jams_retain_the_initial_attempt_plus_the_full_recovery_budget() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-repeated-actuator-jam", "user-1", 820),
            1_000,
        )
        .unwrap();
    let initial_jam = runtime.approve(&awaiting.run_id, "user-1", 1_100).unwrap();
    assert_eq!(initial_jam.command_attempts.len(), 1);

    for recovery_attempt in 1..=3 {
        drop(runtime);
        let mut simulator = SqliteSimulator::open(&database).unwrap();
        simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
        runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
        let suspended = runtime
            .resume(
                &awaiting.run_id,
                "operator-1",
                1_100 + recovery_attempt * 100,
            )
            .unwrap();

        assert_eq!(suspended.status, TaskRunStatus::Suspended);
        assert_eq!(
            suspended.suspension_reason,
            Some(SuspensionReason::ActuatorFault)
        );
        assert_eq!(
            suspended.command_attempts.len(),
            usize::try_from(recovery_attempt + 1).unwrap()
        );
    }

    let exhausted = runtime
        .resume(&awaiting.run_id, "operator-1", 1_500)
        .unwrap_err();
    assert!(matches!(
        exhausted,
        TaskRuntimeError::RecoveryBudgetExhausted {
            max_attempts: 3,
            ..
        }
    ));
    assert_eq!(runtime.station_snapshot(1_501).unwrap().movement_count, 4);
}

#[test]
fn restart_dispatches_a_durably_reserved_actuator_recovery() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::ActuatorJamAtPercent(60));
    let mut jammed_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = jammed_process
        .start(
            TaskSpec::prepare_focus_session("task-crashed-actuator-recovery", "user-1", 820),
            1_000,
        )
        .unwrap();
    let suspended = jammed_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    drop(jammed_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let mut crashing_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        crashing_process
            .resume(&awaiting.run_id, "operator-1", 1_200)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(crashing_process);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let reserved = restarted.inspect(&awaiting.run_id).unwrap();
    assert_eq!(reserved.status, TaskRunStatus::Executing);
    assert!(reserved
        .events
        .iter()
        .any(|event| event.event_type == TaskEventType::RunResumeAttempted));

    let completed = restarted.reconcile(&awaiting.run_id, 1_300).unwrap();
    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(
        completed.events.last().unwrap().event_type,
        TaskEventType::RunReconciled
    );
    assert_eq!(restarted.station_snapshot(1_350).unwrap().movement_count, 2);
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
    let completed = recovered_process
        .resume(&awaiting.run_id, "operator-1", 1_200)
        .unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(completed.suspension_reason, None);
    assert_eq!(
        completed.events.last().unwrap().event_type.as_str(),
        "run_resumed"
    );
    let replayed = recovered_process
        .resume(&awaiting.run_id, "operator-1", 1_225)
        .unwrap();
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
fn resume_attempts_are_persisted_and_bounded_across_restarts() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-bounded-resume", "user-1", 795),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut unavailable_process =
        TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let suspended = unavailable_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    assert_eq!(suspended.status, TaskRunStatus::Suspended);
    drop(unavailable_process);

    let mut crashing_process =
        TaskRuntime::open(&database, CrashOnSnapshot, authority.clone()).unwrap();
    let crashed = catch_unwind(AssertUnwindSafe(|| {
        crashing_process
            .resume(&awaiting.run_id, "operator-1", 1_200)
            .unwrap();
    }));
    assert!(crashed.is_err());
    drop(crashing_process);
    let simulator = SqliteSimulator::open(&database).unwrap();
    let persisted = TaskRuntime::open(&database, simulator, authority.clone())
        .unwrap()
        .inspect(&awaiting.run_id)
        .unwrap();
    assert_eq!(
        persisted
            .events
            .iter()
            .filter(|event| event.event_type.as_str() == "run_resume_attempted")
            .count(),
        1
    );

    for attempt in 2..=3 {
        let mut simulator = SqliteSimulator::open(&database).unwrap();
        simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
        let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();

        let still_suspended = runtime
            .resume(&awaiting.run_id, "operator-1", 1_100 + attempt * 100)
            .unwrap();

        assert_eq!(still_suspended.status, TaskRunStatus::Suspended);
        assert_eq!(
            still_suspended
                .events
                .iter()
                .filter(|event| event.event_type.as_str() == "run_resume_attempted")
                .count(),
            attempt as usize
        );
    }

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut exhausted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let error = exhausted
        .resume(&awaiting.run_id, "operator-1", 1_500)
        .unwrap_err();

    assert!(matches!(
        error,
        TaskRuntimeError::RecoveryBudgetExhausted {
            max_attempts: 3,
            ..
        }
    ));
    assert_eq!(exhausted.station_snapshot(1_501).unwrap().movement_count, 0);
}

#[test]
fn concurrent_resume_completion_preserves_later_attempt_reservations() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-concurrent-resume", "user-1", 795),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut unavailable_process =
        TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    unavailable_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    drop(unavailable_process);

    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let blocked_database = database.clone();
    let blocked_run_id = awaiting.run_id.clone();
    let blocked_entered = Arc::clone(&entered);
    let blocked_release = Arc::clone(&release);
    let blocked_resume = thread::spawn(move || {
        let simulator = SqliteSimulator::open(&blocked_database).unwrap();
        let device = BlockingSimulator {
            simulator,
            entered: blocked_entered,
            release: blocked_release,
            block_next_snapshot: true,
        };
        let mut runtime = TaskRuntime::open(&blocked_database, device, policy_authority()).unwrap();
        runtime
            .resume(&blocked_run_id, "operator-1", 1_200)
            .unwrap()
    });
    entered.wait();

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut concurrent = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let still_suspended = concurrent
        .resume(&awaiting.run_id, "operator-2", 1_250)
        .unwrap();
    assert_eq!(still_suspended.status, TaskRunStatus::Suspended);
    drop(concurrent);

    release.wait();
    let completed = blocked_resume.join().unwrap();
    assert_eq!(completed.status, TaskRunStatus::Completed);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut inspected = TaskRuntime::open(&database, simulator, authority).unwrap();
    let final_run = inspected.inspect(&awaiting.run_id).unwrap();
    assert_eq!(
        final_run
            .events
            .iter()
            .filter(|event| event.event_type.as_str() == "run_resume_attempted")
            .count(),
        2
    );
    assert_eq!(inspected.station_snapshot(1_300).unwrap().movement_count, 1);
}

#[test]
fn terminal_station_replay_after_task_save_failure_does_not_consume_an_attempt() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = policy_authority();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut first_process = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::prepare_focus_session("task-terminal-resume-replay", "user-1", 795),
            1_000,
        )
        .unwrap();
    drop(first_process);

    let mut simulator = SqliteSimulator::open(&database).unwrap();
    simulator.set_next_fault(NextFault::DeviceUnavailableBeforeDispatch);
    let mut unavailable_process =
        TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    unavailable_process
        .approve(&awaiting.run_id, "user-1", 1_100)
        .unwrap();
    drop(unavailable_process);

    let fault_connection = rusqlite::Connection::open(&database).unwrap();
    fault_connection
        .execute_batch(
            r#"
            CREATE TRIGGER fail_resumed_task_save
            BEFORE UPDATE ON task_runs
            WHEN instr(NEW.stored_json, '"status":"completed"') > 0
            BEGIN
                SELECT RAISE(ABORT, 'simulated crash before resumed task result save');
            END;
            "#,
        )
        .unwrap();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut failed_save = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    assert!(matches!(
        failed_save.resume(&awaiting.run_id, "operator-1", 1_200),
        Err(TaskRuntimeError::Storage(_))
    ));
    drop(failed_save);
    fault_connection
        .execute_batch("DROP TRIGGER fail_resumed_task_save;")
        .unwrap();
    drop(fault_connection);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let completed = restarted
        .resume(&awaiting.run_id, "operator-1", 1_300)
        .unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(
        completed
            .events
            .iter()
            .filter(|event| event.event_type.as_str() == "run_resume_attempted")
            .count(),
        1
    );
    assert_eq!(restarted.station_snapshot(1_301).unwrap().movement_count, 1);
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
fn restart_executes_only_the_remaining_profile_step_after_a_mid_run_crash() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let crashing_device = CrashBeforeSecondStationJournal {
        simulator,
        snapshot_calls: 0,
    };
    let authority = policy_authority();
    let mut first_process =
        TaskRuntime::open(&database, crashing_device, authority.clone()).unwrap();
    let awaiting = first_process
        .start(
            TaskSpec::restore_profile("task-profile-mid-run-crash", "user-1", 780, 65),
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
    let interrupted = restarted.inspect(&awaiting.run_id).unwrap();
    assert_eq!(interrupted.status, TaskRunStatus::Executing);
    assert_eq!(interrupted.completed_steps.len(), 1);

    let completed = restarted.reconcile(&awaiting.run_id, 1_200).unwrap();
    let snapshot = restarted.station_snapshot(1_201).unwrap();

    assert_eq!(completed.status, TaskRunStatus::Completed);
    assert_eq!(completed.completed_steps.len(), 2);
    assert_eq!(snapshot.desk_height_mm, 780);
    assert_eq!(snapshot.lumbar_support_percent, 65);
    assert_eq!(snapshot.movement_count, 2);
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
    let resume_error = restarted
        .resume(&awaiting.run_id, "operator-1", 1_202)
        .unwrap_err();
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
    let resume_error = restarted
        .resume(&awaiting.run_id, "operator-1", 70_002)
        .unwrap_err();
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
