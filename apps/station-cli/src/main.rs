use policy_core::PolicyAuthority;
use std::{
    env,
    ffi::OsStr,
    io::{self, Read},
    path::{Path, PathBuf},
    process::ExitCode,
};

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let first = arguments.next();
    if first.as_deref() == Some(OsStr::new("--rpc")) {
        let database = arguments
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("target/ergopilot-control-plane.sqlite"));
        return run_rpc_mode(&database);
    }
    let approval_demo = first.as_deref() == Some(OsStr::new("--approval"));
    let database = if approval_demo {
        arguments
            .next()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("target/ergopilot-approval-demo.sqlite"))
    } else {
        first
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("target/ergopilot-demo.sqlite"))
    };

    let result = if approval_demo {
        station_cli::run_approval_demo(database, &mut io::stdout()).map(|_| ())
    } else {
        station_cli::run_demo(database, &mut io::stdout()).map(|_| ())
    };
    match result {
        Ok(_) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("station demo failed: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run_rpc_mode(database: &Path) -> ExitCode {
    let result = (|| {
        let policy_key = env::var("ERGOPILOT_POLICY_KEY").map_err(|_| {
            io::Error::new(
                io::ErrorKind::InvalidInput,
                "ERGOPILOT_POLICY_KEY is required for RPC mode",
            )
        })?;
        let authority = PolicyAuthority::new(policy_key.as_bytes())?;
        let mut input = String::new();
        io::stdin()
            .take(station_cli::MAX_RPC_INPUT_BYTES + 1)
            .read_to_string(&mut input)?;
        if input.len() as u64 > station_cli::MAX_RPC_INPUT_BYTES {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "station RPC input exceeds {} bytes",
                    station_cli::MAX_RPC_INPUT_BYTES
                ),
            )
            .into());
        }
        let request =
            serde_json::from_str(&input).map_err(station_cli::DemoError::InvalidRpcRequest)?;
        station_cli::run_rpc(database, authority, request, &mut io::stdout())
    })();

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let response = serde_json::json!({
                "ok": false,
                "error": {
                    "code": error.rpc_code(),
                    "message": error.to_string()
                }
            });
            println!("{response}");
            ExitCode::FAILURE
        }
    }
}
