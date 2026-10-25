output "app_url" { value = local.app_url }
output "alb_dns_name" { value = aws_lb.main.dns_name }
output "acm_validation_records" {
  description = "Create these DNS records yourself when route53_zone_id is empty."
  value       = { for o in aws_acm_certificate.main.domain_validation_options : o.domain_name => { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value } }
}
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.app : k => r.repository_url } }
output "secret_arns" { value = merge({ for k, s in aws_secretsmanager_secret.app : k => s.arn }, { for k, s in aws_secretsmanager_secret.db_role_password : k => s.arn }) }
output "files_bucket" { value = aws_s3_bucket.files.bucket }
output "cluster_name" { value = aws_ecs_cluster.main.name }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "app_security_group_id" { value = aws_security_group.app.id }
output "db_address" { value = aws_db_instance.main.address }
output "redis_primary_endpoint" { value = aws_elasticache_replication_group.main.primary_endpoint_address }
output "redis_replication_group_id" { value = aws_elasticache_replication_group.main.id }
output "task_definition_families" {
  value = {
    migrate = aws_ecs_task_definition.migrate.family
    dbinit  = aws_ecs_task_definition.dbinit.family
  }
}
