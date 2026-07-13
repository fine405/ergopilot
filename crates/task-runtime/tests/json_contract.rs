use device_sim::SqliteSimulator;
use ergopilot_protocol::{DeviceAction, SCHEMA_VERSION};
use policy_core::PolicyAuthority;
use rusqlite::{params, Connection};
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

    let awaiting = runtime
        .start(
            TaskSpec::prepare_focus_session("task-json-1", "user-1", 760),
            1_000,
        )
        .unwrap();
    let awaiting_json = serde_json::to_value(awaiting).unwrap();

    assert_eq!(awaiting_json["status"], "awaiting_approval");
    assert_eq!(awaiting_json["suspensionReason"], serde_json::Value::Null);
    assert_eq!(awaiting_json["task"]["goal"], "prepare_focus_session");
    assert_eq!(awaiting_json["task"]["steps"][0]["stepId"], "desk-1");
    assert_eq!(
        awaiting_json["task"]["steps"][0]["action"]["input"]["heightMm"],
        760
    );
    assert_eq!(awaiting_json["approval"]["status"], "pending");
    assert_eq!(
        awaiting_json["policyDecision"]["outcome"],
        "require_approval"
    );
    assert_eq!(awaiting_json["events"][0]["eventType"], "run_started");
    assert_eq!(awaiting_json["events"][1]["eventType"], "approval_required");

    let completed = runtime.approve("run-task-json-1", "user-1", 1_100).unwrap();
    let completed_json = serde_json::to_value(completed).unwrap();
    assert_eq!(completed_json["commandEvents"][0]["eventType"], "accepted");
    assert_eq!(
        completed_json["commandEvents"][2]["eventType"],
        "verified_succeeded"
    );
    assert_eq!(completed_json["completedSteps"][0]["stepId"], "desk-1");
}

#[test]
fn task_runtime_reads_and_upgrades_the_previous_stored_run_shape() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let spec = TaskSpec::prepare_focus_session("task-legacy-json", "user-1", 780);
    let simulator = SqliteSimulator::open(&database).unwrap();
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    runtime.start(spec.clone(), 1_000).unwrap();
    drop(runtime);

    let connection = Connection::open(&database).unwrap();
    let stored_json: String = connection
        .query_row(
            "SELECT stored_json FROM task_runs WHERE run_id = ?1",
            params!["run-task-legacy-json"],
            |row| row.get(0),
        )
        .unwrap();
    let mut legacy: serde_json::Value = serde_json::from_str(&stored_json).unwrap();
    let view = legacy["view"].as_object_mut().unwrap();
    let legacy_spec = view.remove("task").unwrap();
    view.remove("commandEvents");
    view.remove("completedSteps");
    view.remove("suspensionReason");
    legacy.as_object_mut().unwrap().remove("currentStepIndex");
    legacy
        .as_object_mut()
        .unwrap()
        .insert("spec".into(), legacy_spec);
    connection
        .execute(
            "UPDATE task_runs SET stored_json = ?1 WHERE run_id = ?2",
            params![legacy.to_string(), "run-task-legacy-json"],
        )
        .unwrap();
    drop(connection);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let inspected = restarted.inspect("run-task-legacy-json").unwrap();
    assert_eq!(inspected.task, spec);
    assert_eq!(inspected.suspension_reason, None);
    let completed = restarted
        .approve("run-task-legacy-json", "user-1", 1_100)
        .unwrap();
    assert_eq!(completed.status, task_runtime::TaskRunStatus::Completed);
}
