use ergopilot_protocol::{
    ChairErgonomics, CommandStatus, CommandView, DeviceAction, DeviceCommand, LightConfiguration,
    PolicyGrant, ReminderConfiguration, WorkstationSnapshot, SCHEMA_VERSION,
};
use policy_core::{GrantRequest, PolicyAuthority, PolicyError};
use station_core::{DeviceAdapter, DeviceError, DeviceExecution, RuntimeError, StationRuntime};

struct TestDevice {
    snapshot: WorkstationSnapshot,
    fail_before_effect: bool,
}

impl TestDevice {
    fn new() -> Self {
        Self {
            snapshot: WorkstationSnapshot {
                schema_version: SCHEMA_VERSION,
                station_id: "station-test".into(),
                state_version: 108,
                observed_at_ms: 0,
                desk_height_mm: 720,
                lumbar_support_percent: 35,
                movement_count: 0,
                ..WorkstationSnapshot::default()
            },
            fail_before_effect: false,
        }
    }

    fn unavailable() -> Self {
        Self {
            fail_before_effect: true,
            ..Self::new()
        }
    }
}

impl DeviceAdapter for TestDevice {
    fn snapshot(&mut self, observed_at_ms: u64) -> Result<WorkstationSnapshot, DeviceError> {
        self.snapshot.observed_at_ms = observed_at_ms;
        Ok(self.snapshot.clone())
    }

    fn apply(
        &mut self,
        action: &DeviceAction,
        expected_state_version: u64,
    ) -> Result<DeviceExecution, DeviceError> {
        if self.fail_before_effect {
            return Err(DeviceError::new("device is unavailable before dispatch"));
        }
        if self.snapshot.state_version != expected_state_version {
            return Err(DeviceError::new("state version changed before effect"));
        }
        apply_action(&mut self.snapshot, action);
        self.snapshot.state_version += 1;
        self.snapshot.movement_count += 1;
        Ok(DeviceExecution::Reported)
    }
}

struct ReadbackFailureDevice {
    snapshot: WorkstationSnapshot,
    fail_next_snapshot: bool,
}

impl ReadbackFailureDevice {
    fn new() -> Self {
        Self {
            snapshot: TestDevice::new().snapshot,
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
        apply_action(&mut self.snapshot, action);
        self.snapshot.state_version += 1;
        self.snapshot.movement_count += 1;
        self.fail_next_snapshot = true;
        Ok(DeviceExecution::Reported)
    }
}

fn apply_action(snapshot: &mut WorkstationSnapshot, action: &DeviceAction) {
    match action {
        DeviceAction::DeskMoveToHeight { height_mm } => {
            snapshot.desk_height_mm = *height_mm;
        }
        DeviceAction::ChairSetLumbarSupport { level_percent } => {
            snapshot.lumbar_support_percent = *level_percent;
        }
        DeviceAction::ChairAdjustErgonomics(configuration) => {
            snapshot.seat_height_mm = configuration.seat_height_mm;
            snapshot.seat_depth_mm = configuration.seat_depth_mm;
            snapshot.lumbar_support_percent = configuration.lumbar_support_percent;
            snapshot.armrest_height_mm = configuration.armrest_height_mm;
            snapshot.armrest_depth_mm = configuration.armrest_depth_mm;
            snapshot.armrest_width_mm = configuration.armrest_width_mm;
            snapshot.armrest_angle_deg = configuration.armrest_angle_deg;
            snapshot.recline_angle_deg = configuration.recline_angle_deg;
            snapshot.recline_resistance_percent = configuration.recline_resistance_percent;
            snapshot.recline_locked = configuration.recline_locked;
            snapshot.headrest_height_mm = configuration.headrest_height_mm;
            snapshot.headrest_angle_deg = configuration.headrest_angle_deg;
        }
        DeviceAction::LightConfigure(configuration) => {
            snapshot.light_brightness_percent = configuration.brightness_percent;
            snapshot.light_color_temperature_k = configuration.color_temperature_k;
        }
        DeviceAction::ReminderConfigure(configuration) => {
            snapshot.reminder_enabled = configuration.enabled;
            snapshot.reminder_interval_minutes = configuration.interval_minutes;
        }
    }
}

fn desk_command() -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-desk-42".into(),
        task_run_id: "run-focus-17".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 108,
        idempotency_key: "run-focus-17:desk:step-2".into(),
        expires_at_ms: 2_000,
        trace_id: "trace-1".into(),
        policy_grant_id: "grant-once-9".into(),
    }
}

