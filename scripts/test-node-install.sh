#!/usr/bin/env bash
# =============================================================================
# test-node-install.sh
# 在 macOS 上测试 Node.js tarball 下载安装，验证 npm 是否可用
# =============================================================================
set -uo pipefail

NODE_REQUIRED_VERSION="24.15.0"
ARCH="$(uname -m)"
TMP_TAR="$(mktemp -t node-test.XXXXXX).tar.xz"
INSTALL_DIR="/usr/local/lib/nodejs"
NODE_DIR_NAME="node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}"

echo "=========================================="
echo " Node.js tarball 下载测试"
echo " 版本:   v$NODE_REQUIRED_VERSION"
echo " 架构:   $ARCH"
echo " 安装到: $INSTALL_DIR/$NODE_DIR_NAME"
echo "=========================================="

# 1) 下载
echo ""
echo "--- 步骤1: 下载 tarball ---"
URLS=(
    "https://nodejs.org/dist/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}.tar.xz"
    "https://mirrors.huaweicloud.com/nodejs/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}.tar.xz"
    "https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}.tar.xz"
    "https://npmmirror.com/mirrors/node/v${NODE_REQUIRED_VERSION}/node-v${NODE_REQUIRED_VERSION}-darwin-${ARCH}.tar.xz"
)

downloaded=0
for url in "${URLS[@]}"; do
    echo "  尝试: $url"
    if curl -fL --connect-timeout 15 --max-time 600 -o "$TMP_TAR" "$url" 2>/dev/null; then
        if [ -s "$TMP_TAR" ]; then
            downloaded=1
            echo "  [OK] 下载成功 ($(du -h "$TMP_TAR" | cut -f1))"
            break
        fi
    fi
    echo "  [WARN] 失败，尝试下一个"
done

if [ "$downloaded" -ne 1 ]; then
    echo "[ERROR] 所有镜像下载失败"
    rm -f "$TMP_TAR"
    exit 1
fi

# 2) 解压
echo ""
echo "--- 步骤2: 解压到 $INSTALL_DIR ---"
sudo mkdir -p "$INSTALL_DIR"
sudo tar -xJf "$TMP_TAR" -C "$INSTALL_DIR"
if [ $? -ne 0 ]; then
    echo "[ERROR] 解压失败"
    rm -f "$TMP_TAR"
    exit 1
fi
echo "[OK] 解压成功"

# 3) 创建 symlinks
echo ""
echo "--- 步骤3: 创建 /usr/local/bin symlinks ---"
NODE_BIN="$INSTALL_DIR/$NODE_DIR_NAME/bin"
sudo mkdir -p /usr/local/bin
sudo ln -sf "$NODE_BIN/node" /usr/local/bin/node
sudo ln -sf "$NODE_BIN/npm" /usr/local/bin/npm
sudo ln -sf "$NODE_BIN/npx" /usr/local/bin/npx
echo "[OK] symlinks 已创建"

# 4) 验证
echo ""
echo "--- 步骤4: 验证 ---"
echo "  node:  $(/usr/local/bin/node --version)"
echo "  npm:   $(/usr/local/bin/npm --version)"
echo "  npx:   $(/usr/local/bin/npx --version)"

# 5) 测试 sudo -u 后是否能找到 npm
echo ""
echo "--- 步骤5: 测试 sudo -u $(whoami) 下 npm 是否可访问 ---"
sudo -u "$(whoami)" bash -c 'echo "  command -v node: $(command -v node)"; echo "  command -v npm: $(command -v npm)"'

# 6) 清理
echo ""
echo "--- 步骤6: 清理（删除测试下载/安装）---"
sudo rm -rf "$INSTALL_DIR/$NODE_DIR_NAME"
sudo rm -f /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx
rm -f "$TMP_TAR"
echo "[OK] 清理完成"

echo ""
echo "=========================================="
echo " 测试完成"
echo "=========================================="
