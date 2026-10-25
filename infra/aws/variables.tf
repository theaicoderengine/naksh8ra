variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "domain_name" {
  description = "Public hostname, e.g. app.example.com (staging: staging.example.com)"
  type        = string
  validation {
    condition     = can(regex("^[a-z0-9.-]+\\.[a-z]{2,}$", var.domain_name))
    error_message = "domain_name must be set to the public hostname before apply."
  }
}

variable "route53_zone_id" {
  description = "Hosted zone for domain_name. Empty = validate the certificate / point DNS manually (outputs show the records)."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Git SHA of the images in ECR to run"
  type        = string
}

variable "alarm_email" {
  description = "Email subscribed to operational alarms"
  type        = string
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage_gb" {
  type    = number
  default = 50
}

variable "redis_node_type" {
  type    = string
  default = "cache.t4g.small"
}

variable "web_cpu" {
  type    = number
  default = 1024
}

variable "web_memory" {
  type    = number
  default = 2048
}

variable "web_desired_count" {
  type    = number
  default = 2
}

variable "worker_cpu" {
  type    = number
  default = 1024
}

variable "worker_memory" {
  type    = number
  default = 2048
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "llm_provider" {
  description = "Deployment default for platform AI (anthropic|openai|gemini|none). Organisations still need explicit grants."
  type        = string
  default     = "none"
}

variable "stt_provider" {
  type    = string
  default = "none"
}

variable "tts_provider" {
  type    = string
  default = "browser"
}

variable "email_provider" {
  type    = string
  default = "postmark"
}

variable "email_from" {
  type = string
}

variable "payment_provider" {
  description = "stripe or none. Use Stripe TEST keys on staging and until live keys are authorised."
  type        = string
  default     = "none"
}

locals {
  name        = "atlas-${var.environment}"
  is_prod     = var.environment == "production"
  app_url     = "https://${var.domain_name}"
  azs         = slice(data.aws_availability_zones.available.names, 0, 2)
  log_days    = local.is_prod ? 365 : 30
  backup_days = local.is_prod ? 35 : 7
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

variable "enabled_optional_secrets" {
  description = "Third-party secrets to inject once their values exist in Secrets Manager (e.g. [\"GEMINI_API_KEY\",\"STRIPE_SECRET_KEY\"]). ECS refuses to start tasks that reference empty secrets."
  type        = list(string)
  default     = []
}

variable "platform_admin_emails" {
  description = "Set ONLY while registering the first super admin (docs/deployment.md step 5), then clear and re-apply"
  type        = string
  default     = ""
}
