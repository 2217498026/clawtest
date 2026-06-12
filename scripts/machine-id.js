#!/usr/bin/env node
/**
 * machine-id.js — 跨平台机器唯一标识码获取工具
 *
 * 通过系统命令获取主板序列号、BIOS UUID、CPU ID、MAC 地址、机器型号等硬件特征码，
 * 组合生成机器唯一标识字符串和 SHA256 指纹。
 *
 * 用法：
 *   node scripts/machine-id.js                 # 打印格式化输出
 *   node scripts/machine-id.js --fingerprint   # 仅输出 SHA256 指纹
 *   node scripts/machine-id.js --json          # JSON 格式输出
 *
 * 模块导入：
 *   import { getMachineId, collectMachineInfo, generateFingerprint } from './machine-id.js'
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { networkInterfaces } from 'os';
import { readFileSync, existsSync } from 'fs';

// ─── 工具函数 ───────────────────────────────────────────────

/**
 * 执行系统命令并返回清理后的输出
 * @param {string} cmd 命令字符串
 * @param {object} [opts] execSync 选项
 * @returns {string|null} 成功返回去空白后的字符串，失败返回 null
 */
function runCommand(cmd, opts = {}) {
  try {
    const output = execSync(cmd, {
      timeout: 8000,
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    let text = output.trim();
    // 过滤 PowerShell CLIXML 噪音（进度/信息流残留）
    text = text.replace(/^#<\s*CLIXML\s*/gm, '');
    text = text.replace(/<Objs\b[\s\S]*?<\/Objs>/g, '');
    return text.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 执行 PowerShell 命令（自动抑制所有非数据输出流）
 * @param {string} psScript PowerShell 脚本内容
 * @returns {string|null}
 */
function psCommand(psScript) {
  const fullCmd = `powershell -NoProfile -Command "& { $ProgressPreference = 'SilentlyContinue'; $InformationPreference = 'SilentlyContinue'; $WarningPreference = 'SilentlyContinue'; ${psScript} }"`;
  return runCommand(fullCmd);
}

/**
 * 解析 wmic 输出（表格式：标题行 + 值行）
 * @param {string|null} output wmic 命令输出
 * @returns {string|null}
 */
function parseWmicValue(output) {
  if (!output) return null;
  const lines = output.split('\n').filter(l => l.trim());
  if (lines.length < 2) return null;
  return lines[1].trim() || null;
}

/**
 * 安全输出序列号（仅日志用，截断显示）
 * @param {string|null} serial
 * @returns {string}
 */
function maskSerial(serial) {
  if (!serial || serial === 'N/A') return 'N/A';
  if (serial.length <= 8) return serial;
  return serial.substring(0, 4) + '***' + serial.substring(serial.length - 4);
}

// ─── 主板序列号 ─────────────────────────────────────────────

function getMotherboardSerial() {
  if (process.platform === 'win32') {
    // Windows: wmic → PowerShell 双重回退
    let result = runCommand('wmic baseboard get serialnumber');
    let serial = parseWmicValue(result);
    if (serial) return serial;

    result = psCommand('Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber');
    serial = result?.trim() || null;
    if (serial) return serial;

    // 终极回退：尝试读注册表（某些品牌机在此有 SN）
    return 'N/A';
  }

  if (process.platform === 'linux') {
    // Linux: /sys 文件系统 → dmidecode
    const sysfsPath = '/sys/class/dmi/id/board_serial';
    try {
      if (existsSync(sysfsPath)) {
        const serial = readFileSync(sysfsPath, 'utf8').trim();
        if (serial && serial !== 'Not Specified' && serial !== 'To be filled by O.E.M.') {
          return serial;
        }
      }
    } catch { /* fallback */ }

    // dmidecode（部分系统需 root）
    let result = runCommand('dmidecode -s baseboard-serial-number');
    if (result && result !== 'Not Specified' && result !== 'To be filled by O.E.M.') {
      return result;
    }

    // ARM/RPi 没有 DMI，使用 /proc/cpuinfo 中的 Serial
    result = runCommand('cat /proc/cpuinfo 2>/dev/null | grep Serial | cut -d: -f2');
    if (result) return result.trim();

    return 'N/A';
  }

  if (process.platform === 'darwin') {
    // macOS: 没有独立主板序列号，使用系统硬件序列号
    let result = runCommand('system_profiler SPHardwareDataType 2>/dev/null | awk \'/Serial Number/ {print $NF}\'');
    if (result && result !== 'Not Available') return result;

    result = runCommand('ioreg -l 2>/dev/null | grep IOPlatformSerialNumber | grep -oE \'[^"]+"$\'');
    if (result) {
      const serial = result.replace(/"/g, '').trim();
      if (serial) return serial;
    }

    return 'N/A';
  }

  return 'N/A';
}

// ─── BIOS / 系统 UUID ───────────────────────────────────────

function getBiosUUID() {
  if (process.platform === 'win32') {
    let result = runCommand('wmic csproduct get uuid');
    let uuid = parseWmicValue(result);
    if (uuid) return uuid;

    result = psCommand('Get-CimInstance Win32_ComputerSystemProduct | Select-Object -ExpandProperty UUID');
    uuid = result?.trim() || null;
    if (uuid) return uuid;

    return 'N/A';
  }

  if (process.platform === 'linux') {
    // 优先读文件
    const uuidPath = '/sys/class/dmi/id/product_uuid';
    try {
      if (existsSync(uuidPath)) {
        const uuid = readFileSync(uuidPath, 'utf8').trim();
        if (uuid && uuid !== 'Not Specified') return uuid;
      }
    } catch { /* fallback */ }

    // /etc/machine-id（D-Bus 机器 ID）
    const machineIdPath = '/etc/machine-id';
    try {
      if (existsSync(machineIdPath)) {
        const mid = readFileSync(machineIdPath, 'utf8').trim();
        if (mid) return `machine-id:${mid}`;
      }
    } catch { /* fallback */ }

    // dbus machine-id
    const dbusPath = '/var/lib/dbus/machine-id';
    try {
      if (existsSync(dbusPath)) {
        const mid = readFileSync(dbusPath, 'utf8').trim();
        if (mid) return `machine-id:${mid}`;
      }
    } catch { /* fallback */ }

    let result = runCommand('dmidecode -s system-uuid');
    if (result && result !== 'Not Specified') return result;

    return 'N/A';
  }

  if (process.platform === 'darwin') {
    let result = runCommand('system_profiler SPHardwareDataType 2>/dev/null | awk \'/Hardware UUID/ {print $NF}\'');
    if (result) return result;

    result = runCommand('ioreg -d2 -c IOPlatformExpertDevice 2>/dev/null | grep IOPlatformUUID | grep -oE \'[^"]+"$\'');
    if (result) {
      const uuid = result.replace(/"/g, '').trim();
      if (uuid) return uuid;
    }

    return 'N/A';
  }

  return 'N/A';
}

// ─── CPU ID ─────────────────────────────────────────────────

function getCpuId() {
  if (process.platform === 'win32') {
    let result = runCommand('wmic cpu get processorid');
    let cpuId = parseWmicValue(result);
    if (cpuId) return cpuId;

    result = psCommand('Get-CimInstance Win32_Processor | Select-Object -ExpandProperty ProcessorId');
    cpuId = result?.trim() || null;
    if (cpuId) return cpuId;

    return 'N/A';
  }

  if (process.platform === 'linux') {
    // x86: dmidecode processor-id
    let result = runCommand('dmidecode -s processor-id 2>/dev/null');
    if (result && result !== 'Not Specified' && result.length > 4) return result;

    // ARM/RPi: Serial from /proc/cpuinfo
    result = runCommand('cat /proc/cpuinfo 2>/dev/null | grep -m1 Serial | cut -d: -f2');
    if (result) return result.trim();

    // x86: cpu MHz + cores 作为备用标识
    result = runCommand('cat /proc/cpuinfo 2>/dev/null | grep -E "model name|cpu cores" | head -2 | tr "\\n" " "');
    if (result) {
      const hash = createHash('md5').update(result).digest('hex').substring(0, 16);
      return `cpu-hash:${hash}`;
    }

    return 'N/A';
  }

  if (process.platform === 'darwin') {
    // macOS 不暴露 CPU 序列号，使用型号字串的哈希
    let result = runCommand('sysctl -n machdep.cpu.brand_string 2>/dev/null');
    if (result) {
      const hash = createHash('md5').update(result).digest('hex').substring(0, 16);
      return `cpu-hash:${hash}`;
    }

    result = runCommand('sysctl -n hw.physicalcpu 2>/dev/null');
    const cores = result?.trim() || 'unknown';
    result = runCommand('sysctl -n hw.cpufrequency 2>/dev/null');
    const freq = result?.trim() || 'unknown';
    const combined = `cores:${cores}-freq:${freq}`;
    const hash = createHash('md5').update(combined).digest('hex').substring(0, 16);
    return `cpu-hash:${hash}`;
  }

  return 'N/A';
}

// ─── MAC 地址 ───────────────────────────────────────────────

function getMacAddress() {
  try {
    const interfaces = networkInterfaces();
    const macs = [];

    for (const [name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      // 排除回环、虚拟接口
      const lowerName = name.toLowerCase();
      if (lowerName.includes('loopback') || lowerName.includes('veth')
        || lowerName.includes('docker') || lowerName.includes('br-')
        || lowerName.includes('vnet')) {
        continue;
      }
      for (const addr of addrs) {
        if (addr.mac && addr.mac !== '00:00:00:00:00:00' && !addr.internal) {
          // 取第一个非虚拟物理 MAC
          macs.push({ name, mac: addr.mac });
        }
      }
    }

    // 优先返回以太网、WiFi 的 MAC
    const priorityMac = macs.find(m =>
      m.name.toLowerCase().startsWith('eth') ||
      m.name.toLowerCase().startsWith('en') ||
      m.name.toLowerCase().startsWith('wlan') ||
      m.name.includes('Wi-Fi') ||
      m.name.toLowerCase().startsWith('wl')
    );
    if (priorityMac) return priorityMac.mac;

    // 有线和无线都找不到，返回第一个物理 MAC
    if (macs.length > 0) return macs[0].mac;

  } catch { /* fallback */ }

  return 'N/A';
}

// ─── 机器型号 ───────────────────────────────────────────────

function getMachineModel() {
  if (process.platform === 'win32') {
    let result = runCommand('wmic csproduct get name');
    let model = parseWmicValue(result);
    if (model && model !== 'System Product Name' && model !== 'To be filled by O.E.M.') {
      return model;
    }

    result = psCommand('Get-CimInstance Win32_ComputerSystem | Select-Object -ExpandProperty Model');
    model = result?.trim() || null;
    if (model && model !== 'System Product Name' && model !== 'To be filled by O.E.M.') {
      return model;
    }

    return 'N/A';
  }

  if (process.platform === 'linux') {
    const productPath = '/sys/class/dmi/id/product_name';
    try {
      if (existsSync(productPath)) {
        const name = readFileSync(productPath, 'utf8').trim();
        if (name && name !== 'System Product Name' && name !== 'To be filled by O.E.M.') {
          return name;
        }
      }
    } catch { /* fallback */ }

    let result = runCommand('dmidecode -s system-product-name 2>/dev/null');
    if (result && result !== 'System Product Name' && result !== 'To be filled by O.E.M.') {
      return result;
    }

    // ARM 设备型号
    result = runCommand('cat /proc/device-tree/model 2>/dev/null');
    if (result) return result.trim();

    return 'N/A';
  }

  if (process.platform === 'darwin') {
    let result = runCommand('sysctl -n hw.model 2>/dev/null');
    if (result) return result;

    result = runCommand('system_profiler SPHardwareDataType 2>/dev/null | awk \'/Model Identifier/ {print $NF}\'');
    if (result) return result;

    return 'N/A';
  }

  return 'N/A';
}

// ─── 磁盘序列号 ─────────────────────────────────────────────

function getDiskSerial() {
  if (process.platform === 'win32') {
    let result = runCommand('wmic diskdrive get serialnumber');
    const serial = parseWmicValue(result);
    if (serial) return serial;

    result = psCommand('Get-CimInstance Win32_DiskDrive | Select-Object -ExpandProperty SerialNumber | Select-Object -First 1');
    if (result?.trim()) return result.trim();

    return 'N/A';
  }

  if (process.platform === 'linux') {
    // lsblk 获取主磁盘序列号
    let result = runCommand('lsblk -ndo SERIAL /dev/sda 2>/dev/null');
    if (result) return result;

    result = runCommand('lsblk -ndo SERIAL /dev/nvme0n1 2>/dev/null');
    if (result) return result;

    // hdparm 回退
    result = runCommand('hdparm -I /dev/sda 2>/dev/null | grep "Serial Number" | awk \'{print $NF}\'');
    if (result) return result;

    return 'N/A';
  }

  if (process.platform === 'darwin') {
    // macOS 磁盘序列号
    let result = runCommand('system_profiler SPSerialATADataType 2>/dev/null | grep "Serial Number" | head -1');
    if (result) {
      const parts = result.split(':');
      if (parts.length > 1) return parts[1].trim();
    }

    result = runCommand('diskutil info disk0 2>/dev/null | grep "Device / Media Name"');
    if (result) {
      const model = result.split(':').pop()?.trim();
      if (model) {
        const hash = createHash('md5').update(model).digest('hex').substring(0, 16);
        return `disk-hash:${hash}`;
      }
    }

    return 'N/A';
  }

  return 'N/A';
}

// ─── 聚合采集 ───────────────────────────────────────────────

/**
 * 采集所有机器特征码
 * @param {object} [options]
 * @param {boolean} [options.verbose=false] 是否输出详细日志
 * @returns {object} 键值对对象
 */
export function collectMachineInfo(options = {}) {
  const verbose = options.verbose || false;
  const results = {};

  const collectors = [
    { key: 'motherboardSerial', fn: getMotherboardSerial, label: '主板序列号' },
    { key: 'biosUUID', fn: getBiosUUID, label: 'BIOS/UUID' },
    { key: 'cpuId', fn: getCpuId, label: 'CPU ID' },
    { key: 'macAddress', fn: getMacAddress, label: 'MAC 地址' },
    { key: 'machineModel', fn: getMachineModel, label: '机器型号' },
    { key: 'diskSerial', fn: getDiskSerial, label: '磁盘序列号' },
  ];

  for (const { key, fn, label } of collectors) {
    try {
      const value = fn();
      results[key] = value || 'N/A';
      if (verbose) {
        const display = results[key] === 'N/A'
          ? '\x1b[33mN/A\x1b[0m'
          : maskSerial(results[key]);
        console.log(`  ${label.padEnd(12)} : ${display}`);
      }
    } catch (e) {
      results[key] = 'N/A';
      if (verbose) {
        console.log(`  ${label.padEnd(12)} : \x1b[31mERROR: ${e.message}\x1b[0m`);
      }
    }
  }

  return results;
}

// ─── 指纹生成 ───────────────────────────────────────────────

/**
 * 基于机器信息生成 SHA256 指纹
 * @param {object} info collectMachineInfo 返回的结果
 * @returns {string} 64 字符十六进制哈希
 */
export function generateFingerprint(info) {
  const parts = [
    info.motherboardSerial || '',
    info.biosUUID || '',
    info.cpuId || '',
    info.macAddress || '',
    info.machineModel || '',
    info.diskSerial || '',
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/**
 * 获取机器唯一标识（便捷方法）
 * @param {object} [options]
 * @param {boolean} [options.verbose=false]
 * @returns {{ info: object, fingerprint: string, displayString: string }}
 */
export function getMachineId(options = {}) {
  const info = collectMachineInfo(options);
  const fingerprint = generateFingerprint(info);

  const displayParts = [
    `motherboardSerial=${info.motherboardSerial}`,
    `biosUUID=${info.biosUUID}`,
    `cpuId=${info.cpuId}`,
    `macAddress=${info.macAddress}`,
    `machineModel=${info.machineModel}`,
    `diskSerial=${info.diskSerial}`,
    `fingerprint=${fingerprint}`,
  ];

  return {
    info,
    fingerprint,
    displayString: displayParts.join(';'),
  };
}

// ─── CLI 入口 ───────────────────────────────────────────────

function printBanner() {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║     🔑 Machine ID — 机器唯一标识码        ║');
  console.log(`║     平台: ${process.platform.padEnd(31)}║`);
  console.log('╚═══════════════════════════════════════════╝');
  console.log('');
}

async function main() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  const fingerprintOnly = args.includes('--fingerprint');

  if (!jsonMode && !fingerprintOnly) {
    printBanner();
  }

  const result = getMachineId({ verbose: !jsonMode && !fingerprintOnly });

  if (fingerprintOnly) {
    // 仅输出指纹
    console.log(result.fingerprint);
  } else if (jsonMode) {
    // JSON 格式
    console.log(JSON.stringify({ ...result.info, fingerprint: result.fingerprint }, null, 2));
  } else {
    // 默认：格式化字符串
    console.log('采集结果:');
    console.log('');
    console.log(result.displayString);
    console.log('');
    console.log(`指纹 (SHA256): ${result.fingerprint}`);
    console.log('');
  }
}

// 直接运行时执行 CLI
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('machine-id.js') ||
  process.argv[1].includes('machine-id')
);

if (isDirectRun) {
  main().catch(e => {
    console.error('执行失败:', e.message);
    process.exit(1);
  });
}
