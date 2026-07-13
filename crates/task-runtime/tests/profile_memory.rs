use device_sim::SqliteSimulator;
use ergopilot_protocol::{
    ChairErgonomics, LightConfiguration, ReminderConfiguration, SaveWorkstationProfileRequest,
    WorkstationConfiguration,
};
use policy_core::PolicyAuthority;
use task_runtime::{TaskRuntime, TaskRuntimeError};

#[test]
fn custom_workstation_profile_survives_a_runtime_restart() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority.clone()).unwrap();
    let request = profile_request("profile-reading", "Reading");

    let saved = runtime.save_profile(request, 1_000).unwrap();
    drop(runtime);

    let simulator = SqliteSimulator::open(&database).unwrap();
    let restarted = TaskRuntime::open(&database, simulator, authority).unwrap();
    let profiles = restarted.list_profiles().unwrap();

    assert_eq!(profiles, vec![saved]);
    assert_eq!(profiles[0].configuration.light.color_temperature_k, 3_600);
}

#[test]
fn invalid_profile_fields_are_rejected_before_persistence() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority).unwrap();

    for request in [
        profile_request("invalid id", "Reading"),
        profile_request("profile-empty", "   "),
        profile_request("profile-long", &"x".repeat(65)),
    ] {
        assert!(matches!(
            runtime.save_profile(request, 1_000),
            Err(TaskRuntimeError::InvalidProfile { .. })
        ));
    }

    let mut unsafe_profile = profile_request("profile-unsafe", "Unsafe");
    unsafe_profile.configuration.chair.recline_angle_deg = 109;
    assert!(matches!(
        runtime.save_profile(unsafe_profile, 1_000),
        Err(TaskRuntimeError::InvalidProfile { .. })
    ));
    assert!(runtime.list_profiles().unwrap().is_empty());
}

#[test]
fn custom_profile_count_is_bounded() {
    let directory = tempfile::tempdir().unwrap();
    let database = directory.path().join("station.sqlite");
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let simulator = SqliteSimulator::open(&database).unwrap();
    let mut runtime = TaskRuntime::open(&database, simulator, authority).unwrap();

    for index in 0..32 {
        runtime
            .save_profile(
                profile_request(&format!("profile-{index}"), &format!("Profile {index}")),
                1_000 + index,
            )
            .unwrap();
    }
    assert!(matches!(
        runtime.save_profile(profile_request("profile-33", "Profile 33"), 2_000),
        Err(TaskRuntimeError::ProfileLimitReached { maximum: 32 })
    ));
    assert_eq!(runtime.list_profiles().unwrap().len(), 32);
}

fn profile_request(id: &str, name: &str) -> SaveWorkstationProfileRequest {
    SaveWorkstationProfileRequest {
        id: id.into(),
        name: name.into(),
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
    }
}
