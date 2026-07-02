#!/bin/bash
# RealSwing Demo Mode — Test Script
# This script starts the demo agents and shows you live SSE data

echo "🚀 Starting RealSwing DEMO MODE..."
echo ""

# Start demo agents
echo "[1/3] Starting agents with Yahoo Finance data..."
curl -s -X POST http://localhost:9010/demo/start | jq '.' || echo "Failed to start demo"
echo ""

# Wait for agents to initialize
sleep 2

echo "[2/3] Dashboard is ready at: http://localhost:5173"
echo "      (Frontend will automatically connect to live SSE stream)"
echo ""

echo "[3/3] Monitoring SSE stream for 30 seconds..."
echo "      (Watch for market_state, analyst_report, trade_signal events)"
echo ""

# Connect to SSE stream and show first 30 seconds of events
timeout 30 curl -s -N http://localhost:9010/stream | head -20

echo ""
echo ""
echo "📊 Demo Summary:"
echo "  ✓ Agents running: http://localhost:9010/health"
echo "  ✓ Current state:   http://localhost:9010/state"
echo "  ✓ Analyst reports: http://localhost:9010/analyst"
echo "  ✓ Trade signals:   http://localhost:9010/signals"
echo "  ✓ Orders log:      http://localhost:9010/orders"
echo ""
echo "🎯 Stop demo with: curl -X POST http://localhost:9010/demo/stop"
echo ""
