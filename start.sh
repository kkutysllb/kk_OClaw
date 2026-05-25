#!/usr/bin/env bash
#
# start.sh — KKOCLAW 一键启动脚本
#
# 命令:
#   ./start.sh start [服务] [模式]   启动服务（默认: all dev）
#   ./start.sh stop [服务]          停止服务（默认: all）
#   ./start.sh restart [服务] [模式] 重启服务（默认: all dev）
#   ./start.sh status               查看服务运行状态
#   ./start.sh logs [service]       查看服务日志
#   ./start.sh clean [级别]         清理构建物和缓存资源
#
# 服务:
#   all        所有服务（默认）
#   gateway    后端服务 (Gateway)
#   frontend   前端服务 (Frontend)
#   nginx      反向代理 (Nginx)
#
# 模式:
#   dev     开发模式 — 热重载，适合日常开发（默认）
#   prod    本地生产模式 — 预构建前端，优化运行
#   docker  Docker生产模式 — 容器化部署
#
# 示例:
#   ./start.sh start                    # 开发模式启动所有服务
#   ./start.sh start docker             # Docker 生产模式启动
#   ./start.sh start gateway            # 仅启动 Gateway
#   ./start.sh start frontend prod      # 仅启动 Frontend（生产模式）
#   ./start.sh stop                     # 停止所有服务（自动检测 docker/本地）
#   ./start.sh stop gateway             # 仅停止 Gateway
#   ./start.sh restart docker           # 重启 Docker 服务
#   ./start.sh restart frontend         # 重启 Frontend
#   ./start.sh status                   # 查看状态（自动检测 docker/本地）
#   ./start.sh logs                     # 查看所有日志
#   ./start.sh logs gateway             # 仅查看 Gateway 日志

set -e

# ── 项目根目录 ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(builtin cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

# ── 加载 .env 配置 ───────────────────────────────────────────────────────────
if [ -f "$REPO_ROOT/.env" ]; then
    set -a
    source "$REPO_ROOT/.env"
    set +a
fi

# ── 环境变量默认值 ───────────────────────────────────────────────────────────
GATEWAY_PORT="${GATEWAY_PORT:-9193}"
FRONTEND_PORT="${FRONTEND_PORT:-9192}"
# Nginx 公共端口: 优先 NGINX_PORT, 向后兼容 LANGGRAPH_PORT (旧名), 默认 9191
NGINX_PORT="${NGINX_PORT:-${LANGGRAPH_PORT:-9191}}"

# ── 路径配置 ─────────────────────────────────────────────────────────────────
PID_DIR="$REPO_ROOT/.pids"
LOG_DIR="$REPO_ROOT/logs"
NGINX_TEMP_CONF="$REPO_ROOT/temp/nginx-local-gen.conf"

GATEWAY_PID_FILE="$PID_DIR/gateway.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
NGINX_PID_FILE="$PID_DIR/nginx.pid"

GATEWAY_LOG="$LOG_DIR/gateway.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"
NGINX_LOG="$LOG_DIR/nginx.log"

# ── 颜色输出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

BOLD='\033[1m'

# ── 工具函数 ─────────────────────────────────────────────────────────────────

_log()  { echo -e "$@" >&2; }
_info() { _log "${BLUE}[INFO]${NC} $*"; }
_ok()   { _log "${GREEN}[OK]${NC}   $*"; }
_warn() { _log "${YELLOW}[WARN]${NC} $*"; }
_err()  { _log "${RED}[ERR]${NC}  $*"; }

_banner() {
    echo ""
    echo -e "${BOLD}=========================================="
    echo "  KKOCLAW 服务管理"
    echo -e "==========================================${NC}"
    echo ""
}

# 检查端口是否被监听
_port_listening() {
    lsof -i ":$1" -sTCP:LISTEN 2>/dev/null | grep -q LISTEN
}

# 通过 PID 文件检查进程是否存活
_pid_alive() {
    local pid_file="$1"
    [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null
}

# 停止单个服务（通过 PID 文件）
_kill_by_pidfile() {
    local pid_file="$1" name="$2"
    if [ -f "$pid_file" ]; then
        local pid
        pid=$(cat "$pid_file" 2>/dev/null)
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            sleep 0.5
            kill -9 "$pid" 2>/dev/null || true
        fi
        rm -f "$pid_file"
    fi
}

# 强制释放端口（安全：跳过所有 Docker 相关进程）
_kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti ":$port" 2>/dev/null) || true
    [ -z "$pids" ] && return 0
    for p in $pids; do
        # 通过 lsof 获取进程名（比 ps -o comm= 更可靠，不受路径截断影响）
        local cmd
        cmd=$(lsof -p "$p" -FcN 2>/dev/null | grep "^c" | head -1 | cut -c2-) || true
        # Docker 相关进程全部跳过（macOS: com.docker.backend/com.docker.vpnkit, Linux: docker-proxy）
        case "$cmd" in
            docker-proxy|com.docker.*|Docker*) continue ;;
        esac
        kill -9 "$p" 2>/dev/null || true
    done
}

