use ergopilot_protocol::{
    CommandEvent, CommandEventType, DeviceAction, DeviceCommand, PolicyGrant, SCHEMA_VERSION,
};
use serde_json::json;

#[test]
fn device_command_has_a_stable_cross_runtime_json_contract() {
    let command = DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-1".into(),
        task_run_id: "run-1".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 8,
        idempotency_key: "run-1:desk:step-1".into(),
        expires_at_ms: 20_000,
        trace_id: "trace-1".into(),
        policy_grant_id: "grant-1".into(),
    };

    let json_value = serde_json::to_value(&command).unwrap();

    assert_eq!(
        json_value,
        json!({
            "schemaVersion": 1,
            "commandId": "cmd-1",
            "taskRunId": "run-1",
            "action": {
                "type": "desk.move_to_height",
                "input": { "heightMm": 760 }
            },
            "expectedStateVersion": 8,
            "idempotencyKey": "run-1:desk:step-1",
            "expiresAtMs": 20_000,
            "traceId": "trace-1",
            "policyGrantId": "grant-1"
        })
    );
    assert_eq!(
        serde_json::from_value::<DeviceCommand>(json_value).unwrap(),
        command
    );
}

#[test]
fn chair_lumbar_action_has_a_stable_cross_runtime_json_contract() {
    let action = DeviceAction::ChairSetLumbarSupport { level_percent: 65 };

    let json_value = serde_json::to_value(&action).unwrap();

    assert_eq!(
        json_value,
        json!({
            "type": "chair.set_lumbar_support",
            "input": { "levelPercent": 65 }
        })
    );
    assert_eq!(
        serde_json::from_value::<DeviceAction>(json_value).unwrap(),
        action
    );
}

#[test]
fn signed_policy_grant_has_a_stable_json_contract() {
    let grant = PolicyGrant {
        schema_version: SCHEMA_VERSION,
        grant_id: "grant-1".into(),
        task_run_id: "run-1".into(),
        command_id: "cmd-1".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 8,
        issued_at_ms: 1_000,
        expires_at_ms: 2_000,
        rule_ids: vec!["desk.motion.requires_approval".into()],
        signature: "signed-hex".into(),
    };

    let json_value = serde_json::to_value(&grant).unwrap();

    assert_eq!(json_value["grantId"], "grant-1");
    assert_eq!(json_value["taskRunId"], "run-1");
    assert_eq!(json_value["commandId"], "cmd-1");
    assert_eq!(json_value["action"]["input"]["heightMm"], 760);
    assert_eq!(json_value["expectedStateVersion"], 8);
    assert_eq!(json_value["expiresAtMs"], 2_000);
    assert_eq!(json_value["ruleIds"][0], "desk.motion.requires_approval");
    assert_eq!(
        serde_json::from_value::<PolicyGrant>(json_value).unwrap(),
        grant
    );
}

#[test]
fn command_event_type_is_a_closed_versioned_value() {
    let event = CommandEvent {
        sequence: 7,
        command_id: "cmd-1".into(),
        event_type: CommandEventType::OutcomeUnknown,
        at_ms: 2_100,
    };

    let json_value = serde_json::to_value(&event).unwrap();

    assert_eq!(
        json_value,
        json!({
            "sequence": 7,
            "commandId": "cmd-1",
            "eventType": "outcome_unknown",
            "atMs": 2_100
        })
    );
    assert_eq!(
        serde_json::from_value::<CommandEvent>(json_value).unwrap(),
        event
    );
}
