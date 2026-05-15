#!/usr/bin/env bash
# =============================================================================
# install-openclaw.sh
# 通过国内镜像源安装指定版本的 openclaw 并完成 Gateway 安装（macOS 版）
#
# 与 install-openclaw.ps1 功能等效，适配 macOS 11+（Intel & Apple Silicon）。
#
# 用法：
#   ./install-openclaw.sh
#   ./install-openclaw.sh --version 2026.4.11 --source domestic
#   ./install-openclaw.sh --force
#   ./install-openclaw.sh --silent
#
# 退出码：
#   0  成功
#   1  失败（npm 未找到 / 镜像源全部失败 / 异常）
# =============================================================================

set -u
# 与 PowerShell 脚本保持一致：不要遇错即退（许多 Write-Warn 是非致命的）
# set -e 不开启，关键步骤手动检查 $?

# ------------ 默认参数 ------------
VERSION="2026.4.11"
SOURCE="official"           # official | domestic
REGISTRY="https://registry.npmmirror.com"
FORCE=0
SILENT=0

# ------------ 颜色 ------------
if [ -t 1 ]; then
    C_INFO="\033[36m"      # Cyan
    C_OK="\033[32m"        # Green
    C_WARN="\033[33m"      # Yellow
    C_ERR="\033[31m"       # Red
    C_GRAY="\033[90m"
    C_RESET="\033[0m"
else
    C_INFO=""; C_OK=""; C_WARN=""; C_ERR=""; C_GRAY=""; C_RESET=""
fi

# ------------ 日志 ------------
LOG_DIR="$HOME/Library/Logs/OpenClaw"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG_FILE="$LOG_DIR/openclaw-install-$(date +%Y%m%d-%H%M%S).log"
LOG_FILE_FIXED="$LOG_DIR/openclaw-install.log"
LOG_FIRST_WRITE=1

write_log() {
    local ts msg line
    ts="$(date '+%Y-%m-%d %H:%M:%S')"
    msg="$1"
    line="[$ts] $msg"
    printf '%s\n' "$line" >>"$LOG_FILE" 2>/dev/null || true
    if [ "$LOG_FIRST_WRITE" = "1" ]; then
        printf '%s\n' "$line" >"$LOG_FILE_FIXED" 2>/dev/null || true
        LOG_FIRST_WRITE=0
    else
        printf '%s\n' "$line" >>"$LOG_FILE_FIXED" 2>/dev/null || true
    fi
}

write_colored() {
    local color="$1" label="$2" msg="$3"
    printf "${color}[%s]${C_RESET} %s\n" "$label" "$msg"
    write_log "[$label] $msg"
}

write_info() { write_colored "$C_INFO" "INFO"  "$*"; }
write_ok()   { write_colored "$C_OK"   "OK"    "$*"; }
write_warn() { write_colored "$C_WARN" "WARN"  "$*"; }
write_err()  { write_colored "$C_ERR"  "ERROR" "$*"; }

pause_exit() {
    if [ "$SILENT" = "0" ]; then
        printf "按 Enter 键退出..."
        # shellcheck disable=SC2034
        read -r _DUMMY || true
    fi
    exit "${1:-0}"
}

# ------------ 参数解析 ------------
print_usage() {
    cat <<EOF
用法: $(basename "$0") [选项]

选项:
  --version VERSION     要安装的 openclaw 版本（默认: 2026.4.11）
  --source SRC          official | domestic（默认: official）
  --registry URL        自定义 npm registry（默认: https://registry.npmmirror.com）
  --force               强制重新安装
  --silent              静默模式，不暂停等待按键
  -h, --help            显示帮助
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --version)   VERSION="${2:-}"; shift 2;;
        --version=*) VERSION="${1#*=}"; shift;;
        --source)    SOURCE="${2:-}"; shift 2;;
        --source=*)  SOURCE="${1#*=}"; shift;;
        --registry)  REGISTRY="${2:-}"; shift 2;;
        --registry=*)REGISTRY="${1#*=}"; shift;;
        --force)     FORCE=1; shift;;
        --silent)    SILENT=1; shift;;
        -h|--help)   print_usage; exit 0;;
        *) printf "未知参数: %s\n" "$1" >&2; print_usage; exit 1;;
    esac
