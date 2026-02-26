#!/bin/bash
set -euo pipefail

AGENT_DIR="${AGENT_DIR:-$(cd "$(dirname "$0")" && pwd)}"
INSTALLERS_DIR="${INSTALLERS_DIR:-$AGENT_DIR/installers}"
ARCH="$(uname -m)"

need_root() {
  local cmd="$1"
  cmd="${cmd//\\/\\\\}"
  cmd="${cmd//\"/\\\"}"
  osascript -e "do shell script \"${cmd}\" with administrator privileges"
}

ver_ge() {
  local a="$1"
  local b="$2"
  [[ "$(printf '%s\n%s\n' "$b" "$a" | sort -V | head -n1)" == "$b" ]]
}

node_ok() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  local v
  v="$(node -v | sed 's/^v//')"
  ver_ge "$v" "22.0.0"
}

install_node() {
  local tarball=""
  local nodeDirName=""
  if [[ "$ARCH" == "arm64" ]]; then
    tarball="$INSTALLERS_DIR/node-v24.13.0-darwin-arm64.tar.gz"
    nodeDirName="node-v24.13.0-darwin-arm64"
  else
    tarball="$INSTALLERS_DIR/node-v24.13.0-darwin-x64.tar.gz"
    nodeDirName="node-v24.13.0-darwin-x64"
  fi
  if [[ ! -f "$tarball" ]]; then
    echo "缺少 Node 离线安装包：$tarball"
    return 1
  fi
  echo "安装 Node（$ARCH）..."
  need_root "cd /usr/local && tar -xzf \"$tarball\""
  need_root "cd /usr/local && rm -rf /usr/local/node24 && mv \"$nodeDirName\" /usr/local/node24"
  if [[ -f "$HOME/.zshrc" ]]; then
    grep -q 'export NODE_HOME=/usr/local/node24' "$HOME/.zshrc" || printf '\nexport NODE_HOME=/usr/local/node24\nexport PATH=$NODE_HOME/bin:$PATH\n' >> "$HOME/.zshrc"
  else
    printf 'export NODE_HOME=/usr/local/node24\nexport PATH=$NODE_HOME/bin:$PATH\n' > "$HOME/.zshrc"
  fi
  echo "Node 安装完成"
}

install_ollama() {
  local src="$INSTALLERS_DIR/ollama"
  if [[ ! -f "$src" ]]; then
    echo "缺少 Ollama 二进制：$src"
    return 1
  fi
  echo "安装 Ollama..."
  need_root "cp \"$src\" /usr/local/bin/ollama && chmod +x /usr/local/bin/ollama"
  local plist="$HOME/Library/LaunchAgents/com.ollama.serve.plist"
  cat > "$plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ollama.serve</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/ollama</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/ollama-serve.out.log</string>
  <key>StandardErrorPath</key><string>/tmp/ollama-serve.err.log</string>
</dict>
</plist>
PLIST
  launchctl unload "$plist" >/dev/null 2>&1 || true
  launchctl load "$plist"
  echo "Ollama 安装并已配置自启动"
}

echo "开始离线部署..."
if node_ok; then
  echo "Node 已满足要求"
else
  install_node || true
fi

if command -v ollama >/dev/null 2>&1; then
  echo "Ollama 已存在"
else
  install_ollama || true
fi

echo "部署脚本执行完成" 
