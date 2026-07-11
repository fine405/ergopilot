use device_sim::{NextFault, SimulatorError, SqliteSimulator};
use ergopilot_protocol::{
    CommandEvent, CommandStatus, DeviceAction, DeviceCommand, SCHEMA_VERSION,
};
use station_core::{RuntimeError, StationRuntime};
use std::{
    ffi::OsString,
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};
use thiserror::Error;

const DEMO_MARKER_CONTENT: &[u8] = b"ergopilot-station-cli-demo-v1\n";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DemoSummary {
    pub first_status: CommandStatus,
    pub replay_was_replayed: bool,
    pub uncertain_status: CommandStatus,
    pub recovered_status: CommandStatus,
    pub movement_count: u64,
}

#[derive(Debug, Error)]
pub enum DemoError {
    #[error(transparent)]
    Simulator(#[from] SimulatorError),
    #[error(transparent)]
    Runtime(#[from] RuntimeError),
    #[error(transparent)]
    Io(#[from] io::Error),
    #[error("recovery did not find the uncertain command")]
    MissingRecoveredCommand,
    #[error("refusing to overwrite unmarked database at {path}")]
    RefusingToOverwrite { path: PathBuf },
}

pub fn run_demo(
    database_path: impl AsRef<Path>,
    output: &mut impl Write,
) -> Result<DemoSummary, DemoError> {
    let database_path = database_path.as_ref();
    reset_database(database_path)?;

    writeln!(output, "ErgoPilot recoverable station runtime")?;
    writeln!(output, "database={}", database_path.display())?;

    let simulator = SqliteSimulator::open(database_path)?;
    let mut first_process = StationRuntime::open(database_path, simulator)?;
    let initial = first_process.snapshot(1_000)?;
    let normal_command = command(
        "cmd-normal-1",
        "run-normal-1",
        "run-normal-1:desk:step-1",
        760,
        initial.state_version,
    );

    let first = first_process.execute(normal_command.clone(), 1_100)?;
    writeln!(output, "\n[normal] status={:?}", first.status)?;
    write_events(output, &first_process.events(&normal_command.command_id)?)?;

    let replay = first_process.execute(normal_command, 1_200)?;
    writeln!(
        output,
        "[duplicate delivery] replayed={} status={:?}",
        replay.was_replayed, replay.status
    )?;
    drop(first_process);

    let mut simulator = SqliteSimulator::open(database_path)?;
    simulator.set_next_fault(NextFault::LoseReportAfterEffect);
    let mut interrupted_process = StationRuntime::open(database_path, simulator)?;
    let before_interruption = interrupted_process.snapshot(2_000)?;
    let interrupted_command = command(
        "cmd-recovery-1",
        "run-recovery-1",
        "run-recovery-1:desk:step-1",
        800,
        before_interruption.state_version,
    );

    let uncertain = interrupted_process.execute(interrupted_command.clone(), 2_100)?;
    writeln!(output, "\n[ack lost] status={:?}", uncertain.status)?;
    write_events(
        output,
        &interrupted_process.events(&interrupted_command.command_id)?,
    )?;
    drop(interrupted_process);

    let simulator = SqliteSimulator::open(database_path)?;
    let mut restarted_process = StationRuntime::open(database_path, simulator)?;
    let recovered = restarted_process
        .reconcile_pending(2_200)?
        .into_iter()
        .next()
        .ok_or(DemoError::MissingRecoveredCommand)?;
    writeln!(
        output,
        "\n[process restarted + reconciled] status={:?}",
        recovered.status
    )?;
    write_events(
        output,
        &restarted_process.events(&interrupted_command.command_id)?,
    )?;

    let final_snapshot = restarted_process.snapshot(2_300)?;
    writeln!(
        output,
        "\n[final device state] height={}mm state_version={} movement_count={}",
        final_snapshot.desk_height_mm, final_snapshot.state_version, final_snapshot.movement_count
    )?;

    Ok(DemoSummary {
        first_status: first.status,
        replay_was_replayed: replay.was_replayed,
        uncertain_status: uncertain.status,
        recovered_status: recovered.status,
        movement_count: final_snapshot.movement_count,
    })
}

fn command(
    command_id: &str,
    task_run_id: &str,
    idempotency_key: &str,
    height_mm: u16,
    expected_state_version: u64,
) -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: command_id.into(),
        task_run_id: task_run_id.into(),
        action: DeviceAction::DeskMoveToHeight { height_mm },
        expected_state_version,
        idempotency_key: idempotency_key.into(),
        expires_at_ms: 100_000,
        trace_id: format!("trace-{task_run_id}"),
        policy_grant_id: format!("grant-{task_run_id}"),
    }
}

fn write_events(output: &mut impl Write, events: &[CommandEvent]) -> io::Result<()> {
    for event in events {
        writeln!(
            output,
            "  event#{:02} {:<22} at={}ms",
            event.sequence,
            event.event_type.as_str(),
            event.at_ms
        )?;
    }
    Ok(())
}

fn reset_database(path: &Path) -> Result<(), DemoError> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)?;
    }

    let marker = sqlite_sidecar(path, ".ergopilot-demo");
    if path.exists()
        && fs::read(&marker)
            .map(|content| content != DEMO_MARKER_CONTENT)
            .unwrap_or(true)
    {
        return Err(DemoError::RefusingToOverwrite {
            path: path.to_path_buf(),
        });
    }

    for candidate in [
        path.to_path_buf(),
        sqlite_sidecar(path, "-wal"),
        sqlite_sidecar(path, "-shm"),
    ] {
        match fs::remove_file(candidate) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    fs::write(marker, DEMO_MARKER_CONTENT)?;
    Ok(())
}

fn sqlite_sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut value = OsString::from(path.as_os_str());
    value.push(suffix);
    PathBuf::from(value)
}
