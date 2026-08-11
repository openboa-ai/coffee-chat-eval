#!/bin/sh
set -eu

printf '%s\n' '{"protocol":"coffee-chat-plugin","entrypoint":"coffee-chat","status":"invoked"}' > /app/protocol-canary.json
