#!/usr/bin/env bash
# health.sh — project health check for agent-harness-kit

# Check that Node.js is available
command -v node >/dev/null 2>&1 || { echo "FAIL: node not found"; exit 1; }

# Check that npm is available
command -v npm >/dev/null 2>&1 || { echo "FAIL: npm not found"; exit 1; }

# Check that package.json exists
[ -f package.json ] || { echo "FAIL: package.json not found"; exit 1; }

npm run build

if [ $? -ne 0 ]; then
  echo "FAIL: Build failed"
  exit 1
fi

npm run test

if [ $? -ne 0 ]; then
  echo "FAIL: Tests failed"
  exit 1
fi

exit 0