done

case "$SOURCE" in
    official|domestic) ;;
    *) write_err "--source 仅支持 official 或 domestic，当前: $SOURCE"; exit 1;;
esac

# ------------ 系统检查 ------------
check_macos() {
    if [ "$(uname -s)" != "Darwin" ]; then
        write_err "此脚本只支持 macOS，当前系统: $(uname -s)"
        exit 1
    fi
    local ver arch
    ver="$(sw_vers -productVersion 2>/dev/null || echo unknown)"
    arch="$(uname -m)"
    write_info "macOS $ver ($arch)"
}

# 不强制要求 root：npm -g 在 Homebrew 安装的 Node 下普通用户即可写
# 若需要 sudo（如 /usr/local/lib/node_modules/ 属 root），后续在 invoke_npm_install 中按需 sudo
check_perms_advice() {
    if [ "$(id -u)" = "0" ]; then
        write_warn "你正以 root 身份运行（不推荐，npm 全局包属 root，普通用户调用受影响）"
    else
        write_info "当前用户: $(id -un) (uid=$(id -u))"
    fi
}

# ------------ Homebrew 检测 ------------
detect_brew() {
    # Apple Silicon 优先
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
    BREW_PREFIX=""
    BREW_BIN=""
    write_info "未检测到 Homebrew（这是可选的）"
    return 1
}

# ------------ Node.js 版本管理 ------------
NODE_REQUIRED_VERSION="24.15.0"

# 版本比较：$1 >= $2 返回 0，否则返回 1
version_ge() {
    local lower
    lower="$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)"
    [ "$lower" = "$2" ]
}

# 读取当前 node 版本（纯版本号，不含 v 前缀）；未安装则输出空串
get_installed_node_version() {
    local node_bin ver
    node_bin="$(command -v node 2>/dev/null || true)"
    if [ -z "$node_bin" ]; then
        local p
        for p in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/usr/local/opt/node/bin/node" "/opt/homebrew/opt/node@24/bin/node"; do
            if [ -x "$p" ]; then node_bin="$p"; break; fi
        done
    fi
    if [ -z "$node_bin" ] && [ -d "$HOME/.nvm/versions/node" ]; then
        local v
        v="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -n1)"
        [ -n "$v" ] && [ -x "$HOME/.nvm/versions/node/$v/bin/node" ] && node_bin="$HOME/.nvm/versions/node/$v/bin/node"
    fi
    if [ -z "$node_bin" ]; then
        printf ''
        return 1
    fi
    ver="$("$node_bin" --version 2>/dev/null | tr -d 'v\r\n' || true)"
    printf '%s' "$ver"
}

# 通过 Homebrew 安装 Node.js
install_node_via_brew() {
    [ -z "${BREW_BIN:-}" ] && return 1
    write_info "使用 Homebrew 安装 node@24（目标版本 v$NODE_REQUIRED_VERSION）..."
    # 先更新 formula 索引（失败不阻塞）
    "$BREW_BIN/brew" update >>"$LOG_FILE" 2>&1 || true
    if "$BREW_BIN/brew" install node@24 >>"$LOG_FILE" 2>&1; then
        "$BREW_BIN/brew" link --overwrite --force node@24 >>"$LOG_FILE" 2>&1 || true
        export PATH="$BREW_PREFIX/opt/node@24/bin:$BREW_BIN:$PATH"
        return 0
    fi
    write_warn "brew install node@24 失败，回退 brew install node"
    if "$BREW_BIN/brew" install node >>"$LOG_FILE" 2>&1; then
        export PATH="$BREW_BIN:$PATH"
        return 0
    fi
    return 1
}

