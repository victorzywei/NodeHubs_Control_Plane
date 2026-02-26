// GET /agent/install
// Returns a one-click installer script for VPS node agent.

export async function onRequestGet() {
    const script = `#!/usr/bin/env bash
set -euo pipefail

API_BASE=""
NODE_ID=""
NODE_TOKEN=""
POLL_INTERVAL=15
XRAY_CONFIG="/usr/local/etc/xray/config.json"
NODEHUB_DIR="/etc/nodehub"
STATE_DIR="/var/lib/nodehub"

usage() {
  cat <<'EOF'
Usage:
  bash install.sh --api-base <url> --node-id <id> --node-token <token> [--poll-interval 15]
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --api-base) API_BASE="$2"; shift 2 ;;
    --node-id) NODE_ID="$2"; shift 2 ;;
    --node-token) NODE_TOKEN="$2"; shift 2 ;;
    --poll-interval) POLL_INTERVAL="$2"; shift 2 ;;
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

install_base_packages() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y curl jq python3 ca-certificates
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y curl jq python3 ca-certificates
  elif command -v yum >/dev/null 2>&1; then
    yum install -y curl jq python3 ca-certificates
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache curl jq python3 ca-certificates
  else
    echo "Unsupported package manager. Install curl/jq/python3 manually."
    exit 1
  fi
}

install_xray() {
  if command -v xray >/dev/null 2>&1; then
    return
  fi
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install -u root
}

write_converter() {
  cat > /usr/local/bin/nodehub-plan-to-xray.py <<'PY'
#!/usr/bin/env python3
import json
import sys

def fail(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)

def as_int(v, default):
    try:
        return int(v)
    except Exception:
        return default

def build_stream(inbound):
    s = inbound.get("settings", {})
    t = inbound.get("transport", "tcp")
    tls_mode = inbound.get("tls_mode", "none")
    stream = {"network": "tcp", "security": "none"}

    if t == "ws":
        stream["network"] = "ws"
        stream["wsSettings"] = {
            "path": s.get("path", "/"),
            "headers": {"Host": s.get("host", "")},
        }
    elif t == "grpc":
        stream["network"] = "grpc"
        stream["grpcSettings"] = {
            "serviceName": s.get("service_name", "grpc"),
            "multiMode": bool(s.get("multi_mode", False)),
        }
    elif t == "h2":
        stream["network"] = "http"
        host = s.get("host", "")
        stream["httpSettings"] = {
            "path": s.get("path", "/"),
            "host": [host] if host else [],
        }
    elif t == "httpupgrade":
        stream["network"] = "httpupgrade"
        stream["httpupgradeSettings"] = {
            "path": s.get("path", "/"),
            "host": s.get("host", ""),
        }
    elif t == "splithttp":
        stream["network"] = "splithttp"
        stream["splithttpSettings"] = {"path": s.get("path", "/")}
    elif t in ("tcp", "udp"):
        stream["network"] = t
    else:
        fail(f"unsupported transport: {t}")

    if tls_mode == "tls":
        cert = s.get("tls_cert_file", "/etc/ssl/certs/nodehub.crt")
        key = s.get("tls_key_file", "/etc/ssl/private/nodehub.key")
        stream["security"] = "tls"
        stream["tlsSettings"] = {
            "serverName": s.get("sni", ""),
            "certificates": [{"certificateFile": cert, "keyFile": key}],
        }
        alpn = s.get("alpn")
        if isinstance(alpn, list) and alpn:
            stream["tlsSettings"]["alpn"] = alpn
    elif tls_mode == "reality":
        private_key = s.get("reality_private_key") or s.get("private_key")
        server_name = s.get("sni") or s.get("host")
        if not private_key:
            fail("reality requires settings.reality_private_key")
        if not server_name:
            fail("reality requires settings.sni")
        short_id = s.get("short_id", "")
        stream["security"] = "reality"
        stream["realitySettings"] = {
            "show": False,
            "dest": f"{server_name}:443",
            "xver": 0,
            "serverNames": [server_name],
            "privateKey": private_key,
            "shortIds": [short_id],
        }

    return stream

def build_inbound(inbound, default_port):
    s = inbound.get("settings", {})
    proto = inbound.get("protocol")
    port = as_int(s.get("port"), default_port)
    tag = inbound.get("tag") or f"inbound-{proto}"

    base = {
        "tag": tag,
        "protocol": proto,
        "listen": "0.0.0.0",
        "port": port,
        "settings": {},
        "sniffing": {"enabled": True, "destOverride": ["http", "tls", "quic"]},
        "streamSettings": build_stream(inbound),
    }

    if proto == "vless":
        uuid = s.get("uuid")
        if not uuid:
            fail(f"{tag}: vless missing uuid")
        client = {"id": uuid, "level": 0, "email": tag}
        flow = s.get("flow", "")
        if flow:
            client["flow"] = flow
        base["settings"] = {"clients": [client], "decryption": "none"}
    elif proto == "trojan":
        password = s.get("password")
        if not password:
            fail(f"{tag}: trojan missing password")
        base["settings"] = {"clients": [{"password": password, "email": tag}]}
    elif proto == "vmess":
        uuid = s.get("uuid")
        if not uuid:
            fail(f"{tag}: vmess missing uuid")
        base["settings"] = {
            "clients": [{"id": uuid, "alterId": as_int(s.get("alter_id"), 0), "email": tag}],
            "disableInsecureEncryption": False,
        }
    elif proto == "shadowsocks":
        method = s.get("method")
        password = s.get("password")
        if not method or not password:
            fail(f"{tag}: shadowsocks missing method/password")
        base["settings"] = {
            "method": method,
            "password": password,
            "network": "tcp,udp",
        }
    else:
        fail(f"{tag}: unsupported protocol on xray: {proto}")

    return base

def main():
    raw = json.load(sys.stdin)
    plan = raw.get("data", raw)
    if plan.get("node_type") != "vps":
        fail("only vps plan is supported")

    default_port = as_int(plan.get("routing", {}).get("listen_port"), 443)
    inbounds = plan.get("inbounds", [])
    if not inbounds:
        fail("plan has no inbounds")

    built = [build_inbound(ib, default_port) for ib in inbounds]

    out = {
        "log": {"loglevel": "warning"},
        "inbounds": built,
        "outbounds": [
            {"protocol": "freedom", "tag": "direct"},
            {"protocol": "blackhole", "tag": "blocked"},
        ],
    }
    json.dump(out, sys.stdout, indent=2)

if __name__ == "__main__":
    main()
PY
  chmod +x /usr/local/bin/nodehub-plan-to-xray.py
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

    if ! echo "$plan_resp" | /usr/local/bin/nodehub-plan-to-xray.py > "$XRAY_CONFIG" 2>/tmp/nodehub-apply.err; then
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

systemctl daemon-reload
systemctl enable xray >/dev/null 2>&1 || true
systemctl restart xray
systemctl enable nodehub-agent
systemctl restart nodehub-agent

echo "NodeHub agent installed."
echo "Check status:"
echo "  systemctl status nodehub-agent --no-pager"
echo "  journalctl -u nodehub-agent -f"
`;

    return new Response(script, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
}

