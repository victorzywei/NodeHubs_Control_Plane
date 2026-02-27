// GET /agent/install
// Returns a one-click installer script for VPS node agent.

export async function onRequestGet() {
    const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE=""
NODE_ID=""
NODE_TOKEN=""
POLL_INTERVAL=15
GITHUB_MIRROR=""
TLS_DOMAIN=""
TLS_DOMAIN_ALT=""
CF_API_TOKEN=""
CF_ZONE_ID=""
XRAY_CONFIG="/usr/local/etc/xray/config.json"
NODEHUB_DIR="/etc/nodehub"
STATE_DIR="/var/lib/nodehub"

usage() {
  cat <<'EOF'
Usage:
  bash install.sh --api-base <url> --node-id <id> --node-token <token> [--poll-interval 15] [--github-mirror <url>] [--tls-domain <domain>] [--tls-domain-alt <domain>] [--cf-api-token <token>] [--cf-zone-id <zone_id>]
EOF
}

build_github_url() {
  local url="$1"
  if [[ -z "$GITHUB_MIRROR" ]]; then
    echo "$url"
    return
  fi

  local mirror="\${GITHUB_MIRROR%/}"
  if [[ "$mirror" == *"{url}"* ]]; then
    echo "\${mirror//\{url\}/$url}"
  else
    echo "$mirror/$url"
  fi
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-token) NODE_TOKEN="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
    --github-mirror) GITHUB_MIRROR="$2"; shift 2 ;;
    --tls-domain) TLS_DOMAIN="$2"; shift 2 ;;
    --tls-domain-alt) TLS_DOMAIN_ALT="$2"; shift 2 ;;
    --cf-api-token) CF_API_TOKEN="$2"; shift 2 ;;
    --cf-zone-id) CF_ZONE_ID="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1"; usage; exit 1 ;;
  esac
done

if [[ -z "$API_BASE" || -z "$NODE_ID" || -z "$NODE_TOKEN" ]]; then
  usage
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