# 备用方案：官方 / 国内镜像下载 .pkg 安装（universal，同时支持 Intel 与 Apple Silicon）
install_node_via_pkg() {
    write_info "通过官方 .pkg 安装 Node.js v$NODE_REQUIRED_VERSION（universal）..."
    local urls=(
        "https://nodejs.org/dist/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}.pkg"
        "https://mirrors.huaweicloud.com/nodejs/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}.pkg"
        "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}.pkg"
        "https://npmmirror.com/mirrors/node/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}.pkg"
    )
    local tmp_pkg
    tmp_pkg="$(mktemp -t node-install.XXXXXX).pkg"

    if ! command -v curl >/dev/null 2>&1; then
        write_err "未找到 curl，无法下载 Node.js 安装包"
        rm -f "$tmp_pkg"
        return 1
    fi

    local u downloaded=0
    for u in "${urls[@]}"; do
        write_info "下载: $u"
        if curl -fL --connect-timeout 15 --max-time 600 -o "$tmp_pkg" "$u" 2>>"$LOG_FILE"; then
            if [ -s "$tmp_pkg" ]; then
                downloaded=1
                break
            fi
        fi
        write_warn "下载失败，尝试下一个镜像"
    done

    if [ "$downloaded" -ne 1 ]; then
        write_err "所有镜像均下载失败，请检查网络"
        rm -f "$tmp_pkg"
        return 1
    fi

    local sudo_prefix=""
    if [ "$(id -u)" != "0" ]; then
        if command -v sudo >/dev/null 2>&1; then
            write_warn "安装 .pkg 需要管理员权限，将调用 sudo installer"
            sudo_prefix="sudo "
        else
            write_err "安装 .pkg 需要管理员权限，但未找到 sudo"
            rm -f "$tmp_pkg"
            return 1
        fi
    fi

    write_info "运行 installer -pkg ..."
    if ${sudo_prefix}installer -pkg "$tmp_pkg" -target / >>"$LOG_FILE" 2>&1; then
        rm -f "$tmp_pkg"
        export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
        return 0
    fi

    write_err "installer 执行失败"
    rm -f "$tmp_pkg"
    return 1
}

# 主入口：确保 Node.js 满足版本要求
ensure_node() {
    # 如果 preinstall 已验证过 Node.js，直接跳过
    if [ "${CLAWPANEL_NODE_OK:-}" = "1" ]; then
        write_info "preinstall 已验证 Node.js，跳过检测"
        return 0
    fi

    local current_ver
    current_ver="$(get_installed_node_version)"
    if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
        write_info "Node.js 已满足要求: v$current_ver (≥ v$NODE_REQUIRED_VERSION)"
        return 0
    fi
    if [ -z "$current_ver" ]; then
        write_warn "未检测到 Node.js，准备自动安装 v$NODE_REQUIRED_VERSION"
    else
        write_warn "当前 Node.js v$current_ver 低于要求 v$NODE_REQUIRED_VERSION，准备升级"
    fi

    # 1) 优先 Homebrew
    if [ -n "${BREW_BIN:-}" ]; then
        if install_node_via_brew; then
            current_ver="$(get_installed_node_version)"
            if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
                write_ok "Homebrew 安装 Node.js 成功: v$current_ver"
                return 0
            fi
            write_warn "Homebrew 安装后版本仍不满足 (v$current_ver)，回退 .pkg 安装"
        else
            write_warn "Homebrew 安装失败，回退 .pkg 安装"
        fi
    else
        write_info "未检测到 Homebrew，直接使用官方 .pkg 安装"
    fi

    # 2) 备用：官方 .pkg
    if install_node_via_pkg; then
        current_ver="$(get_installed_node_version)"
        if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
            write_ok "Node.js 安装成功: v$current_ver"
            return 0
        fi
        write_err ".pkg 安装后版本仍不满足 (v$current_ver)"
    fi

    write_err "Node.js 自动安装失败，请手动安装 v$NODE_REQUIRED_VERSION+"
    write_err "  Homebrew:      brew install node@24"
    write_err "  官方下载:       https://nodejs.org/dist/v$NODE_REQUIRED_VERSION/node-v$NODE_REQUIRED_VERSION.pkg"
    write_err "  国内镜像(华为): https://mirrors.huaweicloud.com/nodejs/v$NODE_REQUIRED_VERSION/node-v$NODE_REQUIRED_VERSION.pkg"
    return 1
}

