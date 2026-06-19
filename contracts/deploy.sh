#!/bin/bash
# contracts/deploy.sh
# Deploys all 4 Impostor Protocol Move contracts to Sui testnet.
# Requires: sui CLI installed and configured (sui client active-address)

set -e

NETWORK="testnet"
GAS_BUDGET=200000000

echo "═══════════════════════════════════════════"
echo "  Impostor Protocol — Contract Deployment"
echo "  Network: $NETWORK"
echo "═══════════════════════════════════════════"

# Confirm active address
ACTIVE_ADDR=$(sui client active-address)
echo ""
echo "Deploying from: $ACTIVE_ADDR"
echo "Make sure this wallet has testnet SUI for gas."
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "→ Building package..."
sui move build

echo ""
echo "→ Publishing to $NETWORK..."
PUBLISH_OUTPUT=$(sui client publish --gas-budget $GAS_BUDGET --json)

echo "$PUBLISH_OUTPUT" > deploy_output.json

PACKAGE_ID=$(echo "$PUBLISH_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
changes = data.get('objectChanges', [])
for c in changes:
    if c.get('type') == 'published':
        print(c['packageId'])
        break
")

echo ""
echo "═══════════════════════════════════════════"
echo "  Package published: $PACKAGE_ID"
echo "═══════════════════════════════════════════"
echo ""
echo "Add this to server/.env :"
echo ""
echo "GAME_REGISTRY_PACKAGE=$PACKAGE_ID"
echo "REPUTATION_STORE_PACKAGE=$PACKAGE_ID"
echo "STAKING_POOL_PACKAGE=$PACKAGE_ID"
echo "ACHIEVEMENT_NFT_PACKAGE=$PACKAGE_ID"
echo ""
echo "(All 4 modules are published in this single package,"
echo " so they share one package ID — just different module paths.)"
echo ""
echo "Full deploy output saved to: contracts/deploy_output.json"
echo ""
echo "Next steps:"
echo "  1. Find the ServerCap object IDs in deploy_output.json"
echo "     (search for 'ServerCap' under objectChanges)"
echo "  2. Find the shared GameRegistry / ReputationStore / PoolRegistry"
echo "     object IDs the same way"
echo "  3. Add all of these to server/.env"
echo "  4. Restart the server"
