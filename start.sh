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
#
# 服务:
#   all        所有服务（默认）
#   gateway    后端服务 (Gateway)
#   frontend   前端服务 (Frontend)
#   nginx      反向代理 (Nginx)
#
# 模式:
#   dev    开发模式 — 热重载，适合日常开发（默认）
#   prod   生产模式 — 预构建前端，优化运行
#
# 示例:
#   ./start.sh start                    # 开发模式启动所有服务
#   ./start.sh start gateway            # 仅启动 Gateway
#   ./start.sh start frontend prod      # 仅启动 Frontend（生产模式）
#   ./start.sh stop                     # 停止所有服务
#   ./start.sh stop gateway             # 仅停止 Gateway
#   ./start.sh restart frontend         # 重启 Frontend
#   ./start.sh status                   # 查看状态
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
    echo "用法: ./start.sh <命令> [服务] [模式]"
    echo ""
    echo "命令:"
    echo "  start [服务] [模式]   启动服务（默认: all dev）"
    echo "  stop [服务]          停止服务（默认: all）"
    echo "  restart [服务] [模式] 重启服务（默认: all dev）"
    echo "  status               查看服务运行状态"
    echo "  logs [service]       查看服务日志"
    echo ""
    echo "服务:"
    echo "  all        所有服务（默认）"
    echo "  gateway    后端服务 (Gateway)"
    echo "  frontend   前端服务 (Frontend)"
    echo "  nginx      反向代理 (Nginx)"
    echo ""
    echo "模式:"
    echo "  dev        开发模式 — 热重载，适合日常开发"
    echo "  prod       生产模式 — 预构建前端，优化运行"
    echo ""
    echo "日志服务名:"
    echo "  gateway  |  frontend  |  nginx  |  all（默认）"
    echo ""
    echo "示例:"
    echo "  ./start.sh start                    # 开发模式启动所有服务"
    echo "  ./start.sh start prod               # 生产模式启动所有服务"
    echo "  ./start.sh start gateway            # 仅启动 Gateway"
    echo "  ./start.sh start frontend prod      # 仅启动 Frontend（生产模式）"
    echo "  ./start.sh stop                     # 停止所有服务"
    echo "  ./start.sh stop gateway             # 仅停止 Gateway"
    echo "  ./start.sh restart frontend         # 重启 Frontend"
    echo "  ./start.sh status                   # 查看状态"
    echo "  ./start.sh logs                     # 查看所有日志"
    echo "  ./start.sh logs gateway             # 仅查看 Gateway 日志"
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
    if [ "$mode" != "prod" ]; then
        gateway_flags="--reload --reload-include='*.yaml' --reload-include='.env' --reload-exclude='*.pyc' --reload-exclude='__pycache__' --reload-exclude='sandbox/' --reload-exclude='.kkoclaw/'"
    fi

    # 停止已有的 Gateway
    stop_gateway

    _info "启动 Gateway..."
    :> "$GATEWAY_LOG"
    nohup sh -c "cd backend && KKOCLAW_PROJECT_ROOT=\"$REPO_ROOT\" PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port $GATEWAY_PORT $gateway_flags" \
        > "$GATEWAY_LOG" 2>&1 &
    local gpid=$!
    disown $gpid 2>/dev/null || true
    _write_pid "$GATEWAY_PID_FILE" "$gpid"

    if _wait_for_port "$GATEWAY_PORT" 30 "Gateway"; then
        _ok "Gateway 已启动  PID: $gpid  端口: $GATEWAY_PORT"
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

# ── 停止所有服务 ─────────────────────────────────────────────────────────────

stop_all() {
    echo ""
    _info "正在停止所有服务..."

    stop_nginx_svc
    stop_gateway
    stop_frontend

    # 清理临时文件
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

# ── 启动所有服务 ────────────────────────────────────────────────────────────

start_all() {
    local mode="$1"

    # 先停止已有服务
    stop_all
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
    start_gateway "$mode"  || { _err "Gateway 启动失败，停止所有服务"; stop_all; return 1; }
    start_frontend "$mode" || { _err "Frontend 启动失败，停止所有服务"; stop_all; return 1; }
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
_is_mode()    { case "$1" in dev|prod) return 0;; *) return 1;; esac; }

case "$COMMAND" in
    start)
        if _is_service "$OPTION"; then
            svc="$OPTION"; mode="${3:-dev}"
        elif _is_mode "$OPTION" || [ -z "$OPTION" ]; then
            svc="all"; mode="${2:-dev}"
        else
            _err "未知参数: $OPTION"
            echo "用法: ./start.sh start [gateway|frontend|nginx|all] [dev|prod]"
            exit 1
        fi
        case "$svc" in
            gateway)  start_gateway "$mode" || exit 1 ;;
            frontend) start_frontend "$mode" || exit 1 ;;
            nginx)    start_nginx_svc || exit 1 ;;
            all)      start_all "$mode" || exit 1 ;;
        esac
        ;;

    stop)
        svc="${2:-all}"
        case "$svc" in
            gateway)  stop_gateway ;;
            frontend) stop_frontend ;;
            nginx)    stop_nginx_svc ;;
            all)      stop_all ;;
            *)
                _err "未知服务: $svc (可选: gateway, frontend, nginx, all)"
                exit 1
                ;;
        esac
        ;;

    restart)
        if _is_service "$OPTION"; then
            svc="$OPTION"; mode="${3:-dev}"
        elif _is_mode "$OPTION" || [ -z "$OPTION" ]; then
            svc="all"; mode="${2:-dev}"
        else
            _err "未知参数: $OPTION"
            echo "用法: ./start.sh restart [gateway|frontend|nginx|all] [dev|prod]"
            exit 1
        fi
        case "$svc" in
            gateway)  stop_gateway; sleep 1; start_gateway "$mode" || exit 1 ;;
            frontend) stop_frontend; sleep 1; start_frontend "$mode" || exit 1 ;;
            nginx)    stop_nginx_svc; sleep 1; start_nginx_svc || exit 1 ;;
            all)      stop_all; sleep 1; start_all "$mode" || exit 1 ;;
        esac
        ;;

    status)
        show_status
        ;;

    logs)
        show_logs "${2:-all}"
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
