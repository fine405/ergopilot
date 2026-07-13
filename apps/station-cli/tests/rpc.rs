use policy_core::PolicyAuthority;
use serde_json::{json, Value};
use station_cli::{run_rpc, DemoError, RpcRequest, MAX_RPC_INPUT_BYTES};
use station_core::{DeviceError, RuntimeError};
use std::{
    io::{self, Write},
    process::{Command, Stdio},
};
use task_runtime::{TaskRuntimeError, TaskSpec};

#[test]
fn rpc_request_has_a_stable_cross_process_json_contract() {
    let request = serde_json::from_value::<RpcRequest>(json!({
        "method": "task.approve",
        "params": {
            "runId": "run-task-rpc-1",
            "approvedBy": "user-1",
            "nowMs": 1_100
        }
    }))
    .unwrap();

    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({
            "method": "task.approve",
            "params": {
                "runId": "run-task-rpc-1",
                "approvedBy": "user-1",
                "nowMs": 1_100
            }
        })
    );
}

#[test]
fn resume_request_has_a_stable_cross_process_json_contract() {
    let request = serde_json::from_value::<RpcRequest>(json!({
        "method": "task.resume",
        "params": {
            "runId": "run-task-rpc-1",
            "nowMs": 1_200
        }
    }))
    .unwrap();

    assert_eq!(
        serde_json::to_value(request).unwrap(),
        json!({
            "method": "task.resume",
            "params": {
                "runId": "run-task-rpc-1",
                "nowMs": 1_200
            }
        })
    );
}

#[test]
fn rpc_error_codes_cover_transition_availability_and_fallback_categories() {
    assert_eq!(
        DemoError::Task(TaskRuntimeError::RunNotApprovable {
            run_id: "run-denied".into(),
        })
        .rpc_code(),
        "invalid_transition"
    );
    assert_eq!(
        DemoError::Task(TaskRuntimeError::PendingCommandNotFound {
            run_id: "run-suspended".into(),
        })
        .rpc_code(),
        "invalid_transition"
    );
    assert_eq!(
        DemoError::Task(TaskRuntimeError::RecoveryBudgetExhausted {
            run_id: "run-suspended".into(),
            max_attempts: 3,
        })
        .rpc_code(),
        "recovery_budget_exhausted"
    );
    assert_eq!(
        DemoError::Task(TaskRuntimeError::Station(RuntimeError::Device(
            DeviceError::unavailable("device is offline"),
        )))
        .rpc_code(),
        "device_unavailable"
    );
    assert_eq!(
        DemoError::Io(io::Error::other("unexpected I/O failure")).rpc_code(),
        "station_rpc_error"
    );
}

#[test]
fn independent_rpc_calls_share_the_durable_task_runtime() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let task = TaskSpec::prepare_focus_session("task-rpc-1", "user-1", 780);

    let started = invoke(
        &database,
        &authority,
        RpcRequest::StartTask {
            task,
            now_ms: 1_000,
        },
    );
    assert_eq!(started["result"]["status"], "awaiting_approval");
    let run_id = started["result"]["runId"].as_str().unwrap();

    let inspected = invoke(
        &database,
        &authority,
        RpcRequest::InspectTask {
            run_id: run_id.into(),
        },
    );
    assert_eq!(inspected["result"]["runId"], run_id);

    let approved = invoke(
        &database,
        &authority,
        RpcRequest::ApproveTask {
            run_id: run_id.into(),
            approved_by: "user-1".into(),
            now_ms: 1_100,
        },
    );
    assert_eq!(approved["result"]["status"], "completed");

    let snapshot = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_200,
        },
    );
    assert_eq!(snapshot["result"]["deskHeightMm"], 780);
    assert_eq!(snapshot["result"]["movementCount"], 1);
}

#[test]
fn demo_ack_loss_rpc_reconciles_without_repeating_the_effect() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let task = TaskSpec::prepare_focus_session("task-rpc-ack-loss", "user-1", 790);

    let started = invoke(
        &database,
        &authority,
        RpcRequest::StartTask {
            task,
            now_ms: 1_000,
        },
    );
    let run_id = started["result"]["runId"].as_str().unwrap();

    let uncertain = invoke(
        &database,
        &authority,
        RpcRequest::DemoApproveTaskWithAckLoss {
            run_id: run_id.into(),
            approved_by: "user-1".into(),
            now_ms: 1_100,
        },
    );
    assert_eq!(uncertain["result"]["status"], "outcome_unknown");

    let after_effect = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_150,
        },
    );
    assert_eq!(after_effect["result"]["deskHeightMm"], 790);
    assert_eq!(after_effect["result"]["movementCount"], 1);

    let reconciled = invoke(
        &database,
        &authority,
        RpcRequest::ReconcileTask {
            run_id: run_id.into(),
            now_ms: 1_200,
        },
    );
    assert_eq!(reconciled["result"]["status"], "completed");

    let final_snapshot = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_250,
        },
    );
    assert_eq!(final_snapshot["result"]["movementCount"], 1);
}

