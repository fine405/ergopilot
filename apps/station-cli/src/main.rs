use std::{env, io, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    let database = env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("target/ergopilot-demo.sqlite"));

    match station_cli::run_demo(database, &mut io::stdout()) {
        Ok(_) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("station demo failed: {error}");
            ExitCode::FAILURE
        }
    }
}
