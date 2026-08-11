Use the installed Coffee Chat Plugin's public `coffee-chat` entrypoint once.
Then write `/app/protocol-canary.json` as a JSON object with these string
fields:

- `protocol`: `coffee-chat-plugin`
- `entrypoint`: `coffee-chat`
- `status`: `invoked`

Do not include credentials, environment variables, or private Plugin files.
