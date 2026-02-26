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
XRAY_CONFIG="/usr/local/etc/xray/config.json"
NODEHUB_DIR="/etc/nodehub"
STATE_DIR="/var/lib/nodehub"

usage() {
  cat <<'EOF'
Usage:
  bash install.sh --api-base <url> --node-id <id> --node-token <token> [--poll-interval 15] [--github-mirror <url>]
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

install_base_packages() {
  local missing=()
  for bin in curl jq; do
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

  for bin in curl jq; do
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

install_xray() {
  if command -v xray >/dev/null 2>&1; then
    echo "Xray already installed."
    return 0
  fi
  
  echo "Installing Xray..."
  local xray_install_url
  xray_install_url="$(build_github_url "https://github.com/XTLS/Xray-install/raw/main/install-release.sh")"
  # Use official installer but suppress systemd errors
  bash -c "$(curl -fsSL "$xray_install_url")" @ install -u root 2>&1 | grep -v "libsystemd-shared" | grep -v "systemctl: error" || true
  
  # Verify xray binary exists
  if ! command -v xray >/dev/null 2>&1; then
    echo "Error: Xray installation failed"
    exit 1
  fi
  
  echo "Xray installed successfully."
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

    if ! echo "$plan_resp" | /usr/local/bin/nodehub-plan-to-xray > "$XRAY_CONFIG" 2>/tmp/nodehub-apply.err; then
      msg=$(tr '\n' ' ' < /tmp/nodehub-apply.err | cut -c1-500)
      log "plan convert failed: $msg"
      report_apply_result "$target_version" "failed" "plan convert failed: $msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! test_xray_config; then
      msg="xray config test failed"
      log "$msg"
      report_apply_result "$target_version" "failed" "$msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

    if ! systemctl restart xray >/tmp/nodehub-restart.err 2>&1; then
      msg=$(tr '\n' ' ' < /tmp/nodehub-restart.err | cut -c1-500)
      log "xray restart failed: $msg"
      report_apply_result "$target_version" "failed" "xray restart failed: $msg"
      sleep "$POLL_INTERVAL"
      continue
    fi

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
write_converter
write_agent_script
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
  
  if systemctl restart xray 2>/dev/null && systemctl restart nodehub-agent 2>/dev/null; then
    echo "Services started successfully via systemd."
  else
    echo "systemd start failed, falling back to manual start..."
    USE_SYSTEMD=false
  fi
fi

if [ "$USE_SYSTEMD" = false ]; then
  echo "Starting services manually..."
  
  # Kill any existing processes
  pkill -f "xray run" 2>/dev/null || true
  pkill -f "nodehub-agent.sh" 2>/dev/null || true
  sleep 1
  
  # Start Xray
  mkdir -p /var/log/xray
  nohup /usr/local/bin/xray run -config "$XRAY_CONFIG" >/var/log/xray/xray.log 2>&1 &
  XRAY_PID=$!
  echo "Xray started (PID: $XRAY_PID)"
  
  # Start NodeHub agent
  nohup /usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
  AGENT_PID=$!
  echo "NodeHub agent started (PID: $AGENT_PID)"
  
  # Create a simple init script for auto-start on reboot
  cat > /etc/rc.local <<'RCLOCAL'
#!/bin/bash
/usr/local/bin/xray run -config /usr/local/etc/xray/config.json >/var/log/xray/xray.log 2>&1 &
/usr/local/bin/nodehub-agent.sh >/var/log/nodehub-agent.log 2>&1 &
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
echo ""
if [ "$USE_SYSTEMD" = true ]; then
  echo "Service Management (systemd):"
  echo "  systemctl status nodehub-agent"
  echo "  systemctl status xray"
  echo "  journalctl -u nodehub-agent -f"
else
  echo "Service Management (manual):"
  echo "  ps aux | grep -E 'xray|nodehub-agent'"
  echo "  tail -f /var/log/nodehub-agent.log"
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
