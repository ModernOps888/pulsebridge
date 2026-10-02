use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};
use parking_lot::RwLock;
use qrcode::render::unicode;
use qrcode::QrCode;
use uuid::Uuid;

#[derive(Clone)]
pub struct AuthManager {
    pin: String,
    secret_token: String,
    authorized_tokens: Arc<RwLock<HashSet<String>>>,
    failed_attempts: Arc<RwLock<HashMap<String, (u32, Instant)>>>,
    lan_ip: String,
    port: u16,
}

#[allow(dead_code)]
impl AuthManager {
    pub fn new(port: u16, custom_pin: Option<String>) -> Self {
        let pin = match custom_pin {
            Some(p) if p.len() >= 4 => p,
            _ => {
                let random_u32 = (Uuid::new_v4().as_u128() % 900_000 + 100_000) as u32;
                format!("{:06}", random_u32)
            }
        };

        let secret_token = Uuid::new_v4().to_string();
        let lan_ip = local_ip_address::local_ip()
            .map(|ip| ip.to_string())
            .unwrap_or_else(|_| "127.0.0.1".to_string());

        let mut auth_tokens = HashSet::new();
        auth_tokens.insert(secret_token.clone());

        Self {
            pin,
            secret_token,
            authorized_tokens: Arc::new(RwLock::new(auth_tokens)),
            failed_attempts: Arc::new(RwLock::new(HashMap::new())),
            lan_ip,
            port,
        }
    }

    pub fn get_pin(&self) -> &str {
        &self.pin
    }

    pub fn get_lan_ip(&self) -> &str {
        &self.lan_ip
    }

    pub fn get_port(&self) -> u16 {
        self.port
    }

    pub fn get_pairing_url(&self) -> String {
        format!("http://{}:{}/?pin={}&token={}", self.lan_ip, self.port, self.pin, self.secret_token)
    }

    pub fn print_startup_banner(&self) {
        let pairing_url = self.get_pairing_url();
        println!("============================================================");
        println!("           PULSEBRIDGE - UNIVERSAL AI IDE COMPANION          ");
        println!("============================================================");
        println!("  Web Dashboard: http://{}:{}", self.lan_ip, self.port);
        println!("  Localhost:     http://localhost:{}", self.port);
        println!("  Access PIN:    {}", self.pin);
        println!("  Pairing URL:   {}", pairing_url);
        println!("------------------------------------------------------------");
        println!("  SCAN TO CONNECT FROM PHONE:");
        
        if let Ok(code) = QrCode::new(pairing_url.as_bytes()) {
            let qr_string = code.render::<unicode::Dense1x2>()
                .dark_color(unicode::Dense1x2::Light)
                .light_color(unicode::Dense1x2::Dark)
                .build();
            println!("{}", qr_string);
        } else {
            println!("  [QR Code generation unavailable]");
        }
        println!("============================================================\n");
    }

    pub fn verify_pin_and_issue_token(&self, client_ip: &str, entered_pin: &str) -> Result<String, String> {
        let now = Instant::now();
        let lockout_duration = Duration::from_secs(300); // 5 minutes lockout

        // 1. Check brute force status for this client IP
        {
            let mut attempts = self.failed_attempts.write();
            if let Some((count, last_time)) = attempts.get(client_ip) {
                if *count >= 5 {
                    if now.duration_since(*last_time) < lockout_duration {
                        let remaining = (lockout_duration - now.duration_since(*last_time)).as_secs();
                        return Err(format!("Too many failed PIN attempts. Locked out for {remaining}s"));
                    } else {
                        // Lockout expired, reset counter
                        attempts.remove(client_ip);
                    }
                }
            }
        }

        // 2. Constant-time comparison to prevent timing attacks
        let is_valid = constant_time_compare(entered_pin.trim().as_bytes(), self.pin.as_bytes());

        if is_valid {
            // Reset failed counter
            self.failed_attempts.write().remove(client_ip);
            let new_token = Uuid::new_v4().to_string();
            self.authorized_tokens.write().insert(new_token.clone());
            Ok(new_token)
        } else {
            // Increment failed attempts
            let mut attempts = self.failed_attempts.write();
            let entry = attempts.entry(client_ip.to_string()).or_insert((0, now));
            entry.0 += 1;
            entry.1 = now;
            let remaining_tries = 5u32.saturating_sub(entry.0);
            if remaining_tries == 0 {
                Err("Maximum PIN attempts exceeded. Client locked out for 5 minutes.".to_string())
            } else {
                Err(format!("Invalid PIN code. {remaining_tries} attempts remaining."))
            }
        }
    }

    pub fn is_token_valid(&self, token: &str) -> bool {
        if token.is_empty() {
            return false;
        }
        self.authorized_tokens.read().contains(token)
    }

    pub fn get_qr_svg(&self) -> Result<String, String> {
        let pairing_url = self.get_pairing_url();
        let code = QrCode::new(pairing_url.as_bytes()).map_err(|e| e.to_string())?;
        let svg = code.render::<qrcode::render::svg::Color>()
            .min_dimensions(200, 200)
            .build();
        Ok(svg)
    }
}

// Constant-time slice comparison
fn constant_time_compare(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (byte_a, byte_b) in a.iter().zip(b.iter()) {
        diff |= byte_a ^ byte_b;
    }
    diff == 0
}