# 等待端口就绪
_wait_for_port() {
    local port="$1" timeout="${2:-30}" name="${3:-Service}"
    local elapsed=0
    while [ $elapsed -lt $timeout ]; do
        if _port_listening "$port"; then
            return 0
        fi
        sleep 1
        elapsed=$((elapsed + 1))
    done
    _err "$name 启动超时（${timeout}s），端口 $port 未就绪"
    return 1
}

# 写 PID 文件
_write_pid() {
    local pid_file="$1" pid="$2"
    mkdir -p "$(dirname "$pid_file")"
    echo "$pid" > "$pid_file"
}

# ── 帮助信息 ─────────────────────────────────────────────────────────────────

show_help() {
    echo "用法: ./start.sh <命令> [服务] [模式]"
    echo ""
    echo "命令:"
    echo "  start [服务] [模式]   启动服务（默认: all dev）"
    echo "  stop <模式> [服务]    停止服务（模式必填: dev|prod|docker）"
    echo "  restart [服务] [模式] 重启服务（默认: all dev）"
    echo "  status               查看服务运行状态"
    echo "  logs [service]       查看服务日志"
    echo "  clean [级别]         清理构建物和缓存资源 (cache|build|all)"
    echo ""
    echo "服务:"
    echo "  all        所有服务（默认）"
    echo "  gateway    后端服务 (Gateway)"
    echo "  frontend   前端服务 (Frontend)"
    echo "  nginx      反向代理 (Nginx)"
    echo ""
    echo "模式:"
    echo "  dev        开发模式 — 热重载，适合日常开发"
    echo "  prod       本地生产模式 — 预构建前端，优化运行"
    echo "  docker     Docker生产模式 — 容器化部署"
    echo ""
    echo "日志服务名:"
    echo "  gateway  |  frontend  |  nginx  |  all（默认）"
    echo ""
    echo "示例:"
    echo "  ./start.sh start                    # 开发模式启动所有服务"
    echo "  ./start.sh start docker             # Docker 生产模式启动"
    echo "  ./start.sh start prod               # 本地生产模式启动"
    echo "  ./start.sh start gateway            # 仅启动 Gateway"
    echo "  ./start.sh stop docker           # 停止 Docker 容器服务"
    echo "  ./start.sh stop dev              # 停止开发模式服务"
    echo "  ./start.sh stop prod             # 停止本地生产模式服务"
    echo "  ./start.sh stop docker gateway   # 仅停止 Docker 中的 Gateway 容器"
    echo "  ./start.sh restart docker           # 重启 Docker 服务"
    echo "  ./start.sh status                   # 查看状态（自动检测模式）"
    echo "  ./start.sh logs                     # 查看所有日志"
    echo "  ./start.sh logs gateway             # 仅查看 Gateway 日志"
    echo ""
    echo "清理级别:"
    echo "  cache       清理缓存文件（Python缓存、前端缓存、日志）"
    echo "  build       清理构建产物（前端.next、后端构建缓存）+ cache"
    echo "  all         深度清理（含node_modules/.cache、.kkoclaw运行数据）+ build"
    echo "  (默认)      等同于 cache"
    echo ""
    echo "清理示例:"
    echo "  ./start.sh clean               # 清理缓存"
    echo "  ./start.sh clean build         # 清理构建产物"
    echo "  ./start.sh clean all           # 深度清理"
}

# ── 单独停止服务 ──────────────────────────────────────────────────────────

stop_gateway() {
    _info "停止 Gateway..."
    _kill_by_pidfile "$GATEWAY_PID_FILE" "Gateway"
    _kill_port $GATEWAY_PORT
    _ok "Gateway 已停止"
}

stop_frontend() {
    _info "停止 Frontend..."
    _kill_by_pidfile "$FRONTEND_PID_FILE" "Frontend"
    _kill_port $FRONTEND_PORT
    _ok "Frontend 已停止"
}

stop_nginx_svc() {
    _info "停止 Nginx..."
    if [ -f "$NGINX_TEMP_CONF" ]; then
        nginx -c "$NGINX_TEMP_CONF" -p "$REPO_ROOT" -s quit 2>/dev/null || true
    fi
    nginx -c "$REPO_ROOT/docker/nginx/nginx.local.conf" -p "$REPO_ROOT" -s quit 2>/dev/null || true
    sleep 0.5
    _kill_by_pidfile "$NGINX_PID_FILE" "Nginx"
    _kill_port $NGINX_PORT
    rm -f "$NGINX_TEMP_CONF" 2>/dev/null || true
    _ok "Nginx 已停止"
}

