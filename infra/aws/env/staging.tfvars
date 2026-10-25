# Non-secret settings only. Secrets live in Secrets Manager (scripts/deploy/aws-bootstrap.sh).
environment     = "staging"
region          = "eu-west-2"
domain_name     = "" # REQUIRED before apply, e.g. "staging.app.example.com"
route53_zone_id = "" # empty: create the ACM validation and app DNS records manually (terraform output)
image_tag       = "bootstrap"
alarm_email     = ""
email_from      = "" # e.g. "Atlas Hiring <no-reply@example.com>"
# Platform AI stays off until the super admin has reviewed grants; organisations can still use BYOK.
llm_provider             = "none"
email_provider           = "postmark"
payment_provider         = "none" # "stripe" once STRIPE_* secrets hold TEST-mode keys
enabled_optional_secrets = []
