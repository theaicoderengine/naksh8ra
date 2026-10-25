locals {
  required_runtime = ["DATABASE_URL", "REDIS_URL", "ENCRYPTION_KEY"]
  injected_runtime = toset(concat(local.required_runtime, [for s in var.enabled_optional_secrets : s if contains(tolist(local.runtime_secrets), s)]))
  secret_refs      = { for k, s in aws_secretsmanager_secret.app : k => s.arn }

  common_env = [
    { name = "APP_ENV", value = var.environment },
    { name = "APP_URL", value = local.app_url },
    { name = "APP_NAME", value = "Atlas Hiring" },
    { name = "TRUST_PROXY", value = "true" },
    { name = "QUEUE_MODE", value = "redis" },
    { name = "LOG_LEVEL", value = "info" },
    { name = "STORAGE_PROVIDER", value = "s3" },
    { name = "S3_BUCKET", value = aws_s3_bucket.files.bucket },
    { name = "S3_REGION", value = var.region },
    { name = "MALWARE_SCANNER", value = "clamav" },
    { name = "CLAMAV_HOST", value = "clamav" },
    { name = "CLAMAV_PORT", value = "3310" },
    { name = "LLM_PROVIDER", value = var.llm_provider },
    { name = "STT_PROVIDER", value = var.stt_provider },
    { name = "TTS_PROVIDER", value = var.tts_provider },
    { name = "EMAIL_PROVIDER", value = var.email_provider },
    { name = "EMAIL_FROM", value = var.email_from },
    { name = "PAYMENT_PROVIDER", value = var.payment_provider },
    # Explicitly off outside tests; the app also refuses fixtures in production.
    { name = "ALLOW_FIXTURE_PROVIDERS", value = "false" },
    { name = "EXPOSE_TEST_TOKENS", value = "false" },
    { name = "SEED_DEMO", value = "false" },
    { name = "PLATFORM_ADMIN_EMAILS", value = var.platform_admin_emails },
  ]
  runtime_secrets_list   = [for k in local.injected_runtime : { name = k, valueFrom = local.secret_refs[k] }]
  migration_secrets_list = [for k in local.migration_secrets : { name = k, valueFrom = local.secret_refs[k] }]
  web_image              = "${aws_ecr_repository.app["web"].repository_url}:${var.image_tag}"
  tooling_image          = "${aws_ecr_repository.app["tooling"].repository_url}:${var.image_tag}"
}

resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_service_discovery_http_namespace" "main" {
  name = local.name
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["web", "worker", "migrate", "clamav"])
  name              = "/atlas/${var.environment}/${each.key}"
  retention_in_days = local.log_days
}

# ── IAM ──
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  name = "read-app-secrets"
  role = aws_iam_role.execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = [for s in aws_secretsmanager_secret.app : s.arn]
    }]
  })
}

# Task role: only this environment's bucket. No other AWS access.
resource "aws_iam_role" "task" {
  name               = "${local.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "task_s3" {
  name = "files-bucket"
  role = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.files.arn}/*" },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.files.arn },
    ]
  })
}

# ── Task definitions ──
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name                   = "web"
    image                  = local.web_image
    essential              = true
    portMappings           = [{ containerPort = 3000, protocol = "tcp", name = "web" }]
    environment            = concat(local.common_env, [{ name = "PORT", value = "3000" }, { name = "HOSTNAME", value = "0.0.0.0" }])
    secrets                = local.runtime_secrets_list
    readonlyRootFilesystem = false
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 30
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["web"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "web"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name        = "worker"
    image       = local.tooling_image
    essential   = true
    command     = ["npm", "run", "worker"]
    environment = concat(local.common_env, [{ name = "WORKER_HEALTH_PORT", value = "3001" }, { name = "WORKER_CONCURRENCY", value = "8" }])
    secrets     = local.runtime_secrets_list
    healthCheck = {
      command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3001/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval    = 30
      timeout     = 5
      retries     = 3
      startPeriod = 60
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["worker"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

# One-shot: migrations + system seed + read-only AI access verification.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name        = "migrate"
    image       = local.tooling_image
    essential   = true
    command     = ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && npm run db:verify-ai-access"]
    environment = local.common_env
    secrets     = local.migration_secrets_list
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["migrate"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "migrate"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "clamav" {
  family                   = "${local.name}-clamav"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 3072 # signature database needs ~2 GB
  execution_role_arn       = aws_iam_role.execution.arn
  container_definitions = jsonencode([{
    name         = "clamav"
    image        = "clamav/clamav:1.4"
    essential    = true
    portMappings = [{ containerPort = 3310, protocol = "tcp", name = "clamav" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["clamav"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "clamav"
      }
    }
  }])
}

# ── Services ──
resource "aws_ecs_service" "clamav" {
  name            = "clamav"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.clamav.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.clamav.id]
  }
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
    service {
      port_name = "clamav"
      client_alias {
        dns_name = "clamav"
        port     = 3310
      }
    }
  }
}

resource "aws_ecs_service" "web" {
  name                               = "web"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.web.arn
  desired_count                      = var.web_desired_count
  launch_type                        = "FARGATE"
  health_check_grace_period_seconds  = 60
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true # reverts to the previous task definition of THIS release line only
  }
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name                               = "worker"
  cluster                            = aws_ecs_cluster.main.id
  task_definition                    = aws_ecs_task_definition.worker.arn
  desired_count                      = var.worker_desired_count
  launch_type                        = "FARGATE"
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.app.id]
  }
  service_connect_configuration {
    enabled   = true
    namespace = aws_service_discovery_http_namespace.main.arn
  }
}