fn test_runtime<D: DeviceAdapter>(device: D) -> StationRuntime<D> {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    StationRuntime::in_memory(device, authority.verifier()).unwrap()
}

fn grant_for(command: &DeviceCommand, now_ms: u64) -> PolicyGrant {
    PolicyAuthority::new(b"ergopilot-test-policy-key")
        .unwrap()
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: now_ms,
            expires_at_ms: now_ms + 100_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap()
}

fn execute<D: DeviceAdapter>(
    runtime: &mut StationRuntime<D>,
    command: DeviceCommand,
    now_ms: u64,
) -> Result<CommandView, RuntimeError> {
    let grant = grant_for(&command, now_ms);
    runtime.execute(command, &grant, now_ms)
}

#[test]
fn desk_move_is_successful_only_after_the_observed_height_matches() {
    let mut runtime = test_runtime(TestDevice::new());

    let result = execute(&mut runtime, desk_command(), 1_000).unwrap();

    assert_eq!(result.status, CommandStatus::Succeeded);
    assert_eq!(result.outcome.unwrap().desk_height_mm, 760);
    assert_eq!(runtime.snapshot(1_001).unwrap().desk_height_mm, 760);
}

#[test]
fn duplicate_delivery_replays_the_existing_result_without_moving_again() {
    let mut runtime = test_runtime(TestDevice::new());
    let command = desk_command();

    let first = execute(&mut runtime, command.clone(), 1_000).unwrap();
    let replay = execute(&mut runtime, command, 1_100).unwrap();

    assert_eq!(first.status, CommandStatus::Succeeded);
    assert_eq!(replay.status, CommandStatus::Succeeded);
    assert!(replay.was_replayed);
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 1);
}

#[test]
fn exact_replay_returns_the_stored_result_after_authorization_expires() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = StationRuntime::in_memory(TestDevice::new(), authority.verifier()).unwrap();
    let mut command = desk_command();
    command.expires_at_ms = 1_100;
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 900,
            expires_at_ms: 1_100,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();

    runtime.execute(command.clone(), &grant, 1_000).unwrap();
    let replay = runtime.execute(command, &grant, 1_200).unwrap();

    assert_eq!(replay.status, CommandStatus::Succeeded);
    assert!(replay.was_replayed);
    assert_eq!(runtime.snapshot(1_201).unwrap().movement_count, 1);
}

#[test]
fn command_based_on_a_stale_snapshot_is_rejected_before_the_device_moves() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.expected_state_version = 107;

    let error = execute(&mut runtime, command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::StaleState {
            expected: 107,
            actual: 108
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn reusing_an_idempotency_key_for_a_different_intent_is_rejected() {
    let mut runtime = test_runtime(TestDevice::new());
    execute(&mut runtime, desk_command(), 1_000).unwrap();
    let mut conflicting = desk_command();
    conflicting.command_id = "cmd-desk-43".into();
    conflicting.action = DeviceAction::DeskMoveToHeight { height_mm: 800 };

    let error = execute(&mut runtime, conflicting, 1_100).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::IdempotencyConflict { ref key }
            if key == "run-focus-17:desk:step-2"
    ));
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 1);
}

