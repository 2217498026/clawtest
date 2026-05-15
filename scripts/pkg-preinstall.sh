#!/usr/bin/env bash
# =============================================================================
# pkg-preinstall.sh
# macOS .pkg 安装包 preinstall 脚本
#
# 功能：
#   1. 检测并自动安装 Node.js v24.15.0（Homebrew → tarball 提取，避免 installer 锁冲突）
#   2. 以实际控制台用户身份执行 install-openclaw.sh 安装 OpenClaw CLI + Gateway
#   3. 任何情况均 exit 0（不阻塞 .pkg 安装）
#
# 注意：不调用 installer -pkg 来安装 Node.js，因为 .pkg preinstall
# 运行时 installer 进程已被占用，进程锁冲突会导致安装失败。
# 改用 tarball 二进制分发版提取到 /usr/local/，完全绕过 installer。
# =============================================================================

set -uo pipefail

# 确保 PATH 包含常见 node 安装位置
export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

# ------------ 获取实际控制台用户 ------------
# 在 .pkg preinstall 中运行于 root（$HOME=/var/root）
get_console_user() {
    local user=""
    if command -v scutil >/dev/null 2>&1; then
        user="$(echo "show State:/Users/ConsoleUser" | scutil 2>/dev/null | awk '/Name :/ {print $3}')"
    fi
    if [ -z "$user" ] && [ -c /dev/console ]; then
        user="$(stat -f '%Su' /dev/console 2>/dev/null || true)"
    fi
    if [ -z "$user" ]; then
        user="$(logname 2>/dev/null || true)"
    fi
    printf '%s' "${user:-$(id -un 2>/dev/null || echo "unknown")}"
}

get_console_home() {
    local user="$1" home=""
    if command -v dscl >/dev/null 2>&1; then
        home="$(dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}')"
    fi
    if [ -z "$home" ] || [ ! -d "$home" ]; then
        home="$(eval "echo ~${user}" 2>/dev/null || true)"
    fi
    if [ -z "$home" ] || [ ! -d "$home" ]; then
        home="/Users/$user"
    fi
    printf '%s' "${home:-$HOME}"
}

get_console_uid() {
    local user="$1" uid=""
    uid="$(id -u "$user" 2>/dev/null || true)"
    printf '%s' "${uid:-$(id -u)}"
}

# ------------ 日志 ------------
CONSOLE_USER="$(get_console_user)"
CONSOLE_HOME="$(get_console_home "$CONSOLE_USER")"
CONSOLE_UID="$(get_console_uid "$CONSOLE_USER")"
ARCH="$(uname -m)"

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
        BREW_PREFIX="/opt/homebrew"; BREW_BIN="/opt/homebrew/bin"
        write_info "检测到 Homebrew (Apple Silicon): $BREW_PREFIX"; return 0
    fi
    if [ -x /usr/local/bin/brew ]; then
        BREW_PREFIX="/usr/local"; BREW_BIN="/usr/local/bin"
        write_info "检测到 Homebrew (Intel): $BREW_PREFIX"; return 0
    fi
    write_info "未检测到 Homebrew"; return 1
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
        for p in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/opt/homebrew/opt/node@24/bin/node" "/usr/local/lib/nodejs/node-v${NODE_REQUIRED_VERSION}-darwin-*/bin/node"; do
            # shellcheck disable=SC2086
            for f in $p; do
                if [ -x "$f" ]; then node_bin="$f"; break 2; fi
            done
        done
    fi
    if [ -z "$node_bin" ]; then printf ''; return 1; fi
    ver="$("$node_bin" --version 2>/dev/null | tr -d 'v\r\n' || true)"
    printf '%s' "$ver"
}

# ------------ Node.js 安装（Homebrew 优先，tarball 兜底） ------------
# 不使用 installer -pkg，避免与主 .pkg 的 installer 进程锁冲突

install_node_via_brew() {
    [ -z "${BREW_BIN:-}" ] && return 1
    write_info "通过 Homebrew 安装 node@24（目标 v$NODE_REQUIRED_VERSION）..."
    "$BREW_BIN/brew" update >>"$LOG_FILE" 2>&1 || true
    if "$BREW_BIN/brew" install node@24 >>"$LOG_FILE" 2>&1; then
        "$BREW_BIN/brew" link --overwrite --force node@24 >>"$LOG_FILE" 2>&1 || true
        return 0
    fi
    write_warn "brew install node@24 失败，尝试 brew install node"
    if "$BREW_BIN/brew" install node >>"$LOG_FILE" 2>&1; then
        return 0
    fi
    return 1
}