# ------------ 定位 npm ------------
# 输出的 npm 全路径写入全局 NPM_CMD
get_npm_full_path() {
    # 1) PATH 中
    local npm_in_path
    npm_in_path="$(command -v npm 2>/dev/null || true)"
    if [ -n "$npm_in_path" ]; then
        write_info "npm 在 PATH 中: $npm_in_path"
        NPM_CMD="$npm_in_path"
        return 0
    fi

    # 2) 常见安装路径（Homebrew / 官方安装包 / nvm）
    local candidates=()
    [ -n "${BREW_BIN:-}" ] && candidates+=("$BREW_BIN/npm")
    candidates+=(
        "/opt/homebrew/bin/npm"
        "/usr/local/bin/npm"
        "/usr/local/opt/node/bin/npm"
        "/opt/homebrew/opt/node/bin/npm"
        "$HOME/.npm-global/bin/npm"
        "$HOME/npm-global/bin/npm"
    )

    # nvm
    if [ -d "$HOME/.nvm/versions/node" ]; then
        local v
        # 取最新一个 node 目录
        v="$(ls -1 "$HOME/.nvm/versions/node" 2>/dev/null | sort -V | tail -n1)"
        if [ -n "$v" ] && [ -x "$HOME/.nvm/versions/node/$v/bin/npm" ]; then
            write_info "通过 nvm 发现 npm: $HOME/.nvm/versions/node/$v/bin/npm"
            NPM_CMD="$HOME/.nvm/versions/node/$v/bin/npm"
            return 0
        fi
    fi

    local p
    for p in "${candidates[@]}"; do
        if [ -x "$p" ]; then
            write_info "发现 npm: $p"
            NPM_CMD="$p"
            return 0
        fi
    done

    # 3) 通过 node 反推
    local node_bin
    node_bin="$(command -v node 2>/dev/null || true)"
    if [ -n "$node_bin" ]; then
        local node_dir cand
        node_dir="$(dirname "$node_bin")"
        cand="$node_dir/npm"
        if [ -x "$cand" ]; then
            write_info "通过 node 发现 npm: $cand"
            NPM_CMD="$cand"
            return 0
        fi
    fi

    write_err "npm 未找到。请先安装 Node.js："
    write_err "  - 推荐 Homebrew:  brew install node"
    write_err "  - 官方安装包:     https://nodejs.org/zh-cn/download"
    write_err "  - 或 nvm:        https://github.com/nvm-sh/nvm"
    pause_exit 1
}

# ------------ 已安装检查 ------------
get_configured_registry() {
    local reg_file="$HOME/.openclaw/npm-registry.txt"
    if [ -f "$reg_file" ]; then
        local configured
        configured="$(tr -d '\r\n[:space:]' <"$reg_file" 2>/dev/null || true)"
        if [ -n "$configured" ]; then
            write_info "从 $reg_file 读取到自定义 registry: $configured"
            REGISTRY="$configured"
        fi
    fi
}

test_openclaw_installed() {
    local openclaw_bin
    openclaw_bin="$(command -v openclaw 2>/dev/null || true)"
    if [ -z "$openclaw_bin" ]; then
        # 兜底：常见安装目录
        local p
        for p in "/opt/homebrew/bin/openclaw" "/usr/local/bin/openclaw" "$HOME/.npm-global/bin/openclaw" "$HOME/npm-global/bin/openclaw"; do
            if [ -x "$p" ]; then openclaw_bin="$p"; break; fi
        done
    fi
    if [ -z "$openclaw_bin" ]; then
        return 1
    fi

    local ver_output installed_full installed_ver
    ver_output="$("$openclaw_bin" --version 2>&1)" || return 1
    installed_full="$(printf '%s' "$ver_output" | tr -d '\r' | head -n1)"
    write_info "已安装 openclaw 版本: $installed_full"

    # 提取纯版本号 X.Y.Z
    installed_ver="$(printf '%s' "$installed_full" | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
    [ -z "$installed_ver" ] && installed_ver="$installed_full"

    if [ "$installed_ver" = "$VERSION" ] && [ "$FORCE" = "0" ]; then
        write_ok "版本 $VERSION 已安装，跳过 npm install（如需重装请使用 --force）"
        return 0
    fi
    if [ "$installed_ver" != "$VERSION" ]; then
        write_warn "已安装版本 ($installed_full) 与目标版本 ($VERSION) 不一致，准备更新"
    fi
    return 1
}