#[test]
fn desk_height_outside_the_device_envelope_is_rejected() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.action = DeviceAction::DeskMoveToHeight { height_mm: 1_400 };

    let error = execute(&mut runtime, command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::UnsafeDeskHeight {
            requested: 1_400,
            min: 620,
            max: 1_280
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn lumbar_support_outside_the_device_envelope_is_rejected() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.action = DeviceAction::ChairSetLumbarSupport { level_percent: 101 };
    let grant = grant_for(&command, 900);

    let error = runtime.execute(command, &grant, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::UnsafeLumbarSupport {
            requested: 101,
            min: 0,
            max: 100
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn complete_workstation_actions_outside_the_device_envelope_are_rejected() {
    let mut chair = valid_chair();
    chair.recline_angle_deg = 109;
    let actions = [
        DeviceAction::ChairAdjustErgonomics(chair),
        DeviceAction::LightConfigure(LightConfiguration {
            brightness_percent: 101,
            color_temperature_k: 4_300,
        }),
        DeviceAction::ReminderConfigure(ReminderConfiguration {
            enabled: true,
            interval_minutes: 181,
        }),
    ];

    for action in actions {
        let mut runtime = test_runtime(TestDevice::new());
        let mut command = desk_command();
        let capability_id = action.capability_id();
        command.action = action;
        let grant = grant_for(&command, 900);

        let error = runtime.execute(command, &grant, 1_000).unwrap_err();

        assert!(matches!(
            error,
            RuntimeError::UnsafeActionConfiguration {
                capability_id: ref actual
            } if *actual == capability_id
        ));
        assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
    }
}

fn valid_chair() -> ChairErgonomics {
    ChairErgonomics {
        seat_height_mm: 470,
        seat_depth_mm: 450,
        lumbar_support_percent: 50,
        armrest_height_mm: 240,
        armrest_depth_mm: 0,
        armrest_width_mm: 480,
        armrest_angle_deg: 0,
        recline_angle_deg: 110,
        recline_resistance_percent: 55,
        recline_locked: true,
        headrest_height_mm: 50,
        headrest_angle_deg: 0,
    }
}

#[test]
fn command_that_arrives_after_its_expiry_is_rejected() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.expires_at_ms = 999;

    let error = execute(&mut runtime, command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::ExpiredCommand {
            expires_at_ms: 999,
            now_ms: 1_000
        }
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn successful_command_exposes_an_ordered_observable_timeline() {
    let mut runtime = test_runtime(TestDevice::new());
    execute(&mut runtime, desk_command(), 1_000).unwrap();

    let events = runtime.events("cmd-desk-42").unwrap();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();

    assert_eq!(event_types, ["accepted", "executing", "verified_succeeded"]);
    assert!(events
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
}

#[test]
fn action_without_a_policy_grant_is_rejected_locally() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.policy_grant_id.clear();

    let error = execute(&mut runtime, command, 1_000).unwrap_err();

    assert!(matches!(error, RuntimeError::MissingPolicyGrant));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn unsupported_command_schema_is_rejected_before_the_device_moves() {
    let mut runtime = test_runtime(TestDevice::new());
    let mut command = desk_command();
    command.schema_version = SCHEMA_VERSION + 1;

    let error = execute(&mut runtime, command, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::UnsupportedSchemaVersion {
            expected: SCHEMA_VERSION,
            actual
        } if actual == SCHEMA_VERSION + 1
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}

#[test]
fn definite_device_failure_becomes_terminal_and_observable() {
    let mut runtime = test_runtime(TestDevice::unavailable());
    let command = desk_command();

    let error = execute(&mut runtime, command.clone(), 1_000).unwrap_err();
    assert!(matches!(error, RuntimeError::Device(_)));

    let events = runtime.events(&command.command_id).unwrap();
    let event_types: Vec<_> = events
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(event_types, ["accepted", "executing", "execution_failed"]);

    let replay = execute(&mut runtime, command, 1_100).unwrap();
    assert_eq!(replay.status, CommandStatus::Failed);
    assert!(replay.was_replayed);
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 0);
}

#[test]
fn failed_post_effect_readback_is_recorded_as_uncertain_then_reconciled() {
    let mut runtime = test_runtime(ReadbackFailureDevice::new());
    let command = desk_command();

    let error = execute(&mut runtime, command.clone(), 1_000).unwrap_err();
    assert!(matches!(error, RuntimeError::Device(_)));

    let replay = execute(&mut runtime, command.clone(), 1_050).unwrap();
    assert_eq!(replay.status, CommandStatus::OutcomeUnknown);
    let recovered = runtime.reconcile_pending(1_100).unwrap();
    assert_eq!(recovered[0].status, CommandStatus::Succeeded);
    assert_eq!(runtime.snapshot(1_101).unwrap().movement_count, 1);

    let event_types: Vec<_> = runtime
        .events(&command.command_id)
        .unwrap()
        .iter()
        .map(|event| event.event_type.as_str())
        .collect();
    assert_eq!(
        event_types,
        [
            "accepted",
            "executing",
            "outcome_unknown",
            "reconciled_succeeded"
        ]
    );
}

#[test]
fn expired_signed_grant_is_rejected_before_the_device_moves() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = StationRuntime::in_memory(TestDevice::new(), authority.verifier()).unwrap();
    let command = desk_command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 900,
            expires_at_ms: 1_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();

    let error = runtime.execute(command, &grant, 1_000).unwrap_err();

    assert!(matches!(
        error,
        RuntimeError::Policy(PolicyError::Expired {
            expires_at_ms: 1_000,
            now_ms: 1_000
        })
    ));
    assert_eq!(runtime.snapshot(1_001).unwrap().movement_count, 0);
}
