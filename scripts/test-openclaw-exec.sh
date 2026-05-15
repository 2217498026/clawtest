#!/usr/bin/env bash
# =============================================================================
# test-openclaw-exec.sh
# macOS 上模拟 .pkg preinstall 脚本调用 install-openclaw.sh 的诊断脚本
#
# 用法:
#   # 最简单: 直接运行（自动在当前目录找 install-openclaw.sh）
#   bash test-openclaw-exec.sh
#
#   # 指定 install-openclaw.sh 路径
#   bash test-openclaw-exec.sh /path/to/install-openclaw.sh
#
#   # 模拟 preinstall 的各种尝试方法
#   bash test-openclaw-exec.sh --method=all /path/to/install-openclaw.sh
#
# 输出: 所有日志会同时打印到终端和 ~/Library/Logs/OpenClaw/test-exec-*.log
# =============================================================================

set -uo pipefail

# ------------ 日志 ------------
LOG_DIR="$HOME/Library/Logs/OpenClaw"
mkdir -p "$LOG_DIR" 2>/dev/null || true
LOG_FILE="$LOG_DIR/test-exec-$(date +%Y%m%d-%H%M%S).log"

echo_and_log() {
    local ts="$(date '+%Y-%m-%d %H:%M:%S')"
    printf '[%s] %s\n' "$ts" "$*" | tee -a "$LOG_FILE"
}
section() {
    echo ""
    echo_and_log "==========================================="
    echo_and_log "  $*"
    echo_and_log "==========================================="
}

# ------------ 获取参数 ------------
SCRIPT_PATH=""
METHOD="all"
if [ $# -ge 1 ]; then
    case "$1" in
        --method=*) METHOD="${1#*=}"; shift ;;
        *) SCRIPT_PATH="$1"; shift ;;
    esac
fi
if [ $# -ge 1 ]; then
    case "$1" in
        --method=*) METHOD="${1#*=}"; shift ;;
    esac
fi

# ------------ 系统信息 ------------
section "系统信息"
echo_and_log "  date:      $(date)"
echo_and_log "  uname -a:  $(uname -a)"
echo_and_log "  sw_vers:   $(sw_vers -productVersion 2>/dev/null || echo 'N/A')"
echo_and_log "  arch:      $(uname -m)"
echo_and_log "  whoami:    $(whoami)"
echo_and_log "  id:        $(id)"
echo_and_log "  HOME:      $HOME"
echo_and_log "  USER:      ${USER:-N/A}"
echo_and_log "  PATH:      $PATH"
echo_and_log "  TMPDIR:    ${TMPDIR:-N/A}"
echo_and_log "  LOG_FILE:  $LOG_FILE"

# ------------ 查找 install-openclaw.sh ------------
section "查找 install-openclaw.sh"

if [ -z "$SCRIPT_PATH" ]; then
    # 自动查找
    CANDIDATES=(
        "$(cd "$(dirname "$0")" && pwd -P 2>/dev/null)/install-openclaw.sh"
        "$(dirname "$0")/install-openclaw.sh"
        "./install-openclaw.sh"
        "../scripts/install-openclaw.sh"
        "/tmp/install-openclaw.sh"
    )
    for c in "${CANDIDATES[@]}"; do
        if [ -f "$c" ]; then
            SCRIPT_PATH="$c"
            break
        fi
    done
fi

if [ -z "$SCRIPT_PATH" ] || [ ! -f "$SCRIPT_PATH" ]; then
    echo_and_log "[ERROR] 未找到 install-openclaw.sh，请在命令行指定路径"
    echo_and_log "  用法: bash test-openclaw-exec.sh /path/to/install-openclaw.sh"
    exit 1
fi

echo_and_log "  脚本路径: $SCRIPT_PATH"
echo_and_log "  文件大小: $(wc -c < "$SCRIPT_PATH") bytes"
echo_and_log "  权限:     $(ls -la "$SCRIPT_PATH" | awk '{print $1, $3, $4}')"
echo_and_log "  文件编码: $(file "$SCRIPT_PATH")"

# 检查是否有 CRLF
if grep -l $'\r' "$SCRIPT_PATH" >/dev/null 2>&1; then
    echo_and_log "[WARN] 脚本包含 Windows CRLF 换行符!"
else
    echo_and_log "[OK]   脚本换行符为 Unix LF"
fi

# ------------ 检查 Node.js ------------
section "Node.js 检测"