# 备用方案：下载 Node.js 二进制 tarball 提取到 /usr/local/
# 这完全绕过 installer 进程锁，因为只使用 curl + tar
install_node_via_tarball() {
    local tarball_urls=()
    local tarball_name=""

    if [ "$ARCH" = "arm64" ]; then
        tarball_name="node-v${NODE_REQUIRED_VERSION}-darwin-arm64.tar.xz"
    else
        tarball_name="node-v${NODE_REQUIRED_VERSION}-darwin-x64.tar.xz"
    fi

    local INSTALL_DIR="/usr/local/lib/nodejs"
    local NODE_DIR_NAME="node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}"

    tarball_urls=(
        "https://nodejs.org/dist/v${NODE_REQUIRED_VERSION}/${tarball_name}"
        "https://mirrors.huaweicloud.com/nodejs/v${NODE_REQUIRED_VERSION}/${tarball_name}"
        "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v${NODE_REQUIRED_VERSION}/${tarball_name}"
        "https://npmmirror.com/mirrors/node/v${NODE_REQUIRED_VERSION}/${tarball_name}"
    )

    write_info "通过二进制 tarball 安装 Node.js v$NODE_REQUIRED_VERSION ($ARCH)..."

    if ! command -v curl >/dev/null 2>&1; then
        write_warn "未找到 curl，无法下载 Node.js tarball"
        return 1
    fi
    if ! command -v tar >/dev/null 2>&1; then
        write_warn "未找到 tar，无法提取 Node.js tarball"
        return 1
    fi

    local tmp_tar url downloaded=0
    tmp_tar="$(mktemp -t node-tarball.XXXXXX).tar.xz"

    for url in "${tarball_urls[@]}"; do
        write_info "下载: $url"
        if curl -fL --connect-timeout 15 --max-time 600 -o "$tmp_tar" "$url" 2>>"$LOG_FILE"; then
            if [ -s "$tmp_tar" ]; then
                downloaded=1
                break
            fi
        fi
        write_warn "下载失败，尝试下一个镜像"
    done

    if [ "$downloaded" -ne 1 ]; then
        write_err "所有镜像均下载失败"
        rm -f "$tmp_tar"
        return 1
    fi

    # 创建安装目录并提取
    mkdir -p "$INSTALL_DIR"
    write_info "提取到 $INSTALL_DIR/$NODE_DIR_NAME ..."
    if ! tar -xJf "$tmp_tar" -C "$INSTALL_DIR" 2>>"$LOG_FILE"; then
        write_warn "提取失败，尝试使用 xz 解压..."
        if command -v xz >/dev/null 2>&1; then
            xz -dc "$tmp_tar" | tar -x -C "$INSTALL_DIR" 2>>"$LOG_FILE" || {
                write_warn "xz 解压也失败"
                rm -f "$tmp_tar"
                return 1
            }
        else
            rm -f "$tmp_tar"
            return 1
        fi
    fi

    rm -f "$tmp_tar"

    # 创建 /usr/local/bin 下的符号链接
    mkdir -p /usr/local/bin
    local node_bin="$INSTALL_DIR/$NODE_DIR_NAME/bin"
    if [ -f "$node_bin/node" ]; then
        ln -sf "$node_bin/node" /usr/local/bin/node
        ln -sf "$node_bin/npm" /usr/local/bin/npm
        ln -sf "$node_bin/npx" /usr/local/bin/npx
        ln -sf "$node_bin/corepack" /usr/local/bin/corepack 2>/dev/null || true
        write_ok "Node.js tarball 安装成功: $INSTALL_DIR/$NODE_DIR_NAME"
        return 0
    fi

    write_warn "tarball 提取后未找到 node 二进制"
    return 1
}

