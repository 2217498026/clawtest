---
name: cross-platform-machine-id-tool
overview: 创建一个跨平台 Node.js 工具脚本，通过系统命令获取主板序列号、CPU ID、磁盘序列号、MAC 地址等硬件特征码，组合生成机器唯一标识字符串。
todos:
  - id: create-machine-id
    content: 创建 scripts/machine-id.js，实现跨平台主板序列号、BIOS UUID、CPU ID、MAC 地址、机器型号采集函数，含 Windows/Linux/macOS 三平台命令适配、双层回退策略和异常容错
    status: completed
  - id: implement-cli-export
    content: 实现 CLI 入口 main() 函数（格式化输出 key=value 字符串 + SHA256 指纹）和 ESM 模块导出（getMachineId、generateFingerprint）
    status: completed
    dependencies:
      - create-machine-id
  - id: test-local
    content: 在本地 Windows 环境运行 node scripts/machine-id.js 验证输出正确性和异常容错
    status: completed
    dependencies:
      - implement-cli-export
---

## 产品概述

一个跨平台的 Node.js 工具脚本，用于获取本地机器的唯一硬件标识码。通过采集主板序列号为核心特征，结合 CPU、BIOS、MAC 地址等多维度硬件信息，生成稳定的机器指纹字符串。

## 核心功能

- **主板序列号获取**：Windows 使用 `wmic` / PowerShell `Get-CimInstance`，Linux 使用 `dmidecode` / `/sys/class/dmi/id/`，macOS 使用 `system_profiler` / `ioreg`
- **多维度特征采集**：主板序列号、BIOS 序列号、CPU ID、MAC 地址、机器型号、机器 UUID
- **平台适配**：自动检测操作系统，选择对应的底层命令或文件读取路径
- **异常容错**：每个采集项独立 try/catch，失败时返回 `"N/A"` 或跳过，不影响其他维度
- **格式化输出**：将所有特征码组合为 `key=value` 格式的字符串，并可生成 SHA256 哈希摘要作为简短指纹
- **CLI 支持**：支持直接运行 `node scripts/machine-id.js`，也支持作为模块导出供其他脚本调用

## 技术栈

- **运行时**：Node.js（ESM 模块，`"type": "module"`）
- **依赖**：仅使用 Node.js 内置模块 — `os`、`child_process`（`execSync`）、`crypto`、`fs`、`path`
- **无外部 npm 依赖**

## 实现方案

### 整体策略

采用**分层采集 + 平台适配**架构。每个硬件特征作为一个独立的采集函数，内部根据 `process.platform` 选择对应的系统命令或文件路径。所有采集函数被一个聚合函数调用，容错地收集各维度信息，最终组合输出。

### 平台适配命令矩阵

| 特征 | Windows | Linux | macOS |
| --- | --- | --- | --- |
| 主板序列号 | `wmic baseboard get serialnumber` / `Get-CimInstance Win32_BaseBoard` | `dmidecode -s baseboard-serial-number` / `/sys/class/dmi/id/board_serial` | `system_profiler SPHardwareDataType \ | grep "Board"` / `ioreg -l \ | grep IOPlatformSerialNumber` |
| BIOS/UUID | `wmic csproduct get uuid` | `/sys/class/dmi/id/product_uuid` | `system_profiler SPHardwareDataType \ | grep "Hardware UUID"` |
| CPU ID | `wmic cpu get processorid` | `dmidecode -s processor-id` / `/proc/cpuinfo` | `sysctl -n machdep.cpu.brand_string` |
| MAC 地址 | `os.networkInterfaces()` | 同左 | 同左 |
| 机器型号 | `wmic csproduct get name` | `dmidecode -s system-product-name` | `sysctl hw.model` |


### 异常处理机制

每个采集函数内部使用 `try/catch`，失败时返回 `"N/A"`。主聚合函数继续处理后续采集项，不因单项失败而中断。`execSync` 调用统一设置 `{ timeout: 5000, windowsHide: true, encoding: 'utf8' }`。

### 架构设计

```mermaid
flowchart TD
    A[machine-id.js 入口] --> B{CLI 调用?}
    B -->|是| C[main() 格式化输出]
    B -->|否| D[导出 getMachineId 函数]
    
    C --> E[collectMachineInfo]
    D --> E
    
    E --> F1[getMotherboardSerial]
    E --> F2[getBiosUUID]
    E --> F3[getCpuId]
    E --> F4[getMacAddress]
    E --> F5[getMachineModel]
    
    F1 --> G{process.platform}
    G -->|win32| H1[wmic / PowerShell]
    G -->|linux| H2[dmidecode / sysfs]
    G -->|darwin| H3[system_profiler / ioreg]
    
    E --> I[组合为格式化字符串]
    I --> J[可选: SHA256 指纹]
    J --> K[输出]
```

## 目录结构

```
scripts/
└── machine-id.js    # [NEW] 跨平台机器标识码获取工具
```

## 关键代码结构

```js
// 采集函数签名（统一模式）
function getMotherboardSerial() {
  if (process.platform === 'win32') {
    // wmic → PowerShell 双重回退
  } else if (process.platform === 'linux') {
    // dmidecode → /sys/class/dmi/id/ 双重回退
  } else if (process.platform === 'darwin') {
    // system_profiler → ioreg 双重回退
  }
  return serial || 'N/A';
}

// 主导出函数
export function getMachineId(options = {}) {
  return {
    motherboardSerial: getMotherboardSerial(),
    biosUUID: getBiosUUID(),
    cpuId: getCpuId(),
    macAddress: getMacAddress(),
    machineModel: getMachineModel(),
    fingerprint: generateFingerprint(info),  // SHA256 哈希
  };
}
```

## 实现要点

### 性能优化

- 使用 `execSync` 同步执行命令，每个命令设置 5 秒超时防止卡死
- `os.networkInterfaces()` 直接从 Node.js 获取，无额外进程开销
- BIOS UUID 在 Linux 下优先读文件（`/sys/class/dmi/id/product_uuid`），避免 fork 进程

### 回退策略

- **Windows**：优先 `wmic`，失败回退到 PowerShell `Get-CimInstance`，再失败读注册表
- **Linux**：优先 `dmidecode`（需 root），失败回退读 `/sys/class/dmi/id/` 文件（普通用户可读）
- **macOS**：优先 `system_profiler`，失败回退 `ioreg`

### 日志规范

- 复用项目已有 `console.log` 风格，输出平台检测和采集结果
- 单个采集项失败时打印 `[WARN]`，全部失败时打印 `[ERROR]`
- 不输出敏感完整序列号到日志（仅输出前缀字符 + `***`）