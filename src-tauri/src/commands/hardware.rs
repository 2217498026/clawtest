/// 硬件信息采集命令
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// 获取主板序列号（跨平台）
/// Windows: PowerShell Get-CimInstance Win32_BaseBoard
/// Linux: /sys/class/dmi/id/board_serial -> dmidecode
/// macOS: system_profiler SPHardwareDataType -> ioreg
#[tauri::command]
pub fn get_motherboard_serial() -> String {
    platform_motherboard_serial()
}

#[cfg(target_os = "windows")]
fn platform_motherboard_serial() -> String {
    get_motherboard_serial_windows()
}

#[cfg(target_os = "linux")]
fn platform_motherboard_serial() -> String {
    get_motherboard_serial_linux()
}

#[cfg(target_os = "macos")]
fn platform_motherboard_serial() -> String {
    get_motherboard_serial_macos()
}

#[cfg(not(any(target_os = "windows", target_os = "linux", target_os = "macos")))]
fn platform_motherboard_serial() -> String {
    "N/A".to_string()
}

#[cfg(target_os = "windows")]
fn get_motherboard_serial_windows() -> String {
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    // 方法1: PowerShell Get-CimInstance
    let ps_script = "& { $ProgressPreference = 'SilentlyContinue'; $InformationPreference = 'SilentlyContinue'; $WarningPreference = 'SilentlyContinue'; Get-CimInstance Win32_BaseBoard | Select-Object -ExpandProperty SerialNumber }";
    let mut cmd = Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", ps_script]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !text.is_empty() && text != "To be filled by O.E.M." && text != "Not Available" && text != "Default string" {
                // 过滤 CLIXML 残余
                let clean = text
                    .lines()
                    .filter(|l| !l.trim().starts_with('#') && !l.trim().starts_with('<'))
                    .collect::<Vec<_>>()
                    .join(" ")
                    .trim()
                    .to_string();
                if !clean.is_empty() {
                    return clean;
                }
            }
        }
    }

    // 方法2: wmic 回退
    let mut cmd = Command::new("wmic");
    cmd.args(["baseboard", "get", "serialnumber"]);
    cmd.creation_flags(CREATE_NO_WINDOW);
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty()
                    && trimmed != "SerialNumber"
                    && trimmed != "To be filled by O.E.M."
                    && trimmed != "Not Available"
                    && trimmed != "Default string"
                {
                    return trimmed.to_string();
                }
            }
        }
    }

    "N/A".to_string()
}

#[cfg(target_os = "linux")]
fn get_motherboard_serial_linux() -> String {
    // 方法1: 读取 sysfs
    let paths = [
        "/sys/class/dmi/id/board_serial",
        "/sys/class/dmi/id/product_serial",
    ];
    for path in &paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty()
                && trimmed != "Not Available"
                && trimmed != "Not Specified"
                && trimmed != "Default string"
                && trimmed != "To be filled by O.E.M."
            {
                return trimmed;
            }
        }
    }

    // 方法2: dmidecode
    if let Ok(output) = Command::new("dmidecode").arg("-s").arg("system-serial-number").output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !text.is_empty()
                && text != "Not Available"
                && text != "Not Specified"
                && text != "Default string"
                && text != "To be filled by O.E.M."
            {
                return text;
            }
        }
    }

    "N/A".to_string()
}

#[cfg(target_os = "macos")]
fn get_motherboard_serial_macos() -> String {
    // 方法1: system_profiler
    if let Ok(output) = Command::new("system_profiler")
        .arg("SPHardwareDataType")
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("Serial Number") {
                    if let Some(serial) = line.split(':').nth(1) {
                        let trimmed = serial.trim().to_string();
                        if !trimmed.is_empty() && trimmed != "Not Available" {
                            return trimmed;
                        }
                    }
                }
            }
        }
    }

    // 方法2: ioreg
    if let Ok(output) = Command::new("ioreg")
        .args(["-l"])
        .output()
    {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("IOPlatformSerialNumber") {
                    if let Some(pos) = line.find('"') {
                        let rest = &line[pos + 1..];
                        if let Some(end) = rest.find('"') {
                            let serial = rest[..end].to_string();
                            if !serial.is_empty() {
                                return serial;
                            }
                        }
                    }
                }
            }
        }
    }

    "N/A".to_string()
}
