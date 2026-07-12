use ergopilot_protocol::{DeviceAction, DeviceCommand, SCHEMA_VERSION};
use policy_core::{GrantRequest, PolicyAuthority, PolicyError};

#[test]
fn weak_policy_signing_key_is_rejected_at_startup() {
    let error = PolicyAuthority::new(b"short").unwrap_err();

    assert_eq!(error, PolicyError::WeakKey { minimum_bytes: 16 });
}

#[test]
fn authority_refuses_an_empty_grant_validity_window() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();

    let error = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 1_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::InvalidValidityWindow {
            issued_at_ms: 1_000,
            expires_at_ms: 1_000
        }
    );
}

#[test]
fn authority_issues_a_grant_the_station_verifier_accepts() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();

    authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap();
}

#[test]
fn expired_grant_cannot_authorize_a_command() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 1_100,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::Expired {
            expires_at_ms: 1_100,
            now_ms: 1_100
        }
    );
}

#[test]
fn grant_cannot_be_reused_for_a_different_action() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    command.action = DeviceAction::DeskMoveToHeight { height_mm: 800 };

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(error, PolicyError::ClaimMismatch { claim: "action" });
}

#[test]
fn grant_cannot_be_reused_with_a_different_state_precondition() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    command.expected_state_version += 1;

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::ClaimMismatch {
            claim: "expected_state_version"
        }
    );
}

#[test]
fn unsupported_grant_schema_is_rejected() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();
    let mut grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    grant.schema_version = SCHEMA_VERSION + 1;

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::UnsupportedSchemaVersion {
            expected: SCHEMA_VERSION,
            actual: SCHEMA_VERSION + 1
        }
    );
}

#[test]
fn grant_cannot_be_replayed_by_a_different_command() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    command.command_id = "cmd-policy-2".into();

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::ClaimMismatch {
            claim: "command_id"
        }
    );
}

#[test]
fn grant_cannot_cross_task_run_boundaries() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    command.task_run_id = "run-policy-other".into();

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::ClaimMismatch {
            claim: "task_run_id"
        }
    );
}

#[test]
fn command_must_reference_the_exact_signed_grant() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let mut command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    command.policy_grant_id = "grant-policy-other".into();

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(error, PolicyError::ClaimMismatch { claim: "grant_id" });
}

#[test]
fn grant_is_not_valid_before_its_issue_time() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();
    let grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_200,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(
        error,
        PolicyError::NotYetValid {
            issued_at_ms: 1_200,
            now_ms: 1_100
        }
    );
}

#[test]
fn modified_signed_claims_are_rejected() {
    let authority = PolicyAuthority::new(b"ergopilot-test-policy-key").unwrap();
    let command = command();
    let mut grant = authority
        .issue(GrantRequest {
            grant_id: command.policy_grant_id.clone(),
            task_run_id: command.task_run_id.clone(),
            command_id: command.command_id.clone(),
            action: command.action.clone(),
            expected_state_version: command.expected_state_version,
            issued_at_ms: 1_000,
            expires_at_ms: 2_000,
            rule_ids: vec!["desk.motion.requires_approval".into()],
        })
        .unwrap();
    grant.rule_ids.push("forged.rule".into());

    let error = authority
        .verifier()
        .verify(&grant, &command, 1_100)
        .unwrap_err();

    assert_eq!(error, PolicyError::InvalidSignature);
}

fn command() -> DeviceCommand {
    DeviceCommand {
        schema_version: SCHEMA_VERSION,
        command_id: "cmd-policy-1".into(),
        task_run_id: "run-policy-1".into(),
        action: DeviceAction::DeskMoveToHeight { height_mm: 760 },
        expected_state_version: 8,
        idempotency_key: "run-policy-1:desk:step-1".into(),
        expires_at_ms: 2_000,
        trace_id: "trace-policy-1".into(),
        policy_grant_id: "grant-policy-1".into(),
    }
}
