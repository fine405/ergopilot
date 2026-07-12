use device_sim::SqliteSimulator;
use ergopilot_protocol::{DeviceAction, SCHEMA_VERSION};
use policy_core::PolicyAuthority;
use serde_json::json;
use task_runtime::{
    InterruptionPolicy, PlannedStep, TaskConstraints, TaskGoal, TaskRuntime, TaskSpec,
};

#[test]
fn task_spec_has_the_planner_to_runtime_json_contract() {
    let spec = TaskSpec {
        schema_version: SCHEMA_VERSION,
        task_id: "task-json-contract".into(),
        goal: TaskGoal::PrepareFocusSession,
        requested_by: "user-1".into(),
        constraints: TaskConstraints {
            duration_minutes: Some(45),
            interruption_policy: Some(InterruptionPolicy::CriticalOnly),
        },
        assumptions: vec!["desk area is clear".into()],
        steps: vec![PlannedStep {
            step_id: "desk-1".into(),
            action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        }],
    };

    let json_value = serde_json::to_value(&spec).unwrap();

    assert_eq!(
        json_value,
        json!({
            "schemaVersion": 1,
            "taskId": "task-json-contract",
            "goal": "prepare_focus_session",
            "requestedBy": "user-1",
            "constraints": {
                "durationMinutes": 45,
                "interruptionPolicy": "critical-only"
            },
            "assumptions": ["desk area is clear"],
            "steps": [{
                "stepId": "desk-1",
                "action": {
                    "type": "desk.move_to_height",
                    "input": { "heightMm": 760 }
                }
            }]
        })
    );
    assert_eq!(
        serde_json::from_value::<TaskSpec>(json_value).unwrap(),
        spec
    );
}

#[test]
fn task_run_view_is_ready_for_a_typescript_timeline_consumer() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority).unwrap();

    let run = runtime
        .start(
            TaskSpec::prepare_focus_session("task-json-1", "user-1", 760),
            1_000,
        )
        .unwrap();
    let json = serde_json::to_value(run).unwrap();

    assert_eq!(json["status"], "awaiting_approval");
    assert_eq!(json["approval"]["status"], "pending");
    assert_eq!(json["policyDecision"]["outcome"], "require_approval");
    assert_eq!(json["events"][0]["eventType"], "run_started");
    assert_eq!(json["events"][1]["eventType"], "approval_required");
}
