resource "aws_sns_topic" "alerts" {
  name = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alarm_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = [aws_sns_topic.alerts.arn]
  alarms = {
    alb_5xx = {
      namespace = "AWS/ApplicationELB", metric = "HTTPCode_Target_5XX_Count", stat = "Sum", threshold = 10, op = "GreaterThanThreshold", periods = 2
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }, desc = "Web returned >10 5xx responses per minute"
    }
    alb_unhealthy = {
      namespace = "AWS/ApplicationELB", metric = "UnHealthyHostCount", stat = "Maximum", threshold = 0, op = "GreaterThanThreshold", periods = 3
      dims      = { LoadBalancer = aws_lb.main.arn_suffix, TargetGroup = aws_lb_target_group.web.arn_suffix }, desc = "Unhealthy web targets"
    }
    alb_latency = {
      namespace = "AWS/ApplicationELB", metric = "TargetResponseTime", stat = "p95", threshold = 2, op = "GreaterThanThreshold", periods = 5
      dims      = { LoadBalancer = aws_lb.main.arn_suffix }, desc = "Web p95 latency > 2s"
    }
    web_running = {
      namespace = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2
      dims      = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.web.name }, desc = "No running web task"
    }
    worker_running = {
      namespace = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2
      dims      = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.worker.name }, desc = "No running worker task: background jobs and reservation sweeps stopped"
    }
    clamav_running = {
      namespace = "ECS/ContainerInsights", metric = "RunningTaskCount", stat = "Minimum", threshold = 1, op = "LessThanThreshold", periods = 2
      dims      = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.clamav.name }, desc = "Malware scanner down: uploads will fail closed"
    }
    rds_cpu = {
      namespace = "AWS/RDS", metric = "CPUUtilization", stat = "Average", threshold = 80, op = "GreaterThanThreshold", periods = 5
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Database CPU > 80%"
    }
    rds_storage = {
      namespace = "AWS/RDS", metric = "FreeStorageSpace", stat = "Minimum", threshold = 5 * 1024 * 1024 * 1024, op = "LessThanThreshold", periods = 1
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Database free storage < 5 GiB"
    }
    rds_memory = {
      namespace = "AWS/RDS", metric = "FreeableMemory", stat = "Minimum", threshold = 256 * 1024 * 1024, op = "LessThanThreshold", periods = 5
      dims      = { DBInstanceIdentifier = aws_db_instance.main.identifier }, desc = "Database freeable memory < 256 MiB"
    }
    redis_memory = {
      namespace = "AWS/ElastiCache", metric = "DatabaseMemoryUsagePercentage", stat = "Maximum", threshold = 75, op = "GreaterThanThreshold", periods = 3
      dims      = { ReplicationGroupId = aws_elasticache_replication_group.main.id }, desc = "Redis memory > 75% (noeviction: writes fail when full)"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "this" {
  for_each            = local.alarms
  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.desc
  namespace           = each.value.namespace
  metric_name         = each.value.metric
  dimensions          = each.value.dims
  statistic           = each.value.stat == "p95" ? null : each.value.stat
  extended_statistic  = each.value.stat == "p95" ? "p95" : null
  period              = 60
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.op
  treat_missing_data  = each.value.metric == "RunningTaskCount" ? "breaching" : "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Error-level application logs (pino level >= 50) from web and worker.
resource "aws_cloudwatch_log_metric_filter" "app_errors" {
  for_each       = toset(["web", "worker"])
  name           = "${local.name}-${each.key}-errors"
  log_group_name = aws_cloudwatch_log_group.app[each.key].name
  pattern        = "{ $.level >= 50 }"
  metric_transformation {
    name      = "${each.key}-errors"
    namespace = "Atlas/${var.environment}"
    value     = "1"
  }
}

resource "aws_cloudwatch_metric_alarm" "app_errors" {
  for_each            = aws_cloudwatch_log_metric_filter.app_errors
  alarm_name          = "${local.name}-${each.key}-error-logs"
  alarm_description   = "More than 20 error logs in 5 minutes (${each.key})"
  namespace           = "Atlas/${var.environment}"
  metric_name         = "${each.key}-errors"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 20
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# External readiness probe of /api/ready (DB + Redis) through the public HTTPS endpoint.
# Route 53 health-check metrics live in us-east-1, so the alarm uses an aliased provider.
resource "aws_route53_health_check" "ready" {
  count             = var.domain_name == "" ? 0 : 1
  fqdn              = var.domain_name
  port              = 443
  type              = "HTTPS"
  resource_path     = "/api/ready"
  request_interval  = 30
  failure_threshold = 3
  measure_latency   = false
  tags              = { Name = "${local.name}-ready" }
}

resource "aws_cloudwatch_metric_alarm" "ready" {
  count               = var.domain_name == "" ? 0 : 1
  provider            = aws.us_east_1
  alarm_name          = "${local.name}-ready-check"
  alarm_description   = "/api/ready failing from Route 53 health checkers"
  namespace           = "AWS/Route53"
  metric_name         = "HealthCheckStatus"
  dimensions          = { HealthCheckId = aws_route53_health_check.ready[0].id }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  alarm_actions       = [aws_sns_topic.alerts_us_east_1.arn]
  ok_actions          = [aws_sns_topic.alerts_us_east_1.arn]
}

resource "aws_sns_topic" "alerts_us_east_1" {
  provider = aws.us_east_1
  name     = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "email_us_east_1" {
  count     = var.alarm_email == "" ? 0 : 1
  provider  = aws.us_east_1
  topic_arn = aws_sns_topic.alerts_us_east_1.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}
