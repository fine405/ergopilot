use ergopilot_protocol::{
    ChairErgonomics, DeviceAction, LightConfiguration, PolicyOutcome, ReminderConfiguration,
};
use policy_core::PolicyAuthority;

#[test]
fn lumbar_motion_requires_approval_and_denies_out_of_range_input() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();

    let protected = authority.evaluate(&DeviceAction::ChairSetLumbarSupport { level_percent: 65 });
    let denied = authority.evaluate(&DeviceAction::ChairSetLumbarSupport { level_percent: 101 });

    assert_eq!(protected.outcome, PolicyOutcome::RequireApproval);
    assert_eq!(
        protected.rule_ids,
        ["chair.lumbar.requires_approval".to_string()]
    );
    assert_eq!(denied.outcome, PolicyOutcome::Deny);
    assert_eq!(
        denied.reason_code.as_deref(),
        Some("lumbar_support_out_of_range")
    );
}

#[test]
fn every_complete_workstation_configuration_is_denied_outside_its_safe_envelope() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut chair = valid_chair();
    chair.recline_angle_deg = 109;
    let cases = [
        (
            DeviceAction::ChairAdjustErgonomics(chair),
            "chair_ergonomics_out_of_range",
        ),
        (
            DeviceAction::LightConfigure(LightConfiguration {
                brightness_percent: 101,
                color_temperature_k: 4_300,
            }),
            "light_configuration_out_of_range",
        ),
        (
            DeviceAction::ReminderConfigure(ReminderConfiguration {
                enabled: true,
                interval_minutes: 181,
            }),
            "reminder_interval_out_of_range",
        ),
    ];

    for (action, reason) in cases {
        let decision = authority.evaluate(&action);
        assert_eq!(decision.outcome, PolicyOutcome::Deny);
        assert_eq!(decision.reason_code.as_deref(), Some(reason));
    }
}

fn valid_chair() -> ChairErgonomics {
    ChairErgonomics {
        seat_height_mm: 470,
        seat_depth_mm: 450,
        lumbar_support_percent: 50,
        armrest_height_mm: 240,
        armrest_depth_mm: 0,
        armrest_width_mm: 480,
        armrest_angle_deg: 0,
        recline_angle_deg: 110,
        recline_resistance_percent: 55,
        recline_locked: true,
        headrest_height_mm: 50,
        headrest_angle_deg: 0,
    }
}
