use device_sim::SqliteSimulator;
use policy_core::PolicyAuthority;
use task_runtime::{TaskGoal, TaskRuntime, TaskSpec};

#[test]
fn task_run_view_is_ready_for_a_typescript_timeline_consumer() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let simulator = SqliteSimulator::open(&database).unwrap();
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority).unwrap();

    let run = runtime
        .start(
            TaskSpec {
                task_id: "task-json-1".into(),
                requested_by: "user-1".into(),
                goal: TaskGoal::PrepareFocusSession {
                    desk_height_mm: 760,
                },
            },
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
