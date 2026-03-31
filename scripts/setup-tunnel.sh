#!/usr/bin/env bash
set -euo pipefail

echo "=== mlaude Cloudflare Tunnel Setup ==="
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
  echo "Error: cloudflared is not installed."
  echo ""
  if [[ "$(uname)" == "Darwin" ]]; then
    echo "Install on macOS with Homebrew:"
    echo "  brew install cloudflared"
  else
    echo "Install instructions:"
    echo "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  fi
  echo ""
  echo "After installing, run this script again."
  exit 1
fi

echo "cloudflared found: $(cloudflared --version)"
echo ""

# Prompt for tunnel name
read -rp "Enter tunnel name [mlaude]: " TUNNEL_NAME
TUNNEL_NAME="${TUNNEL_NAME:-mlaude}"

# Create the tunnel
echo ""
echo "Creating tunnel '${TUNNEL_NAME}'..."
cloudflared tunnel create "${TUNNEL_NAME}"

# Get the tunnel UUID from credentials file
CRED_FILE=$(ls -t ~/.cloudflared/*.json 2>/dev/null | head -n1)
if [[ -z "${CRED_FILE}" ]]; then
  echo "Warning: Could not find tunnel credentials file."
  echo "You may need to configure ~/.cloudflared/config.yml manually."
  exit 1
fi

TUNNEL_ID=$(basename "${CRED_FILE}" .json)

# Generate config.yml
CONFIG_FILE="${HOME}/.cloudflared/config.yml"
cat > "${CONFIG_FILE}" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}

ingress:
  - service: http://localhost:3000
EOF

echo ""
echo "Config written to ${CONFIG_FILE}"
echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Set up DNS routing (replace YOUR_DOMAIN with your domain):"
echo "   cloudflared tunnel route dns ${TUNNEL_NAME} mlaude.YOUR_DOMAIN"
echo ""
echo "2. Start the tunnel:"
echo "   cloudflared tunnel run ${TUNNEL_NAME}"
echo ""
echo "3. Set the MLAUDE_API_KEY environment variable to enable authentication"
echo "   when exposing mlaude externally:"
echo "   export MLAUDE_API_KEY=\"your-secret-key\""
echo ""
echo "   Or add it to your .env file:"
echo "   MLAUDE_API_KEY=your-secret-key"
echo ""
echo "=== Done ==="