# ------------ npm install ------------
# 返回 0 = 成功，非 0 = 失败
invoke_npm_install() {
    local npm_path="$1" pkg_name="$2" ver="$3" reg="$4"
    local pkg_spec="${pkg_name}@${ver}"
    local node_dir; node_dir="$(dirname "$npm_path")"

    # 确保 node 目录在 PATH 中（npm install scripts 会调用 node）
    case ":$PATH:" in
        *":$node_dir:"*) ;;
        *) export PATH="$node_dir:$PATH";;
    esac

    write_info "运行: npm install -g $pkg_spec --registry $reg"
    write_info "（最长等待 15 分钟）"

    # 判断是否需要 sudo：npm prefix -g 的目录是否可写
    local prefix sudo_prefix
    prefix="$("$npm_path" prefix -g 2>/dev/null || echo "")"
    sudo_prefix=""
    if [ -n "$prefix" ] && [ ! -w "$prefix" ] && [ "$(id -u)" != "0" ]; then
        if command -v sudo >/dev/null 2>&1; then
            write_warn "全局目录 $prefix 不可写，将使用 sudo 执行 npm install"
            sudo_prefix="sudo -E "
        else
            write_warn "全局目录 $prefix 不可写，且未找到 sudo；安装可能失败"
        fi
    fi

    # 用临时文件 + tee 实时显示并捕获输出，便于日志
    local tmp_log
    tmp_log="$(mktemp -t openclaw-npm.XXXXXX)"

    # bash 自带超时支持有限，用 perl 兜底；优先 GNU coreutils 的 timeout
    local rc
    if command -v gtimeout >/dev/null 2>&1; then
        # shellcheck disable=SC2086
        ${sudo_prefix}gtimeout 900 "$npm_path" install -g "$pkg_spec" \
            --registry "$reg" --force --ignore-scripts --no-audit --no-fund \
            2>&1 | tee "$tmp_log"
        rc=${PIPESTATUS[0]}
    elif command -v timeout >/dev/null 2>&1; then
        # shellcheck disable=SC2086
        ${sudo_prefix}timeout 900 "$npm_path" install -g "$pkg_spec" \
            --registry "$reg" --force --ignore-scripts --no-audit --no-fund \
            2>&1 | tee "$tmp_log"
        rc=${PIPESTATUS[0]}
    else
        # 无 timeout，直接跑（与 PowerShell 异步等待相比退而求其次）
        # shellcheck disable=SC2086
        ${sudo_prefix}"$npm_path" install -g "$pkg_spec" \
            --registry "$reg" --force --ignore-scripts --no-audit --no-fund \
            2>&1 | tee "$tmp_log"
        rc=${PIPESTATUS[0]}
    fi

    # 把 npm 输出追加到日志
    if [ -f "$tmp_log" ]; then
        printf '\n----- npm output (registry: %s) -----\n' "$reg" >>"$LOG_FILE_FIXED" 2>/dev/null || true
        cat "$tmp_log" >>"$LOG_FILE_FIXED" 2>/dev/null || true
        printf '\n----- npm output (registry: %s) -----\n' "$reg" >>"$LOG_FILE" 2>/dev/null || true
        cat "$tmp_log" >>"$LOG_FILE" 2>/dev/null || true
        rm -f "$tmp_log"
    fi

    if [ "$rc" = "124" ] || [ "$rc" = "143" ]; then
        write_err "npm install 超时（15分钟），请检查网络或重试"
        return 1
    fi
    if [ "$rc" -ne 0 ]; then
        write_err "npm install 失败（exit code: $rc）"
        return 1
    fi
    return 0
}