# ── 单独启动服务 ──────────────────────────────────────────────────────────

start_gateway() {
    local mode="${1:-dev}"
    local gateway_workers="${GATEWAY_WORKERS:-1}"

    # 前置检查
    if ! { \
            [ -n "$KKOCLAW_CONFIG_PATH" ] && [ -f "$KKOCLAW_CONFIG_PATH" ] || \
            [ -f backend/config.yaml ] || \
            [ -f config.yaml ]; \
        }; then
        _err "未找到 config.yaml 配置文件"
        echo "  请运行 'make setup' 或 'make config' 生成配置"
        return 1
    fi

    mkdir -p "$LOG_DIR" "$PID_DIR"

    local gateway_flags=""
    local gateway_worker_flags=""
    if [ "$mode" != "prod" ]; then
        gateway_flags="--reload --reload-include='*.yaml' --reload-include='.env' --reload-exclude='*.pyc' --reload-exclude='__pycache__' --reload-exclude='sandbox/' --reload-exclude='.kkoclaw/'"
    else
        if ! [[ "$gateway_workers" =~ ^[1-9][0-9]*$ ]]; then
            _err "GATEWAY_WORKERS 必须是大于等于 1 的整数，当前值: $gateway_workers"
            return 1
        fi
        gateway_worker_flags="--workers $gateway_workers"
    fi

    # 停止已有的 Gateway
    stop_gateway

    _info "启动 Gateway..."
    :> "$GATEWAY_LOG"
    nohup sh -c "cd backend && KKOCLAW_PROJECT_ROOT=\"$REPO_ROOT\" KKOCLAW_HOME=\"$REPO_ROOT/backend/.kkoclaw\" PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port $GATEWAY_PORT $gateway_flags $gateway_worker_flags" \
        > "$GATEWAY_LOG" 2>&1 &
    local gpid=$!
    disown $gpid 2>/dev/null || true
    _write_pid "$GATEWAY_PID_FILE" "$gpid"

    if _wait_for_port "$GATEWAY_PORT" 30 "Gateway"; then
        if [ "$mode" = "prod" ]; then
            _ok "Gateway 已启动  PID: $gpid  端口: $GATEWAY_PORT  workers: $gateway_workers"
        else
            _ok "Gateway 已启动  PID: $gpid  端口: $GATEWAY_PORT"
        fi
    else
        _err "Gateway 启动失败，查看日志: $GATEWAY_LOG"
        tail -20 "$GATEWAY_LOG"
        return 1
    fi
}

start_frontend() {
    local mode="${1:-dev}"
    mkdir -p "$LOG_DIR" "$PID_DIR"

    local frontend_cmd=""
    if [ "$mode" = "prod" ]; then
        if command -v python3 >/dev/null 2>&1; then
            PYTHON_BIN="python3"
        elif command -v python >/dev/null 2>&1; then
            PYTHON_BIN="python"
        else
            _err "需要 Python 来生成 BETTER_AUTH_SECRET"
            return 1
        fi
        frontend_cmd="env BETTER_AUTH_SECRET=$($PYTHON_BIN -c 'import secrets; print(secrets.token_hex(16))') pnpm run preview"
    else
        frontend_cmd="pnpm run dev"
    fi

    # 停止已有的 Frontend
    stop_frontend

    _info "启动 Frontend..."
    :> "$FRONTEND_LOG"
    nohup sh -c "cd frontend && PORT=$FRONTEND_PORT $frontend_cmd" \
        > "$FRONTEND_LOG" 2>&1 &
    local fpid=$!
    disown $fpid 2>/dev/null || true
    _write_pid "$FRONTEND_PID_FILE" "$fpid"

    if _wait_for_port "$FRONTEND_PORT" 120 "Frontend"; then
        _ok "Frontend 已启动  PID: $fpid  端口: $FRONTEND_PORT"
    else
        _err "Frontend 启动失败，查看日志: $FRONTEND_LOG"
        tail -20 "$FRONTEND_LOG"
        return 1
    fi
}

start_nginx_svc() {
    mkdir -p "$LOG_DIR" "$PID_DIR"
    mkdir -p temp/client_body_temp temp/proxy_temp temp/fastcgi_temp temp/uwsgi_temp temp/scgi_temp

    if ! command -v nginx >/dev/null 2>&1; then
        _warn "未安装 Nginx，跳过反向代理启动"
        return 0
    fi

    # 停止已有的 Nginx
    stop_nginx_svc

    _info "启动 Nginx..."
    :> "$NGINX_LOG"
    generate_nginx_config
    nohup nginx -g 'daemon off;' -c "$NGINX_TEMP_CONF" -p "$REPO_ROOT" \
        > "$NGINX_LOG" 2>&1 &
    local npid=$!
    disown $npid 2>/dev/null || true
    _write_pid "$NGINX_PID_FILE" "$npid"

    if _wait_for_port "$NGINX_PORT" 10 "Nginx"; then
        _ok "Nginx 已启动  PID: $npid  端口: $NGINX_PORT"
    else
        _err "Nginx 启动失败，查看日志: $NGINX_LOG"
        tail -20 "$NGINX_LOG"
        return 1
    fi
}