if [[ -n "$GITHUB_MIRROR" && ! "$GITHUB_MIRROR" =~ ^https?:// ]]; then
  echo "Warning: invalid --github-mirror value '$GITHUB_MIRROR', fallback to default GitHub URL."
  GITHUB_MIRROR=""
fi

if [[ -n "$TLS_DOMAIN" && ! "$TLS_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Warning: invalid --tls-domain value '$TLS_DOMAIN', skip automatic TLS certificate setup."
  TLS_DOMAIN=""
fi

if [[ -n "$TLS_DOMAIN_ALT" && ! "$TLS_DOMAIN_ALT" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "Warning: invalid --tls-domain-alt value '$TLS_DOMAIN_ALT', ignore alternate TLS domain."
  TLS_DOMAIN_ALT=""
fi
if [[ -n "$TLS_DOMAIN_ALT" && "$TLS_DOMAIN_ALT" == "$TLS_DOMAIN" ]]; then
  TLS_DOMAIN_ALT=""
fi

install_base_packages() {
  local missing=()
  for bin in curl jq unzip python3; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      missing+=("$bin")
    fi
  done

  if [[ "\${#missing[@]}" -eq 0 ]]; then
    return
  fi

  install_jq_binary() {
    local arch url tmp
    arch="$(uname -m)"
    case "$arch" in
      x86_64|amd64) url="$(build_github_url "https://github.com/jqlang/jq/releases/latest/download/jq-linux-amd64")" ;;
      aarch64|arm64) url="$(build_github_url "https://github.com/jqlang/jq/releases/latest/download/jq-linux-arm64")" ;;
      *)
        echo "Unsupported architecture for jq binary fallback: $arch"
        return 1
        ;;
    esac
    tmp="$(mktemp)"
    if ! curl -fsSL "$url" -o "$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    install -m 0755 "$tmp" /usr/local/bin/jq
    rm -f "$tmp"
  }

  pkg_install_failed=0
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y 2>/dev/null && apt-get install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
  elif command -v dnf >/dev/null 2>&1; then
    if dnf repolist enabled >/dev/null 2>&1; then
      dnf install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
    else
      pkg_install_failed=1
    fi
  elif command -v yum >/dev/null 2>&1; then
    if yum repolist enabled >/dev/null 2>&1; then
      yum install -y "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
    else
      pkg_install_failed=1
    fi
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "\${missing[@]}" ca-certificates 2>/dev/null || pkg_install_failed=1
  else
    pkg_install_failed=1
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "Trying jq binary fallback..."
    install_jq_binary || true
  fi

  for bin in curl jq unzip python3; do
    if ! command -v "$bin" >/dev/null 2>&1; then
      echo "Missing required tools: \${missing[*]}"
      if [[ "$pkg_install_failed" -eq 1 ]]; then
        echo "Package-manager install failed or repositories are unavailable."
        echo "Attempting manual installation..."
        
        # Try manual jq installation
        if [[ "$bin" == "jq" ]]; then
          install_jq_binary || {
            echo "Failed to install jq manually."
            echo "Please install jq manually: https://jqlang.github.io/jq/download/"
            exit 1
          }
        else
          echo "Please install '$bin' manually and rerun installer."
          exit 1
        fi
      else
        echo "Please install '$bin' manually and rerun installer."
        exit 1
      fi
    fi
  done
}

write_diag_server() {
  cat > /usr/local/bin/nodehub-diag-server.py <<'PY'
#!/usr/bin/env python3
import json
import os
import ssl
import subprocess
import threading
import time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ENV_FILE = "/etc/nodehub/agent.env"
STATE_FILE = "/var/lib/nodehub/current_version"
AGENT_LOG = "/var/log/nodehub-agent.log"
XRAY_LOG = "/var/log/xray/xray.log"
HTTPS_CERT = "/etc/ssl/certs/nodehub.crt"
HTTPS_KEY = "/etc/ssl/private/nodehub.key"


def load_env():
    env = {}
    if os.path.isfile(ENV_FILE):
        with open(ENV_FILE, "r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def process_running(pattern):
    r = subprocess.run(
        ["pgrep", "-f", pattern],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return r.returncode == 0


def read_last_lines(path, max_lines=200):
    if not os.path.isfile(path):
        return []
    dq = deque(maxlen=max_lines)
    with open(path, "r", encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            dq.append(line.rstrip("\n"))
    return list(dq)


def get_current_version():
    try:
        with open(STATE_FILE, "r", encoding="utf-8", errors="ignore") as fh:
            return int((fh.read() or "0").strip())
    except Exception:
        return 0


def extract_recent_errors(lines, max_items=30):
    keys = ("error", "failed", "invalid", "exception", "timeout", "denied")
    items = [ln for ln in lines if any(k in ln.lower() for k in keys)]
    return items[-max_items:]


def build_diag(node_id):
    agent_lines = read_last_lines(AGENT_LOG, 300)
    xray_lines = read_last_lines(XRAY_LOG, 200)
    return {
        "node_id": node_id,
        "timestamp": int(time.time()),
        "agent_running": process_running("/usr/local/bin/nodehub-agent.sh"),
        "xray_running": process_running("/usr/local/bin/xray run -config"),
        "current_version": get_current_version(),
        "logs": {
            "agent_recent_errors": extract_recent_errors(agent_lines),
            "xray_recent_errors": extract_recent_errors(xray_lines),
            "agent_tail": agent_lines[-80:],
            "xray_tail": xray_lines[-80:],
        },
    }


def render_html(data):
    body = json.dumps(data, ensure_ascii=False, indent=2)
    escaped = (
        body.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )
    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NodeHub 诊断</title>
  <style>
    body {{ font-family: ui-monospace, Menlo, Consolas, monospace; margin: 16px; background: #0b1020; color: #dbeafe; }}
    .card {{ border: 1px solid #223; border-radius: 8px; padding: 12px; background: #0f172a; }}
    pre {{ white-space: pre-wrap; word-break: break-word; margin: 0; }}
  </style>
</head>
<body>
  <div class="card">
    <pre>{escaped}</pre>
  </div>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        env = load_env()
        node_id = env.get("NODE_ID", "")
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        query = parse_qs(parsed.query or "")

        allowed = {"/status"}
        if node_id:
            allowed.add(f"/{node_id}")
        if path not in allowed:
            self.send_response(404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(b'{"success":false,"error":"not found"}')
            return

        data = build_diag(node_id)
        want_json = query.get("format", [""])[0] == "json" or path == "/status"
        if want_json:
            payload = json.dumps({"success": True, "data": data}, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
            return

        html = render_html(data).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(html)

    def log_message(self, _fmt, *_args):
        return


def serve_http():
    httpd = ThreadingHTTPServer(("0.0.0.0", 49480), Handler)
    httpd.serve_forever()


def serve_https():
    if not (os.path.isfile(HTTPS_CERT) and os.path.isfile(HTTPS_KEY)):
        return
    httpd = ThreadingHTTPServer(("0.0.0.0", 49479), Handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=HTTPS_CERT, keyfile=HTTPS_KEY)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    httpd.serve_forever()


def main():
    threads = []
    t_http = threading.Thread(target=serve_http, daemon=True)
    t_http.start()
    threads.append(t_http)

    t_https = threading.Thread(target=serve_https, daemon=True)
    t_https.start()
    threads.append(t_https)

    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
PY
  chmod +x /usr/local/bin/nodehub-diag-server.py
}

install_xray() {
  write_xray_systemd_unit() {
    mkdir -p /usr/local/etc/xray
    if [[ ! -f "$XRAY_CONFIG" ]]; then
      cat > "$XRAY_CONFIG" <<'JSON'
{"log":{"loglevel":"warning"},"inbounds":[{"tag":"placeholder","listen":"127.0.0.1","port":10085,"protocol":"dokodemo-door","settings":{"address":"127.0.0.1"}}],"outbounds":[{"protocol":"freedom","tag":"direct"}]}
JSON
    fi

    if [[ ! -f /etc/systemd/system/xray.service ]]; then
      cat > /etc/systemd/system/xray.service <<'UNIT'
[Unit]
Description=Xray Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/xray run -config /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
    fi
  }

  install_xray_binary_fallback() {
    local arch pkg url tmpdir
    arch="$(uname -m)"
    case "$arch" in
      x86_64|amd64) pkg="Xray-linux-64.zip" ;;
      aarch64|arm64) pkg="Xray-linux-arm64-v8a.zip" ;;
      armv7l|armv7) pkg="Xray-linux-arm32-v7a.zip" ;;
      i386|i686) pkg="Xray-linux-32.zip" ;;
      *)
        echo "Unsupported architecture for Xray fallback install: $arch"
        return 1
        ;;
    esac

    url="$(build_github_url "https://github.com/XTLS/Xray-core/releases/latest/download/$pkg")"
    tmpdir="$(mktemp -d)"
    trap 'rm -rf "$tmpdir"' RETURN

    echo "Fallback: downloading Xray core from $url"
    if ! curl -fL --retry 3 --retry-delay 2 "$url" -o "$tmpdir/xray.zip"; then
      return 1
    fi
    if ! unzip -oq "$tmpdir/xray.zip" -d "$tmpdir/xray"; then
      return 1
    fi
    if [[ ! -f "$tmpdir/xray/xray" ]]; then
      return 1
    fi

    install -m 0755 "$tmpdir/xray/xray" /usr/local/bin/xray
    mkdir -p /usr/local/share/xray
    [[ -f "$tmpdir/xray/geoip.dat" ]] && install -m 0644 "$tmpdir/xray/geoip.dat" /usr/local/share/xray/geoip.dat
    [[ -f "$tmpdir/xray/geosite.dat" ]] && install -m 0644 "$tmpdir/xray/geosite.dat" /usr/local/share/xray/geosite.dat

    write_xray_systemd_unit
    return 0
  }

  if command -v xray >/dev/null 2>&1; then
    echo "Xray already installed."
    return 0
  fi
  
  echo "Installing Xray..."
  local xray_install_url
  xray_install_url="$(build_github_url "https://github.com/XTLS/Xray-install/raw/main/install-release.sh")"
  # Use official installer but suppress systemd errors
  bash -c "$(curl -fsSL "$xray_install_url")" @ install -u root 2>&1 | grep -v "libsystemd-shared" | grep -v "systemctl: error" || true

  if ! command -v xray >/dev/null 2>&1; then
    echo "Official installer failed, trying binary fallback..."
    if ! install_xray_binary_fallback; then
      echo "Error: Xray installation failed"
      exit 1
    fi
  fi

  write_xray_systemd_unit
  echo "Xray installed successfully."
}

install_tls_certificate() {
  if [[ -z "$TLS_DOMAIN" ]]; then
    return 0
  fi

  echo "Setting up TLS certificate for domain: $TLS_DOMAIN"
  if [[ -n "$TLS_DOMAIN_ALT" ]]; then
    echo "Including alternate TLS domain: $TLS_DOMAIN_ALT"
  fi
  mkdir -p /etc/ssl/certs /etc/ssl/private

  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y 2>/dev/null || true
    apt-get install -y socat openssl 2>/dev/null || true
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y socat openssl 2>/dev/null || true
  elif command -v yum >/dev/null 2>&1; then
    yum install -y socat openssl 2>/dev/null || true
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache socat openssl 2>/dev/null || true
  fi

  if [[ ! -x "$HOME/.acme.sh/acme.sh" ]]; then
    if ! curl -fsSL https://get.acme.sh | sh -s email=admin@"$TLS_DOMAIN"; then
      echo "Error: failed to install acme.sh for TLS certificate issue"
      exit 1
    fi
  fi

  # shellcheck disable=SC1091
  source "$HOME/.acme.sh/acme.sh.env" 2>/dev/null || true
  ACME_BIN="$HOME/.acme.sh/acme.sh"
  if [[ ! -x "$ACME_BIN" ]]; then
    echo "Error: acme.sh is not available"
    exit 1
  fi

  "$ACME_BIN" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true
  local domain_args=("-d" "$TLS_DOMAIN")
  if [[ -n "$TLS_DOMAIN_ALT" ]]; then
    domain_args+=("-d" "$TLS_DOMAIN_ALT")
  fi
  local issue_log
  issue_log="$(mktemp /tmp/nodehub-acme-issue.XXXXXX)"
  allow_issue_skip() {
    if grep -q "Skipping. Next renewal time is" "$issue_log" 2>/dev/null; then
      return 0
    fi
    return 1
  }

  if [[ -n "$CF_API_TOKEN" ]]; then
    echo "Issuing certificate via Cloudflare DNS API..."
    export CF_Token="$CF_API_TOKEN"
    if [[ -n "$CF_ZONE_ID" ]]; then
      export CF_Zone_ID="$CF_ZONE_ID"
    fi
    if ! "$ACME_BIN" --issue "\${domain_args[@]}" --dns dns_cf --keylength ec-256 >"$issue_log" 2>&1; then
      cat "$issue_log" || true
      if allow_issue_skip; then
        echo "acme.sh reports cert is still valid, continue with existing cert."
      else
        rm -f "$issue_log"
        echo "Error: failed to issue certificate via Cloudflare DNS for $TLS_DOMAIN"
        echo "Check CF token permissions (Zone.DNS Edit + Zone.Zone Read) and zone scope."
        exit 1
      fi
    else
      cat "$issue_log" || true
    fi
  else
    echo "Issuing certificate via standalone HTTP challenge..."
    if ! "$ACME_BIN" --issue "\${domain_args[@]}" --standalone --keylength ec-256 >"$issue_log" 2>&1; then
      cat "$issue_log" || true
      if allow_issue_skip; then
        echo "acme.sh reports cert is still valid, continue with existing cert."
      else
        rm -f "$issue_log"
        echo "Error: failed to issue certificate for $TLS_DOMAIN"
        echo "Either provide --cf-api-token for DNS mode, or make sure ports 80/443 are reachable and not occupied."
        exit 1
      fi
    else
      cat "$issue_log" || true
    fi
  fi
  rm -f "$issue_log"

  if ! "$ACME_BIN" --install-cert -d "$TLS_DOMAIN" --ecc \
    --fullchain-file /etc/ssl/certs/nodehub.crt \
    --key-file /etc/ssl/private/nodehub.key \
    --reloadcmd "systemctl restart xray >/dev/null 2>&1 || true"; then
    echo "Error: failed to install certificate files"
    exit 1
  fi

  chmod 600 /etc/ssl/private/nodehub.key
  chmod 644 /etc/ssl/certs/nodehub.crt

  setup_tls_renewal() {
    local renew_cmd
    renew_cmd="$ACME_BIN --cron --home $HOME/.acme.sh"

    if command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1; then
      cat > /etc/systemd/system/nodehub-acme-renew.service <<UNIT
[Unit]
Description=NodeHub ACME Renewal
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash -lc '$renew_cmd'
UNIT

      cat > /etc/systemd/system/nodehub-acme-renew.timer <<'UNIT'
[Unit]
Description=Run ACME renewal twice daily

[Timer]
OnCalendar=*-*-* 03,15:20:00
RandomizedDelaySec=900
Persistent=true

[Install]
WantedBy=timers.target
UNIT

      systemctl daemon-reload >/dev/null 2>&1 || true
      systemctl enable --now nodehub-acme-renew.timer >/dev/null 2>&1 || true
    else
      local cron_line
      cron_line="20 3,15 * * * $renew_cmd >/dev/null 2>&1"
      (crontab -l 2>/dev/null | grep -Fv "$renew_cmd"; echo "$cron_line") | crontab - 2>/dev/null || true
    fi
  }

  setup_tls_renewal
  echo "TLS certificate is ready: /etc/ssl/certs/nodehub.crt"
}

write_converter() {
  mkdir -p /usr/local/lib/nodehub
  cat > /usr/local/lib/nodehub/plan-to-xray.jq <<'JQ'
def fail($msg): error($msg);
def as_int($v; $d): try ($v | tonumber) catch $d;
def nonempty: (tostring | length) > 0;

def build_stream:
  . as $in
  | ($in.settings // {}) as $s
  | ($in.transport // "tcp") as $t
  | ($in.tls_mode // "none") as $tls
  | (
      if $t == "ws" then
        {"network":"ws","security":"none","wsSettings":{"path":($s.path // "/"),"headers":{"Host":($s.host // "")}}}
      elif $t == "grpc" then
        {"network":"grpc","security":"none","grpcSettings":{"serviceName":($s.service_name // "grpc"),"multiMode":($s.multi_mode // false)}}
      elif $t == "h2" then
        {"network":"http","security":"none","httpSettings":{"path":($s.path // "/"),"host":(if (($s.host // "") | nonempty) then [($s.host)] else [] end)}}
      elif $t == "httpupgrade" then
        {"network":"httpupgrade","security":"none","httpupgradeSettings":{"path":($s.path // "/"),"host":($s.host // "")}}
      elif $t == "splithttp" then
        {"network":"splithttp","security":"none","splithttpSettings":{"path":($s.path // "/")}}
      elif ($t == "tcp" or $t == "udp") then
        {"network":$t,"security":"none"}
      else
        fail("unsupported transport: \($t)")
      end
    ) as $base
  | if $tls == "tls" then
      $base + {
        "security":"tls",
        "tlsSettings":{
          "serverName":($s.sni // ""),
          "certificates":[{"certificateFile":($s.tls_cert_file // "/etc/ssl/certs/nodehub.crt"),"keyFile":($s.tls_key_file // "/etc/ssl/private/nodehub.key")}]
        }
      }
      | if (($s.alpn // null) | type) == "array" and (($s.alpn // []) | length) > 0 then
          .tlsSettings.alpn = $s.alpn
        else
          .
        end
    elif $tls == "reality" then
      ($s.reality_private_key // $s.private_key // "") as $pk
      | ($s.sni // $s.host // "") as $sn
      | if ($pk | nonempty) | not then
          fail("reality requires settings.reality_private_key")
        elif ($sn | nonempty) | not then
          fail("reality requires settings.sni")
        else
          $base + {
            "security":"reality",
            "realitySettings":{
              "show":false,
              "dest":"\($sn):443",
              "xver":0,
              "serverNames":[ $sn ],
              "privateKey":$pk,
              "shortIds":[($s.short_id // "")]
            }
          }
        end
    else
      $base
    end;

def build_inbound($default_port):
  . as $in
  | ($in.settings // {}) as $s
  | ($in.protocol // "") as $proto
  | ($in.tag // ("inbound-" + $proto)) as $tag
  | {
      "tag": $tag,
      "protocol": $proto,
      "listen": "0.0.0.0",
      "port": as_int(($s.port // $default_port); $default_port),
      "settings": {},
      "sniffing": {"enabled": true, "destOverride": ["http", "tls", "quic"]},
      "streamSettings": ($in | build_stream)
    }
  | if $proto == "vless" then
      ($s.uuid // "") as $uuid
      | if ($uuid | nonempty) | not then
          fail("\($tag): vless missing uuid")
        else
          .settings = {"clients":[{"id":$uuid,"level":0,"email":$tag}],"decryption":"none"}
          | if (($s.flow // "") | nonempty) then .settings.clients[0].flow = $s.flow else . end
        end
    elif $proto == "trojan" then
      ($s.password // "") as $password
      | if ($password | nonempty) | not then
          fail("\($tag): trojan missing password")
        else
          .settings = {"clients":[{"password":$password,"email":$tag}]}
        end
    elif $proto == "vmess" then
      ($s.uuid // "") as $uuid
      | if ($uuid | nonempty) | not then
          fail("\($tag): vmess missing uuid")
        else
          .settings = {"clients":[{"id":$uuid,"alterId":as_int(($s.alter_id // 0); 0),"email":$tag}],"disableInsecureEncryption":false}
        end
    elif $proto == "shadowsocks" then
      ($s.method // "") as $method
      | ($s.password // "") as $password
      | if (($method | nonempty) and ($password | nonempty)) | not then
          fail("\($tag): shadowsocks missing method/password")
        else
          .settings = {"method":$method,"password":$password,"network":"tcp,udp"}
        end
    else
      fail("\($tag): unsupported protocol on xray: \($proto)")
    end;

. as $raw
| ($raw.data // $raw) as $plan
| if ($plan.node_type // "") != "vps" then fail("only vps plan is supported") else . end
| ($plan.inbounds // []) as $inbounds
| if ($inbounds | length) == 0 then fail("plan has no inbounds") else . end
| ($plan.routing.listen_port // 443 | as_int(.; 443)) as $default_port
| {
    "log":{"loglevel":"warning"},
    "inbounds":($inbounds | map(build_inbound($default_port))),
    "outbounds":[
      {"protocol":"freedom","tag":"direct"},
      {"protocol":"blackhole","tag":"blocked"}
    ]
  }
JQ

  cat > /usr/local/bin/nodehub-plan-to-xray <<'SH'
#!/usr/bin/env bash
set -euo pipefail
jq -f /usr/local/lib/nodehub/plan-to-xray.jq
SH
  chmod +x /usr/local/bin/nodehub-plan-to-xray
}

write_agent_script() {
  cat > /usr/local/bin/nodehub-agent.sh <<'SH'
#!/usr/bin/env bash
set -u

if [[ -f /etc/nodehub/agent.env ]]; then
  # shellcheck disable=SC1091
  source /etc/nodehub/agent.env
fi

mkdir -p /var/lib/nodehub /usr/local/etc/xray
STATE_FILE="/var/lib/nodehub/current_version"
[[ -f "$STATE_FILE" ]] || echo 0 > "$STATE_FILE"
XRAY_PID_FILE="/var/run/nodehub-xray.pid"

log() { echo "[$(date -u +'%Y-%m-%dT%H:%M:%SZ')] $*"; }

test_xray_config() {
  if xray run -test -config "$XRAY_CONFIG" >/dev/null 2>&1; then
    return 0
  fi
  if xray -test -config "$XRAY_CONFIG" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

report_apply_result() {
  local version="$1"
  local status="$2"
  local message="$3"
  local payload
  payload=$(jq -cn \
    --arg node_id "$NODE_ID" \
    --argjson version "$version" \
    --arg status "$status" \
    --arg message "$message" \
    '{node_id:$node_id, version:$version, status:$status, message:$message}')
  curl -fsS -X POST \
    -H "Content-Type: application/json" \
    -H "X-Node-Token: $NODE_TOKEN" \
    -d "$payload" \
    "$API_BASE/agent/apply-result" >/dev/null || true
}

restart_xray() {
  if command -v systemctl >/dev/null 2>&1 && systemctl daemon-reload >/dev/null 2>&1; then
    systemctl restart xray
    return $?
  fi

  # non-systemd fallback: restart managed xray process and refresh pid file
  if [[ -f "$XRAY_PID_FILE" ]]; then
    old_pid=$(cat "$XRAY_PID_FILE" 2>/dev/null || true)
    if [[ -n "\${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
      sleep 1
    fi
  fi
  pkill -f "/usr/local/bin/xray run -config $XRAY_CONFIG" 2>/dev/null || true
  mkdir -p /var/log/xray
  nohup /usr/local/bin/xray run -config "$XRAY_CONFIG" >/var/log/xray/xray.log 2>&1 &
  new_pid=$!
  echo "$new_pid" > "$XRAY_PID_FILE"
  sleep 1
  if kill -0 "$new_pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

while true; do
  current_version=$(cat "$STATE_FILE" 2>/dev/null || echo 0)

  version_resp=$(curl -fsS \
    -H "X-Node-Token: $NODE_TOKEN" \
    "$API_BASE/agent/version?node_id=$NODE_ID&current_version=$current_version" 2>/tmp/nodehub-version.err || true)
  if [[ -z "$version_resp" ]]; then
    log "version check failed: $(cat /tmp/nodehub-version.err 2>/dev/null)"
    sleep "$POLL_INTERVAL"
    continue
  fi

  ok=$(echo "$version_resp" | jq -r '.success // false')
  if [[ "$ok" != "true" ]]; then
    log "version API error: $(echo "$version_resp" | jq -cr '.error // .')"
    sleep "$POLL_INTERVAL"
    continue
  fi

  needs_update=$(echo "$version_resp" | jq -r '.data.needs_update')
  target_version=$(echo "$version_resp" | jq -r '.data.target_version')

  if [[ "$needs_update" == "true" ]]; then
    log "update required: $current_version -> $target_version"
    plan_resp=$(curl -fsS \
      -H "X-Node-Token: $NODE_TOKEN" \
      "$API_BASE/agent/plan?node_id=$NODE_ID&version=$target_version" 2>/tmp/nodehub-plan.err || true)

    if [[ -z "$plan_resp" ]]; then
      msg="download plan failed: $(cat /tmp/nodehub-plan.err 2>/dev/null)"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! echo "$plan_resp" | jq -e '.success == true' >/dev/null 2>&1; then
      msg="invalid plan response"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    tmp_cfg=$(mktemp /tmp/nodehub-xray-config.XXXXXX)
    if ! echo "$plan_resp" | /usr/local/bin/nodehub-plan-to-xray > "$tmp_cfg" 2>/tmp/nodehub-apply.err; then
      msg=$(tr '\n' ' ' < /tmp/nodehub-apply.err | cut -c1-500)
      log "plan convert failed: $msg"
      report_apply_result "$target_version" "failed" "plan convert failed: $msg"
      rm -f "$tmp_cfg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! xray run -test -config "$tmp_cfg" >/dev/null 2>&1 && ! xray -test -config "$tmp_cfg" >/dev/null 2>&1; then
      msg="xray config test failed"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      rm -f "$tmp_cfg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    prev_cfg="$XRAY_CONFIG.bak"
    cp "$XRAY_CONFIG" "$prev_cfg" 2>/dev/null || true
    if ! install -m 600 "$tmp_cfg" "$XRAY_CONFIG" 2>/tmp/nodehub-install.err; then
      msg=$(tr '\n' ' ' < /tmp/nodehub-install.err | cut -c1-500)
      log "xray config install failed: $msg"
      report_apply_result "$target_version" "failed" "xray config install failed: $msg"
      rm -f "$tmp_cfg"
      sleep "$POLL_INTERVAL"
      continue
    fi
    rm -f "$tmp_cfg"

    if ! test_xray_config; then
      msg="xray config test failed"
      log "$msg"
      if [[ -f "$prev_cfg" ]]; then
        cp "$prev_cfg" "$XRAY_CONFIG" 2>/dev/null || true
      fi
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! restart_xray >/tmp/nodehub-restart.err 2>&1; then
      msg=$(tr '\n' ' ' < /tmp/nodehub-restart.err | cut -c1-500)
      log "xray restart failed: $msg"
      if [[ -f "$prev_cfg" ]]; then
        cp "$prev_cfg" "$XRAY_CONFIG" 2>/dev/null || true
        restart_xray >/dev/null 2>&1 || true
      fi
      report_apply_result "$target_version" "failed" "xray restart failed: $msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    rm -f "$prev_cfg" 2>/dev/null || true
    echo "$target_version" > "$STATE_FILE"
    report_apply_result "$target_version" "success" "applied"
    log "applied version $target_version"
  fi

  sleep "$POLL_INTERVAL"
done
SH
  chmod +x /usr/local/bin/nodehub-agent.sh
}

write_systemd_unit() {
  cat > /etc/systemd/system/nodehub-agent.service <<'UNIT'
[Unit]
Description=NodeHub VPS Agent
After=network-online.target xray.service
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/nodehub/agent.env
ExecStart=/usr/local/bin/nodehub-agent.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

  cat > /etc/systemd/system/nodehub-diagnostics.service <<'UNIT'
[Unit]
Description=NodeHub Diagnostics Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
EnvironmentFile=/etc/nodehub/agent.env
ExecStart=/usr/local/bin/nodehub-diag-server.py
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
}

write_env_file() {
  mkdir -p "$NODEHUB_DIR" "$STATE_DIR"
  cat > "$NODEHUB_DIR/agent.env" <<EOF
API_BASE=$API_BASE
NODE_ID=$NODE_ID
NODE_TOKEN=$NODE_TOKEN
POLL_INTERVAL=$POLL_INTERVAL
XRAY_CONFIG=$XRAY_CONFIG
EOF
  chmod 600 "$NODEHUB_DIR/agent.env"
}

install_base_packages
install_xray
install_tls_certificate
write_converter
write_agent_script
write_diag_server
write_systemd_unit
write_env_file

# Try systemd first, but don't fail if it doesn't work
USE_SYSTEMD=false
if command -v systemctl >/dev/null 2>&1; then
  # Test if systemctl actually works
  if systemctl daemon-reload 2>/dev/null; then
    USE_SYSTEMD=true
  fi
fi

if [ "$USE_SYSTEMD" = true ]; then
  echo "Starting services with systemd..."
  systemctl enable xray 2>/dev/null || true
  systemctl enable nodehub-agent 2>/dev/null || true
  systemctl enable nodehub-diagnostics 2>/dev/null || true
  
  if systemctl restart nodehub-agent 2>/dev/null; then
    systemctl restart nodehub-diagnostics 2>/dev/null || true
    if systemctl restart xray 2>/dev/null; then
      echo "Services started successfully via systemd."
    else
      echo "NodeHub agent started via systemd; xray will be restarted after first plan is applied."
    fi
  else
    echo "systemd start failed for nodehub-agent, falling back to manual start..."
    USE_SYSTEMD=false
  fi
fi

if [ "$USE_SYSTEMD" = false ]; then
  echo "Starting services manually..."
  
  # Kill any existing processes
  pkill -f "xray run" 2>/dev/null || true
  pkill -f "nodehub-agent.sh" 2>/dev/null || true
  pkill -f "nodehub-agent-watchdog.sh" 2>/dev/null || true
  pkill -f "nodehub-diag-server.py" 2>/dev/null || true
  sleep 1
  
  # Start Xray
  mkdir -p /var/log/xray
  nohup /usr/local/bin/xray run -config "$XRAY_CONFIG" >/var/log/xray/xray.log 2>&1 &
  XRAY_PID=$!
  echo "$XRAY_PID" > /var/run/nodehub-xray.pid
  echo "Xray started (PID: $XRAY_PID)"
  
  # Start NodeHub agent
  nohup /usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
  AGENT_PID=$!
  echo "NodeHub agent started (PID: $AGENT_PID)"

  # Start diagnostics server
  nohup /usr/local/bin/nodehub-diag-server.py >/var/log/nodehub-diag.log 2>&1 &
  DIAG_PID=$!
  echo "NodeHub diagnostics started (PID: $DIAG_PID)"

  # Keep agent process alive in non-systemd environments
  cat > /usr/local/bin/nodehub-agent-watchdog.sh <<'WATCHDOG'
#!/usr/bin/env bash
set -u
while true; do
  if ! pgrep -f "/usr/local/bin/nodehub-agent.sh" >/dev/null 2>&1; then
    nohup /usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
  fi
  if ! pgrep -f "/usr/local/bin/nodehub-diag-server.py" >/dev/null 2>&1; then
    nohup /usr/local/bin/nodehub-diag-server.py >/var/log/nodehub-diag.log 2>&1 &
  fi
  sleep 5
done
WATCHDOG
  chmod +x /usr/local/bin/nodehub-agent-watchdog.sh
  nohup /usr/local/bin/nodehub-agent-watchdog.sh >/var/log/nodehub-agent-watchdog.log 2>&1 &
  
  # Create a simple init script for auto-start on reboot
  cat > /etc/rc.local <<'RCLOCAL'
#!/bin/bash
/usr/local/bin/xray run -config /usr/local/etc/xray/config.json >/var/log/xray/xray.log 2>&1 &
/usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
/usr/local/bin/nodehub-diag-server.py >/var/log/nodehub-diag.log 2>&1 &
/usr/local/bin/nodehub-agent-watchdog.sh >/var/log/nodehub-agent-watchdog.log 2>&1 &
RCLOCAL
  chmod +x /etc/rc.local 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "✓ NodeHub agent installation completed!"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Node ID: $NODE_ID"
echo "  API Base: $API_BASE"
echo "  Poll Interval: \${POLL_INTERVAL}s"
if [[ -n "$GITHUB_MIRROR" ]]; then
  echo "  GitHub Mirror: $GITHUB_MIRROR"
fi
if [[ -n "$TLS_DOMAIN" ]]; then
  echo "  TLS Domain: $TLS_DOMAIN"
  if [[ -n "$TLS_DOMAIN_ALT" ]]; then
    echo "  TLS Domain Alt: $TLS_DOMAIN_ALT"
  fi
  if [[ -n "$CF_API_TOKEN" ]]; then
    echo "  TLS Mode  : Cloudflare DNS"
  else
    echo "  TLS Mode  : Standalone HTTP"
  fi
  echo "  TLS Cert: /etc/ssl/certs/nodehub.crt"
  echo "  TLS Key : /etc/ssl/private/nodehub.key"
  echo "  TLS Renewal: enabled (acme.sh + timer/cron)"
fi
echo ""
if [ "$USE_SYSTEMD" = true ]; then
  echo "Service Management (systemd):"
  echo "  systemctl status nodehub-agent"
  echo "  systemctl status nodehub-diagnostics"
  echo "  systemctl status xray"
  echo "  journalctl -u nodehub-agent -f"
else
  echo "Service Management (manual):"
  echo "  ps aux | grep -E 'xray|nodehub-agent'"
  echo "  tail -f /var/log/nodehub-agent.log"
  echo "  tail -f /var/log/nodehub-diag.log"
  echo "  tail -f /var/log/xray/xray.log"
  echo ""
  echo "  To stop: pkill -f 'xray run' && pkill -f 'nodehub-agent.sh'"
fi
echo ""
`;

    return new Response(script, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}