# ------------ Gateway 服务 ------------
# 调用 openclaw CLI 自身的 install 命令注册 LaunchAgent
# label: ai.openclaw.gateway，plist 路径: ~/Library/LaunchAgents/ai.openclaw.gateway.plist
install_gateway_service() {
    write_info "正在安装 Gateway 服务..."

    local openclaw_bin
    openclaw_bin="$(command -v openclaw 2>/dev/null || true)"
    if [ -z "$openclaw_bin" ]; then
        local p
        for p in "/opt/homebrew/bin/openclaw" "/usr/local/bin/openclaw" "$HOME/.npm-global/bin/openclaw" "$HOME/npm-global/bin/openclaw"; do
            if [ -x "$p" ]; then openclaw_bin="$p"; break; fi
        done
    fi
    if [ -z "$openclaw_bin" ]; then
        write_warn "openclaw 命令未找到，跳过 Gateway 安装。请手动确认 npm 全局 bin 是否在 PATH"
        return 1
    fi

    local label="ai.openclaw.gateway"
    local uid; uid="$(id -u)"
    local plist="$HOME/Library/LaunchAgents/${label}.plist"

    # 1) 先停止已有服务（容错）
    write_info "停止已存在的 Gateway 服务..."
    "$openclaw_bin" gateway stop >>"$LOG_FILE" 2>&1 || true
    launchctl bootout "gui/${uid}/${label}" >>"$LOG_FILE" 2>&1 || true
    sleep 1

    # 2) 如果 plist 还存在，但服务未注册，让 CLI 重新生成（避免老 plist）
    if [ -f "$plist" ]; then
        write_info "检测到旧 plist，准备重新注册"
    fi

    # 3) 让 openclaw CLI 自己写 plist + 注册（与 Windows 上让 CLI 注册系统服务一致）
    write_info "注册 Gateway 服务（openclaw gateway install）..."
    local install_output rc
    install_output="$("$openclaw_bin" gateway install 2>&1)"
    rc=$?
    printf '%s\n' "$install_output" >>"$LOG_FILE" 2>/dev/null || true

    if [ "$rc" -eq 0 ]; then
        write_ok "Gateway 服务安装成功"
    else
        write_warn "openclaw gateway install 失败（exit=$rc），尝试通过 launchctl 兜底加载现有 plist"
        printf "  输出: %s\n" "$install_output"
    fi

    # 4) 确保 plist 已注册到 launchd
    if [ -f "$plist" ]; then
        write_info "通过 launchctl bootstrap 加载: $plist"
        launchctl bootstrap "gui/${uid}" "$plist" >>"$LOG_FILE" 2>&1 || true
        launchctl kickstart -k "gui/${uid}/${label}" >>"$LOG_FILE" 2>&1 || true
        # 校验状态
        if launchctl print "gui/${uid}/${label}" >/dev/null 2>&1; then
            write_ok "LaunchAgent 已注册: $label"
            return 0
        fi
    fi

    if [ "$rc" -ne 0 ]; then
        write_warn "Gateway 未能确认安装成功，请手动执行: openclaw gateway install"
        return 1
    fi
    return 0
}

# ------------ 修补 config.json ------------
# 用 node 解析（项目已依赖 node，比 awk/sed 改 JSON 更稳）
patch_config() {
    local config_path="$HOME/.openclaw/config.json"
    if [ ! -f "$config_path" ]; then
        write_info "config.json 不存在，无需修补"
        return 0
    fi
    if ! command -v node >/dev/null 2>&1; then
        write_warn "未检测到 node，跳过 config.json 修补"
        return 0
    fi

    write_info "修补 config.json: $config_path"

    node - "$config_path" <<'NODE_EOF'
const fs = require('fs');
const p = process.argv[2];
let raw;
try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { console.error('读取失败:', e.message); process.exit(0); }
let cfg;
try { cfg = JSON.parse(raw); } catch (e) { console.error('config.json 格式异常，跳过修补:', e.message); process.exit(0); }

let dirty = false;
if (!cfg.gateway || typeof cfg.gateway !== 'object') {
  cfg.gateway = { mode: 'local' }; dirty = true;
  console.log('  添加 gateway.mode = local');
} else if (!cfg.gateway.mode) {
  cfg.gateway.mode = 'local'; dirty = true;
  console.log('  设置 gateway.mode = local');
}

if (!cfg.tools || typeof cfg.tools !== 'object') {
  cfg.tools = { profile: 'full', sessions: { visibility: 'all' } }; dirty = true;
  console.log('  添加 tools.profile = full');
} else if (cfg.tools.profile !== 'full') {
  cfg.tools.profile = 'full';
  if (!cfg.tools.sessions) cfg.tools.sessions = { visibility: 'all' };
  dirty = true;
  console.log('  设置 tools.profile = full');
}

if (dirty) {
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  console.log('OK config.json 已修补');
} else {
  console.log('config.json 配置已是最新，无需修改');
}
NODE_EOF
}

