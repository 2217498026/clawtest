#!/usr/bin/env bash
# =============================================================================
# pkg-preinstall.sh
# macOS .pkg 安装包 preinstall 脚本（轻量安全版）
#
# 功能：
#   1. 通过 Homebrew 自动安装 Node.js（若版本不足）
#   2. 不调用 installer -pkg（避免与主安装器进程锁冲突）
#   3. 正确获取当前控制台用户（不走 $HOME=/var/root）
#   4. 任何情况均 exit 0（不阻塞 .pkg 安装）
#
# OpenClaw CLI 的完整安装交由 App 首次启动时处理。
# =============================================================================

set -uo pipefail

# ------------ 获取实际控制台用户 ------------
# 在 .pkg preinstall 中运行于 root（$HOME=/var/root）
# 需要用以下方法获取当前登录用户
get_console_user() {
    local user=""

    # 方法1: scutil（最可靠）
    if command -v scutil >/dev/null 2>&1; then
        user="$(echo "show State:/Users/ConsoleUser" | scutil 2>/dev/null | awk '/Name :/ {print $3}')"
    fi

    # 方法2: stat /dev/console（兜底）
    if [ -z "$user" ] && [ -c /dev/console ]; then
        user="$(stat -f '%Su' /dev/console 2>/dev/null || true)"
    fi

    # 方法3: logname（最后兜底）
    if [ -z "$user" ]; then
        user="$(logname 2>/dev/null || true)"
    fi

    # 回退为当前用户
    if [ -z "$user" ]; then
        user="$(id -un 2>/dev/null || echo "unknown")"
    fi

    printf '%s' "$user"
}

get_console_home() {
    local user="$1"
    local home=""

    # 方法1: dscl
    if command -v dscl >/dev/null 2>&1; then
        home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
    fi

    # 方法2: eval ~username
    if [ -z "$home" ] || [ ! -d "$home" ]; then
        home="$(eval "echo ~${user}" 2>/dev/null || true)"
    fi

    # 方法3: /Users/username
    if [ -z "$home" ] || [ ! -d "$home" ]; then
        home="/Users/$user"
    fi

    # 回退
    if [ ! -d "$home" ]; then
        home="$HOME"
    fi

    printf '%s' "$home"
}

# ------------ 日志 ------------
CONSOLE_USER="$(get_console_user)"
CONSOLE_HOME="$(get_console_home "$CONSOLE_USER")"

LOG_DIR="$CONSOLE_HOME/Library/Logs/OpenClaw"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG_FILE="$LOG_DIR/pkg-preinstall-$(date +%Y%m%d-%H%M%S).log"

write_log() {
    local ts="$(date '+%Y-%m-%d %H:%M:%S')"
    printf '[%s] %s\n' "$ts" "$*" >>"$LOG_FILE" 2>/dev/null || true
}

write_info() { printf '[INFO] %s\n' "$*"; write_log "INFO: $*"; }
write_warn() { printf '[WARN] %s\n' "$*" >&2; write_log "WARN: $*"; }
write_ok()   { printf '[OK]   %s\n' "$*"; write_log "OK: $*"; }

# ------------ Homebrew 检测 ------------
BREW_PREFIX=""
BREW_BIN=""

detect_brew() {
    if [ -x /opt/homebrew/bin/brew ]; then
        BREW_PREFIX="/opt/homebrew"
        BREW_BIN="/opt/homebrew/bin"
        write_info "检测到 Homebrew (Apple Silicon): $BREW_PREFIX"
        return 0
    fi
    if [ -x /usr/local/bin/brew ]; then
        BREW_PREFIX="/usr/local"
        BREW_BIN="/usr/local/bin"
        write_info "检测到 Homebrew (Intel): $BREW_PREFIX"
        return 0
    fi
    write_info "未检测到 Homebrew"
    return 1
}

# ------------ 版本比较 ------------
NODE_REQUIRED_VERSION="24.15.0"

version_ge() {
    local lower
    lower="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
    [ "$lower" = "$2" ]
}

get_installed_node_version() {
    local node_bin ver
    node_bin="$(command -v node 2>/dev/null || true)"
    if [ -z "$node_bin" ]; then
        local p
        for p in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/opt/homebrew/opt/node@24/bin/node"; do
            if [ -x "$p" ]; then node_bin="$p"; break; fi
        done
    fi
    if [ -z "$node_bin" ]; then
        printf ''
        return 1
    fi
    ver="$("$node_bin" --version 2>/dev/null | tr -d 'v\r\n' || true)"
    printf '%s' "$ver"
}

# ------------ Node.js 安装（仅 Homebrew） ------------
# 注意：不使用 installer -pkg 安装 Node.js，
# 因为 .pkg preinstall 运行时 installer 进程已被占用，冲突会导致安装失败。
install_node_via_brew() {
    [ -z "${BREW_BIN:-}" ] && return 1
    write_info "通过 Homebrew 安装 node@24（目标 v$NODE_REQUIRED_VERSION）..."
    "$BREW_BIN/brew" update >>"$LOG_FILE" 2>&1 || true
    if "$BREW_BIN/brew" install node@24 >>"$LOG_FILE" 2>&1; then
        "$BREW_BIN/brew" link --overwrite --force node@24 >>"$LOG_FILE" 2>&1 || true
        write_ok "Homebrew 安装 node@24 成功"
        return 0
    fi
    write_warn "brew install node@24 失败，尝试 brew install node"
    if "$BREW_BIN/brew" install node >>"$LOG_FILE" 2>&1; then
        write_ok "Homebrew 安装 node 成功"
        return 0
    fi
    return 1
}

# ------------ 主入口 ------------
main() {
    write_info "=========================================="
    write_info " ClawPanel .pkg preinstall 脚本"
    write_info " 控制台用户: $CONSOLE_USER"
    write_info " 用户主目录: $CONSOLE_HOME"
    write_info "=========================================="

    # 检测 Homebrew
    detect_brew

    # 检查 Node.js 版本
    local current_ver
    current_ver="$(get_installed_node_version)"

    if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
        write_ok "Node.js 已满足要求: v$current_ver (≥ v$NODE_REQUIRED_VERSION)"
    else
        if [ -z "$current_ver" ]; then
            write_info "未检测到 Node.js，尝试通过 Homebrew 安装"
        else
            write_info "当前 Node.js v$current_ver 低于 v$NODE_REQUIRED_VERSION，尝试升级"
        fi

        if [ -n "${BREW_BIN:-}" ]; then
            if install_node_via_brew; then
                current_ver="$(get_installed_node_version)"
                write_ok "Node.js 安装结果: v${current_ver:-未知}"
            else
                write_warn "Homebrew 安装 Node.js 失败"
                write_warn "不影响 ClawPanel App 安装，首次启动时 App 会引导安装"
            fi
        else
            write_info "未安装 Homebrew，跳过 Node.js 自动安装"
            write_info "请确保已安装 Node.js $NODE_REQUIRED_VERSION+，或首次启动后由 App 引导安装"
        fi
    fi

    # 保存实际用户信息供 App 首次启动时使用
    local marker_dir="$LOG_DIR"
    printf '%s\n' "$CONSOLE_USER" > "$marker_dir/pkg-installed-user.txt" 2>/dev/null || true

    write_info "=========================================="
    write_info " preinstall 完成（始终 exit 0，不阻塞安装）"
    write_info " 日志: $LOG_FILE"
    write_info "=========================================="
}

main "$@"
exit 0
