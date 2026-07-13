use device_sim::SqliteSimulator;
use ergopilot_protocol::{
    ChairErgonomics, LightConfiguration, ReminderConfiguration, SaveWorkstationProfileRequest,
    WorkstationConfiguration,
};
use policy_core::PolicyAuthority;
use task_runtime::TaskRuntime;

#[test]
fn custom_workstation_profile_survives_a_runtime_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let request = SaveWorkstationProfileRequest {
        id: "profile-reading".into(),
        name: "Reading".into(),
        configuration: WorkstationConfiguration {
            desk_height_mm: 740,
            chair: ChairErgonomics {
                seat_height_mm: 470,
                seat_depth_mm: 450,
                lumbar_support_percent: 50,
                armrest_height_mm: 245,
                armrest_depth_mm: 10,
                armrest_width_mm: 480,
                armrest_angle_deg: 5,
                recline_angle_deg: 115,
                recline_resistance_percent: 50,
                recline_locked: true,
                headrest_height_mm: 60,
                headrest_angle_deg: 8,
            },
            light: LightConfiguration {
                brightness_percent: 55,
                color_temperature_k: 3_600,
            },
            reminder: ReminderConfiguration {
                enabled: true,
                interval_minutes: 40,
            },
        },
    };

    let saved = runtime.save_profile(request, 1_000).unwrap();
    drop(runtime);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let profiles = restarted.list_profiles().unwrap();

    assert_eq!(profiles, vec![saved]);
    assert_eq!(profiles[0].configuration.light.color_temperature_k, 3_600);
}
