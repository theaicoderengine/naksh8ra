# One-time database role bootstrap (scripts/db/bootstrap-roles.sql) run inside the VPC.
# It has its own execution role: only this task can read the RDS master secret.
resource "aws_secretsmanager_secret" "db_role_password" {
  for_each                = toset(["ATLAS_OWNER_PASSWORD", "ATLAS_APP_PASSWORD"])
  name                    = "${local.name}/${each.key}"
  recovery_window_in_days = local.is_prod ? 30 : 7
}

resource "aws_iam_role" "dbinit_execution" {
  name               = "${local.name}-dbinit-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "dbinit_execution" {
  role       = aws_iam_role.dbinit_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "dbinit_secrets" {
  name = "read-db-bootstrap-secrets"
  role = aws_iam_role.dbinit_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = concat([for s in aws_secretsmanager_secret.db_role_password : s.arn], [aws_db_instance.main.master_user_secret[0].secret_arn])
    }]
  })
}

resource "aws_ecs_task_definition" "dbinit" {
  family                   = "${local.name}-dbinit"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.dbinit_execution.arn
  container_definitions = jsonencode([{
    name      = "dbinit"
    image     = "postgres:16-bookworm"
    essential = true
    # psql variables are quoted by psql (:'var'), so passwords never appear on a command line or in logs.
    command = ["sh", "-c", <<-CMD
      set -eu
      printf '%s' "$BOOTSTRAP_SQL" > /tmp/bootstrap.sql
      psql "host=${aws_db_instance.main.address} port=5432 dbname=postgres user=$PGMASTER_USER sslmode=require" \
        -v ON_ERROR_STOP=1 -v db_name=atlas \
        -v owner_password="'$(printf '%s' "$ATLAS_OWNER_PASSWORD" | sed "s/'/''/g")'" \
        -v app_password="'$(printf '%s' "$ATLAS_APP_PASSWORD" | sed "s/'/''/g")'" \
        -f /tmp/bootstrap.sql
    CMD
    ]
    environment = [{ name = "BOOTSTRAP_SQL", value = file("${path.module}/../../scripts/db/bootstrap-roles.sql") }]
    secrets = [
      { name = "PGMASTER_USER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      { name = "ATLAS_OWNER_PASSWORD", valueFrom = aws_secretsmanager_secret.db_role_password["ATLAS_OWNER_PASSWORD"].arn },
      { name = "ATLAS_APP_PASSWORD", valueFrom = aws_secretsmanager_secret.db_role_password["ATLAS_APP_PASSWORD"].arn },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app["migrate"].name
        awslogs-region        = var.region
        awslogs-stream-prefix = "dbinit"
      }
    }
  }])
}
