use std::{env, io, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let mut arguments = env::args_os().skip(1);
    let first = arguments.next();
    let approval_demo = first.as_deref() == Some(std::ffi::OsStr::new("--approval"));
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
