terraform {
  required_version = ">= 1.6.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
  # Remote state: create the bucket/table once (see infra/aws/README.md), then
  # `terraform init -backend-config=backend.<env>.hcl`.
  backend "s3" {}
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Application = "atlas-hiring"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# Route 53 health-check metrics are only published in us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = {
      Application = "atlas-hiring"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}
