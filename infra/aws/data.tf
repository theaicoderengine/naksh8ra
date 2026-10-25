resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_parameter_group" "pg16" {
  name   = "${local.name}-pg16"
  family = "postgres16"
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }
  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }
}

# PostgreSQL 16. The master user (bootstrap only) has an AWS-managed password in Secrets
# Manager — it never appears in Terraform state. scripts/deploy/aws-bootstrap.sh creates
# atlas_owner (migrations) and atlas_app (runtime, NOBYPASSRLS) with the same SQL as
# scripts/db/bootstrap-roles.sql.
resource "aws_db_instance" "main" {
  identifier                          = local.name
  engine                              = "postgres"
  engine_version                      = "16"
  instance_class                      = var.db_instance_class
  allocated_storage                   = var.db_allocated_storage_gb
  max_allocated_storage               = var.db_allocated_storage_gb * 4
  storage_type                        = "gp3"
  storage_encrypted                   = true
  db_name                             = "atlas"
  username                            = "atlas_admin"
  manage_master_user_password         = true
  db_subnet_group_name                = aws_db_subnet_group.main.name
  vpc_security_group_ids              = [aws_security_group.db.id]
  parameter_group_name                = aws_db_parameter_group.pg16.name
  multi_az                            = local.is_prod
  publicly_accessible                 = false
  backup_retention_period             = local.backup_days
  backup_window                       = "02:00-03:00"
  maintenance_window                  = "sun:03:30-sun:04:30"
  copy_tags_to_snapshot               = true
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${local.name}-final"
  performance_insights_enabled        = true
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = false
  enabled_cloudwatch_logs_exports     = ["postgresql"]
}

resource "aws_elasticache_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_elasticache_parameter_group" "redis7" {
  name   = "${local.name}-redis7"
  family = "redis7"
  # BullMQ requires noeviction: evicting queue keys loses jobs.
  parameter {
    name  = "maxmemory-policy"
    value = "noeviction"
  }
}

# Auth token is set out-of-band (aws-bootstrap.sh → `modify-replication-group --auth-token`)
# so it never enters Terraform state; transit + at-rest encryption on.
resource "aws_elasticache_replication_group" "main" {
  replication_group_id       = local.name
  description                = "Atlas queue/rate limits"
  engine                     = "redis"
  engine_version             = "7.1"
  node_type                  = var.redis_node_type
  num_cache_clusters         = local.is_prod ? 2 : 1
  automatic_failover_enabled = local.is_prod
  multi_az_enabled           = local.is_prod
  parameter_group_name       = aws_elasticache_parameter_group.redis7.name
  subnet_group_name          = aws_elasticache_subnet_group.main.name
  security_group_ids         = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  snapshot_retention_limit   = local.is_prod ? 7 : 1
  lifecycle {
    ignore_changes = [auth_token]
  }
}