# ── Docker 辅助函数 ─────────────────────────────────────────────────────────

# Docker Compose 命令（生产模式）
DOCKER_COMPOSE_CMD="docker compose --env-file $REPO_ROOT/.env -p kkoclaw -f $REPO_ROOT/docker/docker-compose.yaml"

# 检测 Docker 容器是否在运行
_is_docker_running() {
    _export_compose_env
    $DOCKER_COMPOSE_CMD ps --status running -q 2>/dev/null | grep -q .
}

# 检测当前运行模式: docker / local / none
_detect_mode() {
    if docker info >/dev/null 2>&1 && _is_docker_running; then
        echo "docker"
    elif [ -f "$GATEWAY_PID_FILE" ] || [ -f "$FRONTEND_PID_FILE" ] || [ -f "$NGINX_PID_FILE" ]; then
        echo "local"
    else
        echo "none"
    fi
}

# 导出 Docker Compose 所需环境变量（与 start_docker 保持一致）
_export_compose_env() {
    export KKOCLAW_HOME="${KKOCLAW_HOME:-$REPO_ROOT/backend/.kkoclaw}"
    export KKOCLAW_CONFIG_PATH="${KKOCLAW_CONFIG_PATH:-$REPO_ROOT/config.yaml}"
    export KKOCLAW_EXTENSIONS_CONFIG_PATH="${KKOCLAW_EXTENSIONS_CONFIG_PATH:-$REPO_ROOT/extensions_config.json}"
    export KKOCLAW_DOCKER_SOCKET="${KKOCLAW_DOCKER_SOCKET:-/var/run/docker.sock}"
    export KKOCLAW_REPO_ROOT="$REPO_ROOT"
    export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-placeholder}"
}

# 停止 Docker 服务
stop_docker() {
    _info "停止 Docker 服务..."
    _export_compose_env
    if $DOCKER_COMPOSE_CMD down; then
        _ok "Docker 服务已停止"
    else
        _warn "docker compose down 失败，尝试直接停止容器..."
        docker stop kkoclaw-nginx kkoclaw-gateway kkoclaw-frontend 2>/dev/null || true
        docker rm kkoclaw-nginx kkoclaw-gateway kkoclaw-frontend 2>/dev/null || true
        _ok "容器已强制停止"
    fi
}

# ── 停止所有服务（本地模式） ──────────────────────────────────────────────────

stop_local_all() {
    echo ""
    _info "正在停止所有本地服务..."
    stop_nginx_svc
    stop_gateway
    stop_frontend
    rm -rf "$PID_DIR" 2>/dev/null || true
    "$REPO_ROOT/scripts/cleanup-containers.sh" kkoclaw-sandbox 2>/dev/null || true
    _ok "所有本地服务已停止"
    echo ""
}

# ── 服务状态 ─────────────────────────────────────────────────────────────────