# ------------ 确保 Node.js ------------
ensure_node() {
    local current_ver
    current_ver="$(get_installed_node_version)"

    if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
        write_ok "Node.js 已满足要求: v$current_ver (≥ v$NODE_REQUIRED_VERSION)"
        return 0
    fi

    if [ -z "$current_ver" ]; then
        write_info "未检测到 Node.js，准备自动安装 v$NODE_REQUIRED_VERSION"
    else
        write_info "当前 Node.js v$current_ver 低于要求 v$NODE_REQUIRED_VERSION，准备升级"
    fi

    # 1) 优先 Homebrew（更快）
    if [ -n "${BREW_BIN:-}" ]; then
        if install_node_via_brew; then
            write_ok "Homebrew 安装成功，验证版本..."
            current_ver="$(get_installed_node_version)"
            if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
                write_ok "Node.js v$current_ver"
                return 0
            fi
            write_warn "Homebrew 安装后版本仍不足 (v$current_ver)，回退 tarball"
        else
            write_warn "Homebrew 安装失败，回退 tarball 安装"
        fi
    else
        write_info "未安装 Homebrew，使用二进制 tarball 安装"
    fi

    # 2) 备用：二进制 tarball（不依赖 installer）
    if install_node_via_tarball; then
        # 刷新 PATH
        export PATH="/usr/local/bin:$PATH"
        current_ver="$(get_installed_node_version)"
        if [ -n "$current_ver" ] && version_ge "$current_ver" "$NODE_REQUIRED_VERSION"; then
            write_ok "Node.js v$current_ver（tarball 安装）"
            return 0
        fi
        write_warn "tarball 安装后版本仍不足 (v$current_ver)"
    fi

    write_warn "Node.js 自动安装失败，将在 App 首次启动时引导安装"
    write_warn "不影响 ClawPanel App 本身的安装"
    return 1
}

