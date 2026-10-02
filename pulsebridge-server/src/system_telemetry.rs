use std::time::Instant;
use parking_lot::RwLock;
use windows_sys::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
use crate::models::SystemTelemetry;

pub struct TelemetryCollector {
    start_time: Instant,
    hostname: String,
    lan_ip: String,
    port: u16,
    active_ide: RwLock<String>,
}

#[allow(dead_code)]
impl TelemetryCollector {
    pub fn new(lan_ip: String, port: u16) -> Self {
        let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Host-PC".to_string());
        Self {
            start_time: Instant::now(),
            hostname,
            lan_ip,
            port,
            active_ide: RwLock::new("Auto-detecting...".to_string()),
        }
    }

    pub fn set_active_ide(&self, ide_name: String) {
        *self.active_ide.write() = ide_name;
    }

    pub fn collect(&self) -> SystemTelemetry {
        let mut total_ram_mb = 0;
        let mut used_ram_mb = 0;
        let mut memory_percent = 0;

        unsafe {
            let mut mem_status: MEMORYSTATUSEX = std::mem::zeroed();
            mem_status.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut mem_status) != 0 {
                total_ram_mb = mem_status.ullTotalPhys / (1024 * 1024);
                let avail_ram_mb = mem_status.ullAvailPhys / (1024 * 1024);
                used_ram_mb = total_ram_mb.saturating_sub(avail_ram_mb);
                memory_percent = mem_status.dwMemoryLoad as u8;
            }
        }

        let mut battery_percent = None;
        let mut is_charging = None;

        unsafe {
            let mut power_status: SYSTEM_POWER_STATUS = std::mem::zeroed();
            if GetSystemPowerStatus(&mut power_status) != 0 {
                if power_status.BatteryLifePercent != 255 {
                    battery_percent = Some(power_status.BatteryLifePercent);
                }
                // ACLineStatus: 1 = Online (Charging / plugged in), 0 = Offline
                is_charging = Some(power_status.ACLineStatus == 1);
            }
        }

        SystemTelemetry {
            hostname: self.hostname.clone(),
            os: "Windows 11 / 10".to_string(),
            memory_used_mb: used_ram_mb,
            memory_total_mb: total_ram_mb,
            memory_percent,
            battery_percent,
            is_charging,
            lan_ip: self.lan_ip.clone(),
            server_port: self.port,
            active_ide_name: self.active_ide.read().clone(),
            uptime_seconds: self.start_time.elapsed().as_secs(),
        }
    }
}