show_status() {
    _banner
    echo -e "${BOLD}服务运行状态${NC}"
    echo "──────────────────────────────────────────────"
    echo ""

    # Docker 模式检测
    if _is_docker_running; then
        echo -e "  ${GREEN}●${NC} Docker     ${GREEN}运行中${NC}  (容器化部署)"
        echo ""
        echo "  Docker 容器:"
        $DOCKER_COMPOSE_CMD ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null | sed 's/^/    /'
        echo ""
        echo -e "  ${GREEN}🌐 访问地址: http://localhost:$NGINX_PORT${NC}"
        echo ""
        return
    fi

    local all_ok=true

    # Gateway
    if _pid_alive "$GATEWAY_PID_FILE"; then
        local gpid
        gpid=$(cat "$GATEWAY_PID_FILE")
        echo -e "  ${GREEN}●${NC} Gateway    ${GREEN}运行中${NC}  端口: $GATEWAY_PORT  PID: $gpid"
        echo -e "          日志: $GATEWAY_LOG"
    elif _port_listening "$GATEWAY_PORT"; then
        echo -e "  ${YELLOW}●${NC} Gateway    ${YELLOW}运行中${NC}  端口: $GATEWAY_PORT  (PID 文件缺失)"
    else
        echo -e "  ${RED}●${NC} Gateway    ${RED}已停止${NC}  端口: $GATEWAY_PORT"
        all_ok=false
    fi

    # Frontend
    if _pid_alive "$FRONTEND_PID_FILE"; then
        local fpid
        fpid=$(cat "$FRONTEND_PID_FILE")
        echo -e "  ${GREEN}●${NC} Frontend   ${GREEN}运行中${NC}  端口: $FRONTEND_PORT  PID: $fpid"
        echo -e "          日志: $FRONTEND_LOG"
    elif _port_listening "$FRONTEND_PORT"; then
        echo -e "  ${YELLOW}●${NC} Frontend   ${YELLOW}运行中${NC}  端口: $FRONTEND_PORT  (PID 文件缺失)"
    else
        echo -e "  ${RED}●${NC} Frontend   ${RED}已停止${NC}  端口: $FRONTEND_PORT"
        all_ok=false
    fi

    # Nginx
    if _pid_alive "$NGINX_PID_FILE"; then
        local npid
        npid=$(cat "$NGINX_PID_FILE")
        echo -e "  ${GREEN}●${NC} Nginx      ${GREEN}运行中${NC}  端口: $NGINX_PORT   PID: $npid"
        echo -e "          日志: $NGINX_LOG"
    elif _port_listening "$NGINX_PORT"; then
        echo -e "  ${YELLOW}●${NC} Nginx      ${YELLOW}运行中${NC}  端口: $NGINX_PORT   (PID 文件缺失)"
    else
        echo -e "  ${RED}●${NC} Nginx      ${RED}已停止${NC}  端口: $NGINX_PORT"
        all_ok=false
    fi

    echo ""
    if $all_ok && (_pid_alive "$GATEWAY_PID_FILE" || _port_listening "$GATEWAY_PORT"); then
        echo -e "  ${GREEN}🌐 访问地址: http://localhost:$NGINX_PORT${NC}"
        echo ""
        echo -e "  ${CYAN}路由: Frontend → Nginx → Gateway${NC}"
        echo -e "  ${CYAN}API:  /api/langgraph/*  →  Gateway agent runtime${NC}"
        echo -e "  ${CYAN}      /api/*             →  Gateway REST API ($GATEWAY_PORT)${NC}"
    fi
    echo ""
}

# ── 查看日志 ─────────────────────────────────────────────────────────────────

show_logs() {
    local svc="$1"

    # Docker 模式日志
    if _is_docker_running; then
        local docker_svc=""
        case "$svc" in
            gateway)  docker_svc="gateway" ;;
            frontend) docker_svc="frontend" ;;
            nginx)    docker_svc="nginx" ;;
            all|"")  docker_svc="" ;;
            *)
                _err "未知服务: $svc (可选: gateway, frontend, nginx, all)"
                exit 1
                ;;
        esac
        _info "Docker 服务日志 (Ctrl+C 退出):"
        $DOCKER_COMPOSE_CMD logs -f $docker_svc
        return
    fi

    case "$svc" in
        gateway)
            _info "Gateway 日志 ($GATEWAY_LOG):"
            tail -f "$GATEWAY_LOG"
            ;;
        frontend)
            _info "Frontend 日志 ($FRONTEND_LOG):"
            tail -f "$FRONTEND_LOG"
            ;;
        nginx)
            _info "Nginx 日志 ($NGINX_LOG):"
            tail -f "$NGINX_LOG"
            ;;
        all|"")
            _info "所有服务日志 (Ctrl+C 退出):"
            tail -f "$GATEWAY_LOG" "$FRONTEND_LOG" "$NGINX_LOG"
            ;;
        *)
            _err "未知服务: $svc (可选: gateway, frontend, nginx, all)"
            exit 1
            ;;
    esac
}

# ── 清理资源 ─────────────────────────────────────────────────────────────────

