#!/bin/sh
set -eu

source_digest="$(sed -n 's/.*"source_digest"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' /app/ifeval-case.json)"
cat > /app/ifeval-result.json <<EOF
{"benchmark":"IFEval","key":1001,"source_digest":"$source_digest","status":"answered","response":"Good traveler set forth from Tokyo at dawn then seek Kyoto by moonlit rail"}
EOF
