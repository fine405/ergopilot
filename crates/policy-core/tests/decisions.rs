use ergopilot_protocol::{DeviceAction, PolicyOutcome};
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