clean_resources() {
    local level="${1:-cache}"

    _banner
    echo -e "  ${BOLD}清理级别:${NC} $level"
    echo ""

    # ── 共通: 先停止所有本地服务 ────────────────────────────────────────────────
    _info "停止所有本地服务..."
    stop_local_all >/dev/null 2>&1 || true

    local total_freed=0

    # ── 辅助: 计算目录大小(MB) ─────────────────────────────────────────────
    _dir_size_mb() {
        if [ -d "$1" ]; then
            du -sm "$1" 2>/dev/null | cut -f1
        else
            echo 0
        fi
    }

    # ── 辅助: 删除并报告 ─────────────────────────────────────────────────
    _rm_report() {
        local target="$1" label="$2"
        local size
        size=$(_dir_size_mb "$target")
        if [ -e "$target" ]; then
            rm -rf "$target"
            _ok "已清理 ${label} (${size}MB)"
            total_freed=$((total_freed + size))
        else
            _info "跳过 ${label} (不存在)"
        fi
    }

    # ═══════════════════════════════════════════════════════════════════════
    # Level 1: cache — Python/前端缓存 + 日志 + 临时文件
    # ═══════════════════════════════════════════════════════════════════════
    _info "[cache] 清理缓存文件..."

    # Python 缓存
    find backend -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
    find backend -type f -name '*.pyc' -delete 2>/dev/null || true
    _rm_report "backend/.pytest_cache" "Python pytest 缓存"

    # 前端 ESLint/Prettier 缓存
    _rm_report "frontend/.eslintcache" "ESLint 缓存"

    # 日志文件（清空而非删除，保留文件）
    for log in "$LOG_DIR"/*.log; do
        if [ -f "$log" ]; then
            local log_size
            log_size=$(du -sm "$log" 2>/dev/null | cut -f1)
            :> "$log"
            total_freed=$((total_freed + log_size))
        fi
    done
    _ok "已清空日志文件"

    # Nginx 临时文件
    _rm_report "$REPO_ROOT/temp" "Nginx 临时文件"

    # PID 文件
    _rm_report "$PID_DIR" "PID 文件"

    # ═══════════════════════════════════════════════════════════════════════
    # Level 2: build — 前端构建产物 + TypeScript 构建信息 (包含 cache)
    # ═══════════════════════════════════════════════════════════════════════
    if [ "$level" = "build" ] || [ "$level" = "all" ]; then
        _info "[build] 清理构建产物..."

        # 前端 .next 构建缓存
        _rm_report "frontend/.next" "前端 .next 构建缓存"
        _rm_report "frontend/tsconfig.tsbuildinfo" "TypeScript 构建信息"

        # 前端输出目录
        _rm_report "frontend/out" "前端静态导出"
    fi

    # ═══════════════════════════════════════════════════════════════════════
    # Level 3: all — 深度清理 (包含 build + cache)
    # ═══════════════════════════════════════════════════════════════════════
    if [ "$level" = "all" ]; then
        _info "[all] 深度清理..."

        # 前端 node_modules 缓存
        _rm_report "frontend/node_modules/.cache" "node_modules 缓存"

        # 运行时用户数据（线程、内存等）
        _rm_report ".kkoclaw" "KKOCLAW 运行时数据"

        # 沙箱容器清理
        _info "清理沙箱容器..."
        "$REPO_ROOT/scripts/cleanup-containers.sh" kkoclaw-sandbox 2>/dev/null || true
    fi

    # ── 汇总 ────────────────────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}${BOLD}=========================================="
    echo -e "  \u2713 清理完成!  共释放约 ${total_freed}MB"
    echo -e "==========================================${NC}"
    echo ""
    echo "  提示: 运行 './start.sh start' 重新启动服务"
    echo ""
}

# ── 生成 Nginx 配置 ──────────────────────────────────────────────────────────

generate_nginx_config() {
    mkdir -p "$(dirname "$NGINX_TEMP_CONF")"
    sed -e "s/listen 9191/listen $NGINX_PORT/g" \
        -e "s/listen \[::\]:9191/listen [::]:$NGINX_PORT/g" \
        -e "s/server 127.0.0.1:9193/server 127.0.0.1:$GATEWAY_PORT/g" \
        -e "s/server 127.0.0.1:9192/server 127.0.0.1:$FRONTEND_PORT/g" \
        "$REPO_ROOT/docker/nginx/nginx.local.conf" > "$NGINX_TEMP_CONF"
}

# ── 启动 Docker 生产环境 ──────────────────────────────────────────────────

start_docker() {
    # 先停止已有 Docker 服务
    stop_docker
    sleep 1

    # ── 检查 Docker 环境 ─────────────────────────────────────────────────
    if ! command -v docker >/dev/null 2>&1; then
        _err "未安装 Docker，请先安装: https://docs.docker.com/get-docker/"
        return 1
    fi
    if ! docker info >/dev/null 2>&1; then
        _err "Docker 守护进程未运行，请先启动 Docker"
        return 1
    fi

    # ── Banner ────────────────────────────────────────────────────────────
    _banner
    echo -e "  ${BOLD}模式:${NC} DOCKER (生产容器化部署)"
    echo ""
    echo -e "    ${CYAN}Nginx${NC}       → localhost:${BOLD}$NGINX_PORT${NC}  (反向代理入口)"
    echo ""

    # ── 分步构建和启动（避免 OOM 搞挂 Docker daemon）────────────────────
    local rebuild=false
    [ "${2:-}" = "--rebuild" ] && rebuild=true

    # 设置 compose 所需的环境变量
    _export_compose_env

    COMPOSE_CMD="docker compose --env-file $REPO_ROOT/.env -p kkoclaw -f $REPO_ROOT/docker/docker-compose.yaml"

    # 检查是否需要构建
    if $rebuild || ! docker image inspect kkoclaw-gateway >/dev/null 2>&1 || \
       ! docker image inspect kkoclaw-frontend >/dev/null 2>&1; then
        _info "构建镜像（单线程构建以降低内存峰值）..."
        echo ""
        DOCKER_BUILDKIT=1 $COMPOSE_CMD build --parallel 1 || {
            _err "构建失败，请检查 Docker Desktop 内存设置（建议 ≥8GB）"
            return 1
        }
    else
        _ok "镜像已存在，跳过构建（如需强制重建: ./start.sh start docker --rebuild）"
    fi

    # 启动容器
    _info "启动容器..."
    echo ""
    $COMPOSE_CMD up -d --remove-orphans frontend gateway nginx

    echo ""
    echo -e "  ${BOLD}🌐 http://localhost:$NGINX_PORT${NC}"
    echo ""
    echo -e "  ${CYAN}服务管理:${NC}"
    echo "    ./start.sh stop      停止服务"
    echo "    ./start.sh status    查看状态"
    echo "    ./start.sh logs      查看日志"
    echo "    ./start.sh restart   重启服务"
    echo ""
}

# ── 启动所有服务 ────────────────────────────────────────────────────────────

start_all() {
    local mode="$1"

    # 先停止已有本地服务
    stop_local_all
    sleep 1

    # 创建必要目录
    mkdir -p "$LOG_DIR" "$PID_DIR"
    mkdir -p temp/client_body_temp temp/proxy_temp temp/fastcgi_temp temp/uwsgi_temp temp/scgi_temp

    # ── 模式配置 ──────────────────────────────────────────────────────────
    if [ "$mode" = "prod" ]; then
        MODE_LABEL="PROD (生产模式)"
    else
        MODE_LABEL="DEV (开发模式，热重载)"
    fi

    # ── Banner ────────────────────────────────────────────────────────────
    _banner
    echo -e "  ${BOLD}模式:${NC} $MODE_LABEL"
    echo ""
    echo "  服务端口:"
    echo -e "    ${CYAN}Gateway${NC}     → localhost:${BOLD}$GATEWAY_PORT${NC}  (REST API + Agent)"
    echo -e "    ${CYAN}Frontend${NC}    → localhost:${BOLD}$FRONTEND_PORT${NC}  (Next.js)"
    echo -e "    ${CYAN}Nginx${NC}       → localhost:${BOLD}$NGINX_PORT${NC}  (反向代理)"
    echo ""

    # 同步依赖（可选跳过）
    if [ "$SKIP_INSTALL" != "true" ]; then
        _info "同步依赖..."
        (cd backend && uv sync --quiet) || { _err "后端依赖安装失败"; return 1; }
        (cd frontend && pnpm install --silent) || { _err "前端依赖安装失败"; return 1; }
        _ok "依赖同步完成"
    fi

    # ── 逐个启动服务（失败时回滚）───────────────────────────────────────────
    start_gateway "$mode"  || { _err "Gateway 启动失败，停止所有本地服务"; stop_local_all; return 1; }
    start_frontend "$mode" || { _err "Frontend 启动失败，停止所有本地服务"; stop_local_all; return 1; }
    start_nginx_svc        || { _warn "Nginx 启动失败，Gateway/Frontend 仍在运行"; }

    # ── 启动完成 ──────────────────────────────────────────────────────────
    echo ""
    echo -e "${GREEN}${BOLD}=========================================="
    echo "  ✓ KKOCLAW 启动完成!  [$MODE_LABEL]"
    echo -e "==========================================${NC}"
    echo ""
    echo -e "  ${BOLD}🌐 http://localhost:$NGINX_PORT${NC}"
    echo ""
    echo -e "  ${CYAN}服务管理:${NC}"
    echo "    ./start.sh stop      停止服务"
    echo "    ./start.sh status    查看状态"
    echo "    ./start.sh logs      查看日志"
    echo "    ./start.sh restart   重启服务"
    echo ""
    echo -e "  ${CYAN}日志文件:${NC}"
    echo "    $GATEWAY_LOG"
    echo "    $FRONTEND_LOG"
    echo "    $NGINX_LOG"
    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════════
# 主入口
# ═══════════════════════════════════════════════════════════════════════════════

COMMAND="${1:-help}"
OPTION="${2:-}"

# ── 参数解析辅助 ─────────────────────────────────────────────────────────────
_is_service() { case "$1" in gateway|frontend|nginx|all) return 0;; *) return 1;; esac; }
_is_mode()    { case "$1" in dev|prod|docker) return 0;; *) return 1;; esac; }

case "$COMMAND" in
    start)
        # docker 模式特殊处理
        if [ "$OPTION" = "docker" ]; then
            start_docker || exit 1
        elif _is_service "$OPTION"; then
            svc="$OPTION"; mode="${3:-dev}"
            if [ "$mode" = "docker" ]; then
                _err "Docker 模式不支持单独启动服务，请使用: ./start.sh start docker"
                exit 1
            fi
            case "$svc" in
                gateway)  start_gateway "$mode" || exit 1 ;;
                frontend) start_frontend "$mode" || exit 1 ;;
                nginx)    start_nginx_svc || exit 1 ;;
            esac
        elif _is_mode "$OPTION" || [ -z "$OPTION" ]; then
            mode="${2:-dev}"
            if [ "$mode" = "docker" ]; then
                start_docker || exit 1
            else
                start_all "$mode" || exit 1
            fi
        else
            _err "未知参数: $OPTION"
            echo "用法: ./start.sh start [gateway|frontend|nginx|all] [dev|prod|docker]"
            exit 1
        fi
        ;;

    stop)
        # 模式参数必填
        stop_mode="${2:-}"
        if [ -z "$stop_mode" ]; then
            echo ""
            _err "stop 命令必须指定模式参数"
            echo ""
            echo "  用法: ./start.sh stop <dev|prod|docker> [gateway|frontend|nginx|all]"
            echo ""
            echo "  ./start.sh stop docker           # 停止 Docker 容器服务"
            echo "  ./start.sh stop dev              # 停止开发模式服务"
            echo "  ./start.sh stop prod             # 停止本地生产模式服务"
            echo "  ./start.sh stop docker gateway   # 仅停止 Docker 中的 Gateway"
            echo ""
            exit 1
        fi
        stop_svc="${3:-all}"
        case "$stop_mode" in
            docker)
                # Docker 模式：只通过 docker compose 操作，不碰本地进程
                case "$stop_svc" in
                    all)      stop_docker ;;
                    gateway|frontend|nginx)
                        _info "停止 Docker 容器: $stop_svc..."
                        $DOCKER_COMPOSE_CMD stop "$stop_svc" 2>/dev/null || true
                        _ok "$stop_svc 容器已停止"
                        ;;
                    *)
                        _err "未知服务: $stop_svc (可选: gateway, frontend, nginx, all)"
                        exit 1
                        ;;
                esac
                ;;
            dev|prod)
                # 本地模式：通过 PID 文件 + 端口释放停止，不碰 Docker
                case "$stop_svc" in
                    all)      stop_local_all ;;
                    gateway)  stop_gateway ;;
                    frontend) stop_frontend ;;
                    nginx)    stop_nginx_svc ;;
                    *)
                        _err "未知服务: $stop_svc (可选: gateway, frontend, nginx, all)"
                        exit 1
                        ;;
                esac
                ;;
            *)
                _err "未知模式: $stop_mode (可选: dev, prod, docker)"
                echo "  用法: ./start.sh stop <dev|prod|docker> [服务]"
                exit 1
                ;;
        esac
        ;;

    restart)
        if [ "$OPTION" = "docker" ]; then
            stop_docker; sleep 1; start_docker || exit 1
        elif _is_service "$OPTION"; then
            svc="$OPTION"; mode="${3:-dev}"
            if [ "$mode" = "docker" ]; then
                _err "Docker 模式不支持单独重启服务，请使用: ./start.sh restart docker"
                exit 1
            fi
            case "$svc" in
                gateway)  stop_gateway; sleep 1; start_gateway "$mode" || exit 1 ;;
                frontend) stop_frontend; sleep 1; start_frontend "$mode" || exit 1 ;;
                nginx)    stop_nginx_svc; sleep 1; start_nginx_svc || exit 1 ;;
            esac
        elif _is_mode "$OPTION" || [ -z "$OPTION" ]; then
            mode="${2:-dev}"
            if [ "$mode" = "docker" ]; then
                stop_docker; sleep 1; start_docker || exit 1
            else
                stop_local_all; sleep 1; start_all "$mode" || exit 1
            fi
        else
            _err "未知参数: $OPTION"
            echo "用法: ./start.sh restart [gateway|frontend|nginx|all] [dev|prod|docker]"
            exit 1
        fi
        ;;

    status)
        show_status
        ;;

    logs)
        show_logs "${2:-all}"
        ;;

    clean)
        case "${2:-cache}" in
            cache|build|all)
                clean_resources "${2:-cache}"
                ;;
            *)
                _err "未知清理级别: ${2} (可选: cache, build, all)"
                echo ""
                echo "用法: ./start.sh clean [cache|build|all]"
                exit 1
                ;;
        esac
        ;;

    -h|--help|help)
        show_help
        ;;

    *)
        _err "未知命令: $COMMAND"
        echo ""
        show_help
        exit 1
        ;;
esac