#[test]
fn demo_device_offline_rpc_fails_before_effect_and_a_new_run_can_complete() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let failed_task = TaskSpec::prepare_focus_session("task-rpc-offline", "user-1", 800);

    let started = invoke(
        &database,
        &authority,
        RpcRequest::StartTask {
            task: failed_task,
            now_ms: 1_000,
        },
    );
    let failed_run_id = started["result"]["runId"].as_str().unwrap();
    let failed = invoke(
        &database,
        &authority,
        RpcRequest::DemoApproveTaskWithDeviceOffline {
            run_id: failed_run_id.into(),
            approved_by: "user-1".into(),
            now_ms: 1_100,
        },
    );
    assert_eq!(failed["result"]["status"], "failed");
    assert_eq!(failed["result"]["command"]["status"], "failed");
    assert_eq!(
        failed["result"]["commandEvents"][2]["eventType"],
        "execution_failed"
    );

    let after_failure = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_150,
        },
    );
    assert_eq!(after_failure["result"]["deskHeightMm"], 720);
    assert_eq!(after_failure["result"]["movementCount"], 0);

    let recovery_task = TaskSpec::prepare_focus_session("task-rpc-after-offline", "user-1", 800);
    let recovery_started = invoke(
        &database,
        &authority,
        RpcRequest::StartTask {
            task: recovery_task,
            now_ms: 1_200,
        },
    );
    let recovery_run_id = recovery_started["result"]["runId"].as_str().unwrap();
    let completed = invoke(
        &database,
        &authority,
        RpcRequest::ApproveTask {
            run_id: recovery_run_id.into(),
            approved_by: "user-1".into(),
            now_ms: 1_300,
        },
    );
    assert_eq!(completed["result"]["status"], "completed");

    let final_snapshot = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_350,
        },
    );
    assert_eq!(final_snapshot["result"]["deskHeightMm"], 800);
    assert_eq!(final_snapshot["result"]["movementCount"], 1);
}

#[test]
fn demo_device_unavailable_before_dispatch_resumes_the_same_run() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let task =
        TaskSpec::prepare_focus_session("task-rpc-unavailable-before-dispatch", "user-1", 805);

    let started = invoke(
        &database,
        &authority,
        RpcRequest::StartTask {
            task,
            now_ms: 1_000,
        },
    );
    let run_id = started["result"]["runId"].as_str().unwrap();
    let suspended = invoke(
        &database,
        &authority,
        RpcRequest::DemoApproveTaskWithDeviceUnavailableBeforeDispatch {
            run_id: run_id.into(),
            approved_by: "user-1".into(),
            now_ms: 1_100,
        },
    );

    assert_eq!(suspended["result"]["status"], "suspended");
    assert_eq!(
        suspended["result"]["suspensionReason"],
        "device_unavailable"
    );
    assert_eq!(suspended["result"]["command"], serde_json::Value::Null);
    assert_eq!(suspended["result"]["commandEvents"], json!([]));
    let after_suspension = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_150,
        },
    );
    assert_eq!(after_suspension["result"]["movementCount"], 0);

    let resumed = invoke(
        &database,
        &authority,
        RpcRequest::ResumeTask {
            run_id: run_id.into(),
            now_ms: 1_200,
        },
    );
    assert_eq!(resumed["result"]["status"], "completed");
    assert_eq!(
        resumed["result"]["suspensionReason"],
        serde_json::Value::Null
    );
    assert_eq!(
        resumed["result"]["events"]
            .as_array()
            .unwrap()
            .last()
            .unwrap()["eventType"],
        "run_resumed"
    );

    let final_snapshot = invoke(
        &database,
        &authority,
        RpcRequest::StationSnapshot {
            observed_at_ms: 1_250,
        },
    );
    assert_eq!(final_snapshot["result"]["deskHeightMm"], 805);
    assert_eq!(final_snapshot["result"]["movementCount"], 1);
}

#[test]
fn rpc_process_rejects_input_larger_than_the_protocol_limit() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("oversized.sqlite");
    let output = invoke_process(&database, &vec![b'x'; MAX_RPC_INPUT_BYTES as usize + 1]);
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();

    assert!(!output.status.success());
    assert_eq!(response["ok"], false);
    assert_eq!(response["error"]["code"], "invalid_request");
    assert!(response["error"]["message"]
        .as_str()
        .unwrap()
        .contains("input exceeds 65536 bytes"));
    assert!(!database.exists());
}

#[test]
fn rpc_process_rejects_an_unknown_method_as_an_invalid_request() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("unknown-method.sqlite");
    let output = invoke_process(&database, br#"{"method":"task.unknown","params":{}}"#);
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();

    assert!(!output.status.success());
    assert_eq!(response["error"]["code"], "invalid_request");
    assert!(!database.exists());
}

fn invoke(database: &std::path::Path, authority: &PolicyAuthority, request: RpcRequest) -> Value {
    let mut output = Vec::new();
    run_rpc(database, authority.clone(), request, &mut output).unwrap();
    serde_json::from_slice(&output).unwrap()
}

fn invoke_process(database: &std::path::Path, input: &[u8]) -> std::process::Output {
    let mut child = Command::new(env!("CARGO_BIN_EXE_station-cli"))
        .arg("--rpc")
        .arg(database)
        .env("ERGOPILOT_POLICY_KEY", "ergopilot-test-policy-key")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(input).unwrap();
    child.wait_with_output().unwrap()
}