check_node() {
    local node_bin=""
    node_bin="$(command -v node 2>/dev/null || true)"
    echo_and_log "  command -v node: ${node_bin:-N/A}"

    for p in "/opt/homebrew/bin/node" "/usr/local/bin/node" "/opt/homebrew/opt/node@24/bin/node"; do
        if [ -x "$p" ]; then
            echo_and_log "  发现: $p"
        fi
    done

    if [ -n "$node_bin" ]; then
        local ver
        ver="$("$node_bin" --version 2>/dev/null || true)"
        echo_and_log "  node --version: ${ver:-N/A}"
        echo_and_log "  npm --version:  $("$(dirname "$node_bin")/npm" --version 2>/dev/null || echo 'N/A')"
    fi
}
check_node

# ------------ 测试方法1: 直接复制到 /tmp + bash 执行 ------------
section "方法1: 复制到 /tmp + bash 执行（原始方案）"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "1" ]; then
    local_tmp="/tmp/test-openclaw-$$.sh"
    cp "$SCRIPT_PATH" "$local_tmp" 2>/dev/null && chmod 755 "$local_tmp"
    echo_and_log "  临时脚本: $local_tmp"
    echo_and_log "  $(ls -la "$local_tmp")"

    echo_and_log "  执行: bash $local_tmp --silent"
    echo "===== OUTPUT START ====="
    bash "$local_tmp" --silent 2>&1 | tee -a "$LOG_FILE"
    rc=$?
    echo "===== OUTPUT END (exit=$rc) ====="
    echo_and_log "  退出码: $rc"

    rm -f "$local_tmp"
fi

# ------------ 测试方法2: stdin pipe 执行（当前方案） ------------
section "方法2: stdin pipe 执行（当前方案）"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "2" ]; then
    # 先复制到 /tmp
    local_tmp="/tmp/test-openclaw-$$.sh"
    cp "$SCRIPT_PATH" "$local_tmp" 2>/dev/null && chmod 755 "$local_tmp"

    UPDATED_PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    echo_and_log "  临时脚本: $local_tmp"
    echo_and_log "  PATH:      $UPDATED_PATH"
    echo_and_log "  CLAWPANEL_NODE_OK: 1"

    echo_and_log "  执行: cat \$local_tmp | bash -s -- --silent"
    echo "===== OUTPUT START ====="
    cat "$local_tmp" | CLAWPANEL_NODE_OK=1 \
        HOME="$HOME" \
        USER="$(whoami)" \
        PATH="$UPDATED_PATH" \
        bash -s -- --silent 2>&1 | tee -a "$LOG_FILE"
    rc=$?
    echo "===== OUTPUT END (exit=$rc) ====="
    echo_and_log "  退出码: $rc"

    rm -f "$local_tmp"
fi

# ------------ 测试方法3: 使用 sudo -u 自己执行（模拟 preinstall 场景） ------------
section "方法3: sudo 模拟 preinstall"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "3" ]; then
    CONSOLE_USER="$(whoami)"
    CONSOLE_HOME="$HOME"
    UPDATED_PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    local_tmp="/tmp/test-openclaw-$$.sh"
    cp "$SCRIPT_PATH" "$local_tmp" 2>/dev/null && chmod 755 "$local_tmp"
    echo_and_log "  临时脚本: $local_tmp"
    echo_and_log "  sudo -u $CONSOLE_USER"

    echo_and_log "  执行: cat \$local_tmp | sudo -u \$USER bash -s -- --silent"
    echo "===== OUTPUT START ====="
    cat "$local_tmp" | sudo -u "$CONSOLE_USER" \
        HOME="$CONSOLE_HOME" \
        USER="$CONSOLE_USER" \
        PATH="$UPDATED_PATH" \
        CLAWPANEL_NODE_OK=1 \
        bash -s -- --silent 2>&1 | tee -a "$LOG_FILE"
    rc=$?
    echo "===== OUTPUT END (exit=$rc) ====="
    echo_and_log "  退出码: $rc"

    rm -f "$local_tmp"
fi

# ------------ 测试方法4: 直接 sudo bash 执行脚本文件（如 /tmp 可访问） ------------
section "方法4: sudo bash 直接执行 /tmp 中的脚本"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "4" ]; then
    CONSOLE_USER="$(whoami)"
    CONSOLE_HOME="$HOME"
    UPDATED_PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    local_tmp="/tmp/test-openclaw-$$.sh"
    cp "$SCRIPT_PATH" "$local_tmp" 2>/dev/null && chmod 755 "$local_tmp"
    echo_and_log "  临时脚本: $local_tmp"
    echo_and_log "  sudo -u $CONSOLE_USER bash \$local_tmp --silent"

    echo_and_log "  执行: sudo -u \$USER bash \$local_tmp --silent"
    echo "===== OUTPUT START ====="
    sudo -u "$CONSOLE_USER" \
        HOME="$CONSOLE_HOME" \
        USER="$CONSOLE_USER" \
        PATH="$UPDATED_PATH" \
        CLAWPANEL_NODE_OK=1 \
        bash "$local_tmp" --silent 2>&1 | tee -a "$LOG_FILE"
    rc=$?
    echo "===== OUTPUT END (exit=$rc) ====="
    echo_and_log "  退出码: $rc"

    rm -f "$local_tmp"
