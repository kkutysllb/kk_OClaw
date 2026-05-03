#!/usr/bin/env bash
#
# start.sh — KKOCLAW 一键启动脚本
#
# 命令:
#   ./start.sh start [dev|prod]     启动所有服务（默认: dev 开发模式）
#   ./start.sh stop                 停止所有服务
#   ./start.sh restart [dev|prod]   重启所有服务
#   ./start.sh status               查看服务运行状态
#   ./start.sh logs [service]       查看服务日志
#
# 模式:
#   dev    开发模式 — 热重载，适合日常开发（默认）
#   prod   生产模式 — 预构建前端，优化运行
#
# 示例:
#   ./start.sh start                # 开发模式启动
#   ./start.sh start prod           # 生产模式启动
#   ./start.sh stop                 # 停止所有服务
#   ./start.sh restart dev          # 重启（开发模式）
#   ./start.sh status               # 查看状态
#   ./start.sh logs                 # 查看所有日志
#   ./start.sh logs gateway         # 仅查看 Gateway 日志

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

# 强制释放端口
_kill_port() {
    local port=$1
    local pid
    pid=$(lsof -ti ":$port" 2>/dev/null) || true
    if [ -n "$pid" ]; then
        kill -9 $pid 2>/dev/null || true
    fi
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
    echo "用法: ./start.sh <命令> [选项]"
    echo ""
    echo "命令:"
    echo "  start [dev|prod]     启动所有服务（默认: dev）"
    echo "  stop                 停止所有服务"
    echo "  restart [dev|prod]   重启所有服务"
    echo "  status               查看服务运行状态"
    echo "  logs [service]       查看服务日志"
    echo ""
    echo "模式:"
    echo "  dev      开发模式 — 热重载，适合日常开发"
    echo "  prod     生产模式 — 预构建前端，优化运行"
    echo ""
    echo "日志服务名:"
    echo "  gateway  |  frontend  |  nginx  |  all（默认）"
    echo ""
    echo "示例:"
    echo "  ./start.sh start              # 开发模式启动"
    echo "  ./start.sh start prod         # 生产模式启动"
    echo "  ./start.sh stop               # 停止所有"
    echo "  ./start.sh restart dev        # 重启（开发模式）"
    echo "  ./start.sh status             # 查看状态"
    echo "  ./start.sh logs               # 查看所有日志"
    echo "  ./start.sh logs gateway       # 仅查看 Gateway 日志"
}

# ── 停止所有服务 ─────────────────────────────────────────────────────────────

stop_all() {
    echo ""
    _info "正在停止所有服务..."

    # ── 1. Nginx ────────────────────────────────────────────────────────
    # 优雅停止：通过配置文件路径定位 nginx 实例
    if [ -f "$NGINX_TEMP_CONF" ]; then
        nginx -c "$NGINX_TEMP_CONF" -p "$REPO_ROOT" -s quit 2>/dev/null || true
    fi
    nginx -c "$REPO_ROOT/docker/nginx/nginx.local.conf" -p "$REPO_ROOT" -s quit 2>/dev/null || true
    sleep 1
    # 如果优雅停止失败，通过 PID 文件强制终止
    _kill_by_pidfile "$NGINX_PID_FILE" "Nginx"

    # ── 2. 通过 PID 文件停止（首选方式，精确）───────────────────────────
    _kill_by_pidfile "$GATEWAY_PID_FILE" "Gateway"
    _kill_by_pidfile "$FRONTEND_PID_FILE" "Frontend"

    sleep 1

    # ── 3. 端口兜底释放（仅释放本项目端口，不影响其他项目）─────────────
    _kill_port $GATEWAY_PORT
    _kill_port $FRONTEND_PORT
    _kill_port $NGINX_PORT

    # ── 4. 清理临时文件 ─────────────────────────────────────────────────
    rm -f "$NGINX_TEMP_CONF" 2>/dev/null || true
    rm -rf "$PID_DIR" 2>/dev/null || true
    ./scripts/cleanup-containers.sh kkoclaw-sandbox 2>/dev/null || true

    _ok "所有服务已停止"
    echo ""
}

# ── 服务状态 ─────────────────────────────────────────────────────────────────

