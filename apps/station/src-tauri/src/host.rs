use policy_core::PolicyAuthority;
use serde::Serialize;
use serde_json::Value;
use station_cli::{DemoError, RpcRequest};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use thiserror::Error;

const POLICY_KEY_BYTES: usize = 32;
const MOTION_STEP_DELAY: Duration = Duration::from_millis(100);
const LOCAL_OPERATOR_ID: &str = "local-desktop-operator";

#[derive(Clone)]
pub(crate) struct StationHost {
    database_path: PathBuf,
    motion_step_delay: Duration,
    policy_key: Vec<u8>,
}

#[derive(Debug, Error)]
pub(crate) enum StationHostError {
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error(transparent)]
    Policy(#[from] policy_core::PolicyError),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationCommandError {
    code: String,
    message: String,
}

impl StationCommandError {
    pub(crate) fn internal(message: impl Into<String>) -> Self {
        Self {
            code: "station_rpc_error".into(),
            message: message.into(),
        }
    }
}

impl From<DemoError> for StationCommandError {
    fn from(error: DemoError) -> Self {
        Self {
            code: error.rpc_code().into(),
            message: error.to_string(),
        }
    }
}

impl StationHost {
    pub(crate) fn open(app_data_dir: impl AsRef<Path>) -> Result<Self, StationHostError> {
        Self::open_with_motion_step_delay(app_data_dir, MOTION_STEP_DELAY)
    }

    fn open_with_motion_step_delay(
        app_data_dir: impl AsRef<Path>,
        motion_step_delay: Duration,
    ) -> Result<Self, StationHostError> {
        let app_data_dir = app_data_dir.as_ref();
        fs::create_dir_all(app_data_dir)?;
        let policy_key = read_or_create_policy_key(&app_data_dir.join("policy.key"))?;
        PolicyAuthority::new(&policy_key)?;
        Ok(Self {
            database_path: app_data_dir.join("ergopilot-station.sqlite"),
            motion_step_delay,
            policy_key,
        })
    }

    pub(crate) fn invoke(&self, mut request: RpcRequest) -> Result<Value, StationCommandError> {
        if let RpcRequest::ResumeTask { resumed_by, .. } = &mut request {
            *resumed_by = LOCAL_OPERATOR_ID.into();
        }
        let authority = PolicyAuthority::new(&self.policy_key).map_err(DemoError::from)?;
        station_cli::invoke_rpc_with_motion_step_delay(
            &self.database_path,
            authority,
            request,
            self.motion_step_delay,
        )
        .map_err(StationCommandError::from)
    }
}

fn read_or_create_policy_key(path: &Path) -> io::Result<Vec<u8>> {
    match fs::read(path) {
        Ok(key) => return Ok(key),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let mut key = vec![0_u8; POLICY_KEY_BYTES];
    getrandom::fill(&mut key)
        .map_err(|error| io::Error::other(format!("failed to generate policy key: {error}")))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    match options.open(path) {
        Ok(mut file) => {
            file.write_all(&key)?;
            file.sync_all()?;
            Ok(key)
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => fs::read(path),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_task_can_complete_after_the_desktop_host_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let host =
            StationHost::open_with_motion_step_delay(directory.path(), Duration::ZERO).unwrap();
        let started = host
            .invoke(request(json!({
                "method": "task.start",
                "params": {
                    "task": {
                        "schemaVersion": 1,
                        "taskId": "task-desktop-restart",
                        "goal": "prepare_focus_session",
                        "requestedBy": "user-1",
                        "constraints": {},
                        "assumptions": [],
                        "steps": [{
                            "stepId": "desk-1",
                            "action": {
                                "type": "desk.move_to_height",
                                "input": { "heightMm": 780 }
                            }
                        }]
                    },
                    "nowMs": 1_000
                }
            })))
            .unwrap();
        let run_id = started["runId"].as_str().unwrap().to_owned();
        drop(host);

        let restarted =
            StationHost::open_with_motion_step_delay(directory.path(), Duration::ZERO).unwrap();
        let completed = restarted
            .invoke(request(json!({
                "method": "task.approve",
                "params": {
                    "runId": run_id,
                    "approvedBy": "user-1",
                    "nowMs": 1_100
                }
            })))
            .unwrap();
        let snapshot = restarted
            .invoke(request(json!({
                "method": "station.snapshot",
                "params": { "observedAtMs": 1_200 }
            })))
            .unwrap();

        assert_eq!(completed["status"], "completed");
        assert_eq!(snapshot["deskHeightMm"], 780);
        assert_eq!(snapshot["movementCount"], 1);
    }

    #[test]
    fn desktop_host_owns_the_persisted_recovery_actor() {
        let directory = tempfile::tempdir().unwrap();
        let host =
            StationHost::open_with_motion_step_delay(directory.path(), Duration::ZERO).unwrap();
        let started = host
            .invoke(request(json!({
                "method": "task.start",
                "params": {
                    "task": {
                        "schemaVersion": 1,
                        "taskId": "task-desktop-recovery-actor",
                        "goal": "prepare_focus_session",
                        "requestedBy": "user-1",
                        "constraints": {},
                        "assumptions": [],
                        "steps": [{
                            "stepId": "desk-1",
                            "action": {
                                "type": "desk.move_to_height",
                                "input": { "heightMm": 780 }
                            }
                        }]
                    },
                    "nowMs": 1_000
                }
            })))
            .unwrap();
        let run_id = started["runId"].as_str().unwrap();
        host.invoke(request(json!({
            "method": "demo.task.approve_with_actuator_jam",
            "params": {
                "runId": run_id,
                "approvedBy": "user-1",
                "nowMs": 1_100
            }
        })))
        .unwrap();

        let completed = host
            .invoke(request(json!({
                "method": "task.resume",
                "params": {
                    "runId": run_id,
                    "resumedBy": "spoofed-webview-actor",
                    "nowMs": 1_200
                }
            })))
            .unwrap();
        let recovery_attempt = completed["events"]
            .as_array()
            .unwrap()
            .iter()
            .find(|event| event["eventType"] == "run_resume_attempted")
            .unwrap();

        assert_eq!(recovery_attempt["actorId"], "local-desktop-operator");
    }

    fn request(value: Value) -> RpcRequest {
        serde_json::from_value(value).unwrap()
    }
}