fi

# ------------ 测试方法5: 直接 sudo bash 执行原始路径的脚本（模拟原始场景） ------------
section "方法5: sudo bash 执行原始路径脚本（sandbox 路径模拟）"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "5" ]; then
    CONSOLE_USER="$(whoami)"
    CONSOLE_HOME="$HOME"
    UPDATED_PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/opt/node@24/bin:/usr/local/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    echo_and_log "  原始路径: $SCRIPT_PATH"
    echo_and_log "  sudo -u $CONSOLE_USER bash \$SCRIPT_PATH --silent"

    echo_and_log "  执行: sudo -u \$USER bash \$SCRIPT_PATH --silent"
    echo "===== OUTPUT START ====="
    sudo -u "$CONSOLE_USER" \
        HOME="$CONSOLE_HOME" \
        USER="$CONSOLE_USER" \
        PATH="$UPDATED_PATH" \
        CLAWPANEL_NODE_OK=1 \
        bash "$SCRIPT_PATH" --silent 2>&1 | tee -a "$LOG_FILE"
    rc=$?
    echo "===== OUTPUT END (exit=$rc) ====="
    echo_and_log "  退出码: $rc"

    # 检查可能的错误原因
    echo_and_log "  诊断: 检查目录权限..."
    script_dir="$(dirname "$SCRIPT_PATH")"
    while [ "$script_dir" != "/" ]; do
        perms="$(ls -la "$script_dir" 2>/dev/null | head -n1 || echo 'N/A')"
        echo_and_log "    $script_dir: $(ls -lad "$script_dir" 2>/dev/null | awk '{print $1, $3, $4}' || echo 'N/A')"
        script_dir="$(dirname "$script_dir")"
    done
fi

# ------------ 测试方法6: 诊断 install-openclaw.sh 内部 ------------
section "方法6: 脚本内部诊断（逐段执行）"

if [ "$METHOD" = "all" ] || [ "$METHOD" = "6" ]; then
    # 手动模拟 ensure_node
    echo_and_log "  1) 检查 ensure_node 行为..."
    echo_and_log "     CLAWPANEL_NODE_OK=1 → 预期立即返回 0"
    bash -c '
        source "'"$SCRIPT_PATH"'" 2>/dev/null || true
        # 直接测试 ensure_node
        CLAWPANEL_NODE_OK=1
        if type ensure_node >/dev/null 2>&1; then
            echo "    [OK] ensure_node 函数可调用"
        else
            echo "    [WARN] ensure_node 函数不可用（直接 source 可能不完整）"
        fi
    ' 2>&1 | tee -a "$LOG_FILE"

    echo_and_log ""
    echo_and_log "  2) 检查脚本语法..."
    bash -n "$SCRIPT_PATH" 2>&1 | tee -a "$LOG_FILE"
    if [ $? -eq 0 ]; then
        echo_and_log "     [OK] 脚本语法正确"
    fi
fi

# ------------ 总结 ------------
section "测试完成"
echo_and_log "  完整日志: $LOG_FILE"
echo_and_log "  共测试 $([ "$METHOD" = "all" ] && echo "6" || echo "1") 种执行方法"
echo_and_log "  请将以上输出（从开始到结束的完整终端内容）发给开发者"

# 输出 install-openclaw 自己的日志
echo ""
echo_and_log "检查 install-openclaw.sh 的日志..."
for f in "$LOG_DIR/openclaw-install-"*.log "$LOG_DIR/openclaw-install.log"; do
    if [ -f "$f" ]; then
        echo_and_log "  $f: $(wc -l < "$f") 行"
        echo_and_log "  --- 最后 10 行 ---"
        tail -10 "$f" | sed 's/^/    /' | tee -a "$LOG_FILE"
        echo_and_log "  ---"
    fi
done

echo ""
echo "============================================"
echo "  诊断脚本执行完毕"
echo "  日志文件: $LOG_FILE"
echo "============================================"