# ------------ 以控制台用户运行 install-openclaw.sh ------------
run_install_openclaw() {
    local script_dir
    script_dir="$(cd "$(dirname "$0")" && pwd -P 2>/dev/null || pwd -P)"
    local install_script="$script_dir/install-openclaw.sh"

    # pkgbuild --scripts 会将 scripts 目录下所有文件打包进 .pkg
    # 安装时 preinstall 运行在 scripts 目录下，同目录可访问 install-openclaw.sh
    if [ -f "$install_script" ] && [ -x "$install_script" ]; then
        found="$install_script"
    fi

    if [ -z "$found" ]; then
        # 尝试从 PATH 或默认位置查找
        for p in "/Applications/ClawPanel.app/Contents/Resources/install-openclaw.sh" \
                 "$CONSOLE_HOME/Downloads/install-openclaw.sh" \
                 "./scripts/install-openclaw.sh" \
                 "../scripts/install-openclaw.sh"; do
            if [ -f "$p" ] && [ -x "$p" ]; then
                found="$p"; break
            fi
        done
    fi

    # 最后尝试 find
    if [ -z "$found" ]; then
        found="$(find / -name 'install-openclaw.sh' -maxdepth 5 -type f 2>/dev/null | head -n1 || true)"
    fi

    if [ -z "$found" ]; then
        write_warn "未找到 install-openclaw.sh，跳过 OpenClaw 自动安装"
        write_warn "App 首次启动时会引导安装 OpenClaw"
        return 0
    fi

    write_info "找到 install-openclaw.sh: $found"
    write_info "以用户 $CONSOLE_USER (uid=$CONSOLE_UID) 身份执行..."

    # 修复：日志目录可能是 root 创建的（preinstall 运行在 root），sudo -u 写入会 Permission denied
    if [ -d "$LOG_DIR" ]; then
        chown -R "$CONSOLE_USER" "$LOG_DIR" 2>/dev/null || true
    fi

    # 以控制台用户身份运行安装脚本，设置正确的 HOME 和 PATH
    # 直接使用 sudo VAR=VALUE command 语法传递环境变量
    if command -v sudo >/dev/null 2>&1; then
        # 确保 PATH 中包含新安装的 node/npm
        local updated_path="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

        # 修复：查找 npm 实际路径追加到 updated_path
        # preinstall 的 ensure_node 只检测 node 存在即可，不保证 npm 在标准路径
        # 但 install-openclaw.sh 需要 npm 来安装 openclaw 包
        local npm_bin=""
        npm_bin="$(command -v npm 2>/dev/null || true)"
        if [ -z "$npm_bin" ]; then
            # 从之前找到的 node 路径反推 npm
            local node_bin
            node_bin="$(command -v node 2>/dev/null || true)"
            if [ -n "$node_bin" ]; then
                local node_dir
                node_dir="$(dirname "$node_bin")"
                if [ -x "$node_dir/npm" ]; then
                    npm_bin="$node_dir/npm"
                fi
            fi
        fi
        if [ -n "$npm_bin" ]; then
            local npm_dir
            npm_dir="$(dirname "$npm_bin")"
            if [ -n "$npm_dir" ] && [[ ":$updated_path:" != *":$npm_dir:"* ]]; then
                updated_path="$npm_dir:$updated_path"
                write_info "追加 npm 路径到 PATH: $npm_dir"
            fi
        fi

        # ⚠️ 重要：install-openclaw.sh 位于 installd 创建的 sandbox 目录（/private/tmp/PKInstallSandbox.*/）
        # 该目录权限为 700 属 root，sudo -u 切换用户后无法访问脚本文件。
        # 因此先将脚本复制到用户可读的临时位置，再通过 stdin pipe 执行（完全绕过文件访问权限）。
        local user_tmp_script
        user_tmp_script="/tmp/install-openclaw-$$.sh"
        if cp "$found" "$user_tmp_script" 2>/dev/null; then
            chmod 755 "$user_tmp_script" 2>/dev/null || true
            write_info "复制脚本到用户可读位置: $user_tmp_script"
        else
            write_warn "复制脚本失败，回退直接执行（可能因权限问题失败）"
            user_tmp_script="$found"
        fi

        write_info "正在执行 install-openclaw.sh（此过程可能需要数分钟）..."

        # 先写入标记行，便于后续 tail 截取输出
        printf '\n===== install-openclaw.sh output start =====\n' >> "$LOG_FILE"

        # 通过 stdin pipe 执行脚本：cat 以 root 读取脚本内容，pipe 到 sudo -u 的 bash -s
        # 这样 chuzu 的 bash 进程完全不需要读取任何文件，避免一切权限问题
        if cat "$user_tmp_script" | sudo -u "$CONSOLE_USER" \
            HOME="$CONSOLE_HOME" \
            USER="$CONSOLE_USER" \
            PATH="$updated_path" \
            CLAWPANEL_NODE_OK=1 \
            bash -s -- --silent >> "$LOG_FILE" 2>&1; then
            printf '===== install-openclaw.sh output end (success) =====\n' >> "$LOG_FILE"
            write_ok "install-openclaw.sh 执行成功"
        else
            local rc=$?
            printf "===== install-openclaw.sh output end (exit code: $rc) =====\n" >> "$LOG_FILE"
            write_warn "install-openclaw.sh 退出码=$rc（不影响 .pkg 安装）"
            # 从标记行截取最后 30 行输出
            write_info "--- install-openclaw 输出（最后 30 行）---"
            tail -30 "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do write_log "$line"; done
            write_info "---"
        fi

        # 清理临时脚本
        if [ "$user_tmp_script" != "$found" ]; then
            rm -f "$user_tmp_script" 2>/dev/null || true
        fi
    else
        write_warn "未找到 sudo，跳过 install-openclaw.sh 执行"
    fi
}

# ------------ 主入口 ------------
main() {
    write_info "=========================================="
    write_info " ClawPanel .pkg preinstall 脚本"
    write_info " 控制台用户:  $CONSOLE_USER (uid=$CONSOLE_UID)"
    write_info " 用户主目录:  $CONSOLE_HOME"
    write_info " 系统架构:    $ARCH"
    write_info "=========================================="

    # 步骤1: 检测 Homebrew
    detect_brew

    # 步骤2: 确保 Node.js 满足版本要求
    ensure_node

    # 刷新 PATH，确保新安装的 node/npm 可用
    export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

    # 步骤3: 运行 install-openclaw.sh（安装 OpenClaw CLI + Gateway）
    run_install_openclaw

    # 保存安装标记
    local marker_dir="$LOG_DIR"
    printf '%s\n' "$CONSOLE_USER" > "$marker_dir/pkg-installed-user.txt" 2>/dev/null || true

    write_info "=========================================="
    write_info " preinstall 完成"
    write_info " 日志: $LOG_FILE"
    write_info "=========================================="
}

main "$@"
exit 0
