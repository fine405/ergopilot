use ergopilot_protocol::{
    DeviceAction, DeviceCommand, PolicyDecision, PolicyGrant, PolicyOutcome, MAX_DESK_HEIGHT_MM,
    MIN_DESK_HEIGHT_MM, SCHEMA_VERSION,
};
use hmac::{Hmac, Mac};
use serde::Serialize;
use sha2::Sha256;
use thiserror::Error;

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GrantRequest {
    pub grant_id: String,
    pub task_run_id: String,
    pub command_id: String,
    pub action: DeviceAction,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub rule_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct PolicyAuthority {
    key: Vec<u8>,
}

#[derive(Clone)]
pub struct PolicyVerifier {
    key: Vec<u8>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PolicyError {
    #[error("policy grant serialization failed: {0}")]
    Serialization(String),
    #[error("policy grant signature is invalid")]
    InvalidSignature,
    #[error("policy grant expired at {expires_at_ms}, current time is {now_ms}")]
    Expired { expires_at_ms: u64, now_ms: u64 },
    #[error("policy grant is not valid until {issued_at_ms}, current time is {now_ms}")]
    NotYetValid { issued_at_ms: u64, now_ms: u64 },
    #[error("policy grant claim {claim} does not match the command")]
    ClaimMismatch { claim: &'static str },
    #[error("policy signing key must contain at least {minimum_bytes} bytes")]
    WeakKey { minimum_bytes: usize },
    #[error("policy grant validity window {issued_at_ms}..{expires_at_ms} is empty")]
    InvalidValidityWindow {
        issued_at_ms: u64,
        expires_at_ms: u64,
    },
}

impl PolicyAuthority {
    pub fn new(key: impl AsRef<[u8]>) -> Result<Self, PolicyError> {
        const MINIMUM_KEY_BYTES: usize = 16;
        let key = key.as_ref();
        if key.len() < MINIMUM_KEY_BYTES {
            return Err(PolicyError::WeakKey {
                minimum_bytes: MINIMUM_KEY_BYTES,
            });
        }
        Ok(Self { key: key.to_vec() })
    }

    pub fn verifier(&self) -> PolicyVerifier {
        PolicyVerifier {
            key: self.key.clone(),
        }
    }

    pub fn evaluate(&self, action: &DeviceAction) -> PolicyDecision {
        match action {
            DeviceAction::DeskMoveToHeight { height_mm }
                if !(MIN_DESK_HEIGHT_MM..=MAX_DESK_HEIGHT_MM).contains(height_mm) =>
            {
                PolicyDecision {
                    outcome: PolicyOutcome::Deny,
                    rule_ids: vec!["desk.height.safe_envelope".into()],
                    reason_code: Some("desk_height_out_of_range".into()),
                }
            }
            DeviceAction::DeskMoveToHeight { .. } => PolicyDecision {
                outcome: PolicyOutcome::RequireApproval,
                rule_ids: vec!["desk.motion.requires_approval".into()],
                reason_code: None,
            },
        }
    }

    pub fn issue(&self, request: GrantRequest) -> Result<PolicyGrant, PolicyError> {
        if request.expires_at_ms <= request.issued_at_ms {
            return Err(PolicyError::InvalidValidityWindow {
                issued_at_ms: request.issued_at_ms,
                expires_at_ms: request.expires_at_ms,
            });
        }
        let mut grant = PolicyGrant {
            schema_version: SCHEMA_VERSION,
            grant_id: request.grant_id,
            task_run_id: request.task_run_id,
            command_id: request.command_id,
            action: request.action,
            issued_at_ms: request.issued_at_ms,
            expires_at_ms: request.expires_at_ms,
            rule_ids: request.rule_ids,
            signature: String::new(),
        };
        let payload = signing_payload(&grant)?;
        let mut mac =
            HmacSha256::new_from_slice(&self.key).map_err(|_| PolicyError::InvalidSignature)?;
        mac.update(&payload);
        grant.signature = hex::encode(mac.finalize().into_bytes());
        Ok(grant)
    }
}

impl PolicyVerifier {
    pub fn verify(
        &self,
        grant: &PolicyGrant,
        command: &DeviceCommand,
        now_ms: u64,
    ) -> Result<(), PolicyError> {
        let payload = signing_payload(grant)?;
        let signature = hex::decode(&grant.signature).map_err(|_| PolicyError::InvalidSignature)?;
        let mut mac =
            HmacSha256::new_from_slice(&self.key).map_err(|_| PolicyError::InvalidSignature)?;
        mac.update(&payload);
        mac.verify_slice(&signature)
            .map_err(|_| PolicyError::InvalidSignature)?;
        if grant.issued_at_ms > now_ms {
            return Err(PolicyError::NotYetValid {
                issued_at_ms: grant.issued_at_ms,
                now_ms,
            });
        }
        if grant.expires_at_ms <= now_ms {
            return Err(PolicyError::Expired {
                expires_at_ms: grant.expires_at_ms,
                now_ms,
            });
        }
        if grant.grant_id != command.policy_grant_id {
            return Err(PolicyError::ClaimMismatch { claim: "grant_id" });
        }
        if grant.task_run_id != command.task_run_id {
            return Err(PolicyError::ClaimMismatch {
                claim: "task_run_id",
            });
        }
        if grant.command_id != command.command_id {
            return Err(PolicyError::ClaimMismatch {
                claim: "command_id",
            });
        }
        if grant.action != command.action {
            return Err(PolicyError::ClaimMismatch { claim: "action" });
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SigningPayload<'a> {
    schema_version: u16,
    grant_id: &'a str,
    task_run_id: &'a str,
    command_id: &'a str,
    action: &'a DeviceAction,
    issued_at_ms: u64,
    expires_at_ms: u64,
    rule_ids: &'a [String],
}

fn signing_payload(grant: &PolicyGrant) -> Result<Vec<u8>, PolicyError> {
    serde_json::to_vec(&SigningPayload {
        schema_version: grant.schema_version,
        grant_id: &grant.grant_id,
        task_run_id: &grant.task_run_id,
        command_id: &grant.command_id,
        action: &grant.action,
        issued_at_ms: grant.issued_at_ms,
        expires_at_ms: grant.expires_at_ms,
        rule_ids: &grant.rule_ids,
    })
    .map_err(|error| PolicyError::Serialization(error.to_string()))
}