show_status() {
    _banner
    echo -e "${BOLD}服务运行状态${NC}"
    echo "──────────────────────────────────────────────"
    echo ""

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

# ── 生成 Nginx 配置 ──────────────────────────────────────────────────────────

generate_nginx_config() {
    mkdir -p "$(dirname "$NGINX_TEMP_CONF")"
    sed -e "s/listen 9191/listen $NGINX_PORT/g" \
        -e "s/listen \[::\]:9191/listen [::]:$NGINX_PORT/g" \
        -e "s/server 127.0.0.1:9193/server 127.0.0.1:$GATEWAY_PORT/g" \
        -e "s/server 127.0.0.1:9192/server 127.0.0.1:$FRONTEND_PORT/g" \
        "$REPO_ROOT/docker/nginx/nginx.local.conf" > "$NGINX_TEMP_CONF"
}

# ── 启动服务 ─────────────────────────────────────────────────────────────────

start_all() {
    local mode="$1"

    # 前置检查
    if ! { \
            [ -n "$KKOCLAW_CONFIG_PATH" ] && [ -f "$KKOCLAW_CONFIG_PATH" ] || \
            [ -f backend/config.yaml ] || \
            [ -f config.yaml ]; \
        }; then
        _err "未找到 config.yaml 配置文件"
        echo "  请运行 'make setup' 或 'make config' 生成配置"
        exit 1
    fi

    # 先停止已有服务
    stop_all
    sleep 1

    # 创建必要目录
    mkdir -p "$LOG_DIR" "$PID_DIR"
    mkdir -p temp/client_body_temp temp/proxy_temp temp/fastcgi_temp temp/uwsgi_temp temp/scgi_temp

    # ── 模式配置 ──────────────────────────────────────────────────────────

    if [ "$mode" = "prod" ]; then
        MODE_LABEL="PROD (生产模式)"
        GATEWAY_EXTRA_FLAGS=""
        # 生产模式: 构建并启动
        if command -v python3 >/dev/null 2>&1; then
            PYTHON_BIN="python3"
        elif command -v python >/dev/null 2>&1; then
            PYTHON_BIN="python"
        else
            _err "需要 Python 来生成 BETTER_AUTH_SECRET"
            exit 1
        fi
        FRONTEND_CMD="env BETTER_AUTH_SECRET=$($PYTHON_BIN -c 'import secrets; print(secrets.token_hex(16))') pnpm run preview"
    else
        MODE_LABEL="DEV (开发模式，热重载)"
        GATEWAY_EXTRA_FLAGS="--reload --reload-include='*.yaml' --reload-include='.env' --reload-exclude='*.pyc' --reload-exclude='__pycache__' --reload-exclude='sandbox/' --reload-exclude='.kkoclaw/'"
        FRONTEND_CMD="pnpm run dev"
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
        (cd backend && uv sync --quiet) || { _err "后端依赖安装失败"; exit 1; }
        (cd frontend && pnpm install --silent) || { _err "前端依赖安装失败"; exit 1; }
        _ok "依赖同步完成"
    fi

    # ── 1. Gateway ────────────────────────────────────────────────────────

    _info "启动 Gateway..."
    # 清空旧日志（每次重启重写）
    :> "$GATEWAY_LOG"
    nohup sh -c "cd backend && KKOCLAW_PROJECT_ROOT=\"$REPO_ROOT\" PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port $GATEWAY_PORT $GATEWAY_EXTRA_FLAGS" \
        > "$GATEWAY_LOG" 2>&1 &
    local gpid=$!
    disown $gpid 2>/dev/null || true
    _write_pid "$GATEWAY_PID_FILE" "$gpid"

    if _wait_for_port "$GATEWAY_PORT" 30 "Gateway"; then
        _ok "Gateway 已启动  PID: $gpid  端口: $GATEWAY_PORT"
    else
        _err "Gateway 启动失败，查看日志: $GATEWAY_LOG"
        tail -20 "$GATEWAY_LOG"
        exit 1
    fi

    # ── 2. Frontend ───────────────────────────────────────────────────────

    _info "启动 Frontend..."
    :> "$FRONTEND_LOG"
    nohup sh -c "cd frontend && PORT=$FRONTEND_PORT $FRONTEND_CMD" \
        > "$FRONTEND_LOG" 2>&1 &
    local fpid=$!
    disown $fpid 2>/dev/null || true
    _write_pid "$FRONTEND_PID_FILE" "$fpid"

    if _wait_for_port "$FRONTEND_PORT" 120 "Frontend"; then
        _ok "Frontend 已启动  PID: $fpid  端口: $FRONTEND_PORT"
    else
        _err "Frontend 启动失败，查看日志: $FRONTEND_LOG"
        tail -20 "$FRONTEND_LOG"
        stop_all
        exit 1
    fi

    # ── 3. Nginx ──────────────────────────────────────────────────────────

    if ! command -v nginx >/dev/null 2>&1; then
        _warn "未安装 Nginx，跳过反向代理启动"
        echo ""
        echo "  服务直接访问:"
        echo "    Gateway:  http://localhost:$GATEWAY_PORT"
        echo "    Frontend: http://localhost:$FRONTEND_PORT"
        echo ""
        return 0
    fi

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
        stop_all
        exit 1
    fi

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
OPTION="${2:-dev}"

case "$COMMAND" in
    start)
        case "$OPTION" in
            dev|prod)  start_all "$OPTION" ;;
            *)
                _err "未知模式: $OPTION (可选: dev, prod)"
                echo "用法: ./start.sh start [dev|prod]"
                exit 1
                ;;
        esac
        ;;

    stop)
        stop_all
        ;;

    restart)
        case "$OPTION" in
            dev|prod)
                echo "重启服务（模式: $OPTION）..."
                stop_all
                sleep 1
                start_all "$OPTION"
                ;;
            *)
                _err "未知模式: $OPTION (可选: dev, prod)"
                echo "用法: ./start.sh restart [dev|prod]"
                exit 1
                ;;
        esac
        ;;

    status)
        show_status
        ;;

    logs)
        show_logs "$OPTION"
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
