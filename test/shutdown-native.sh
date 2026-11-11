#!/bin/sh
set -eu
ulimit -c 0
test_dir=$(mktemp -d)
trap 'rm -rf -- "$test_dir"' EXIT
headers=$(node -p 'require("node:path").resolve(process.execPath, "../../include/node")')
g++ -std=c++20 -O2 -shared -fPIC -I "$headers" test/fixtures/native-fault.cc -o "$test_dir/fault.node"
SHUTDOWN_NATIVE_ADDON="$test_dir/fault.node" node --test test/shutdown-signals.test.cjs