# ------------ 主流程 ------------
main() {
    printf '\n'
    printf "${C_INFO}=========================================================${C_RESET}\n"
    printf "${C_INFO}        OpenClaw 安装脚本 (macOS / 通过国内镜像源)${C_RESET}\n"
    printf "${C_INFO}=========================================================${C_RESET}\n"
    printf '\n'

    check_macos
    check_perms_advice
    detect_brew

    # 确保 Node.js 满足版本要求（不足则自动安装 v$NODE_REQUIRED_VERSION）
    if ! ensure_node; then
        write_err "Node.js 准备失败，npm install 无法继续"
        pause_exit 1
    fi

    # 解析包名
    local pkg_name
    if [ "$SOURCE" = "domestic" ]; then
        pkg_name="@qingchencloud/openclaw-zh"
    else
        pkg_name="openclaw"
    fi
    write_info "安装包: $pkg_name@$VERSION"

    # 用户自定义 registry
    get_configured_registry

    # 国内发行版强制走官方源
    if [ "$SOURCE" = "domestic" ]; then
        case "$REGISTRY" in
            *npmmirror*|*taobao*) ;;
            *)
                write_warn "国内发行版建议使用国内镜像源，已调整 registry 为官方"
                REGISTRY="https://registry.npmjs.org"
                ;;
        esac
    fi
    write_info "npm registry: $REGISTRY"

    # 已安装且非 force 直接跳过 npm install
    NPM_CMD=""
    if test_openclaw_installed; then
        write_info "跳过 npm install 阶段"
    else
        get_npm_full_path
        local mirrors=(
            "$REGISTRY"
            "https://mirrors.cloud.tencent.com/npm/"
            "https://mirrors.huaweicloud.com/repository/npm/"
            "https://registry.npmjs.org"
        )

        local install_ok=0 m
        for m in "${mirrors[@]}"; do
            printf '\n'
            write_info "尝试镜像源: $m"
            if invoke_npm_install "$NPM_CMD" "$pkg_name" "$VERSION" "$m"; then
                install_ok=1
                if [ "$m" != "$REGISTRY" ]; then
                    write_info "成功使用镜像源: $m"
                fi
                break
            fi
            write_warn "镜像源失败，准备切换下一个..."
            sleep 1
        done

        if [ "$install_ok" -ne 1 ]; then
            write_err "所有镜像源均安装失败，请检查网络连接"
            pause_exit 1
        fi
        write_ok "npm install 完成！"
    fi

    # 刷新 PATH（把可能的 npm bin 目录加进去）
    write_info "刷新 PATH..."
    [ -n "${BREW_BIN:-}" ] && export PATH="$BREW_BIN:$PATH"
    export PATH="$HOME/.npm-global/bin:$HOME/npm-global/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

    printf '\n'
    install_gateway_service || true

    printf '\n'
    patch_config

    printf '\n'
    write_ok "=================================================="
    write_ok "  OpenClaw 安装完成，版本: $VERSION"
    write_ok "=================================================="
    printf '\n'
    write_info "安装日志已保存到: $LOG_FILE"
    write_info "             亦可查看最近一次: $LOG_FILE_FIXED"
    printf '\n'

    if [ "$SILENT" = "0" ]; then
        printf "${C_WARN}提示: 如果 openclaw 命令未立即生效，请重启终端或执行：${C_RESET}\n"
        printf "${C_INFO}  hash -r${C_RESET}\n\n"
        printf "按 Enter 键退出..."
        read -r _DUMMY || true
    fi
}

# ------------ 全局异常兜底 ------------
trap 'rc=$?; if [ "$rc" -ne 0 ]; then write_err "脚本异常退出: exit=$rc 行=$LINENO"; fi' EXIT

main "$@"
