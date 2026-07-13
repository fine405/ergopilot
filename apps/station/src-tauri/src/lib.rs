mod host;

use host::{StationCommandError, StationHost};
use serde_json::Value;
use station_cli::RpcRequest;
use tauri::Manager;

#[tauri::command]
async fn station_rpc(
    state: tauri::State<'_, StationHost>,
    request: RpcRequest,
) -> Result<Value, StationCommandError> {
    let host = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || host.invoke(request))
        .await
        .map_err(|error| StationCommandError::internal(error.to_string()))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let host = StationHost::open(app.path().app_data_dir()?)?;
            app.manage(host);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![station_rpc])
        .run(tauri::generate_context!())
        .expect("failed to run ErgoPilot Station");
}
