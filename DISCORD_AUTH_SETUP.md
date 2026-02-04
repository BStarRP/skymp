# Discord Authentication Configuration

The SKYMP server now includes integrated Discord authentication. No separate master server is needed.

## Configuration

Add this to your server settings JSON:

```json
{
  "discord": {
    "clientId": "your_discord_client_id",
    "clientSecret": "your_discord_client_secret", 
    "redirectUri": "http://localhost:3000/auth/discord/callback",
    "botToken": "your_discord_bot_token",
    "serverId": "your_discord_server_id"
  }
}
```

## Discord Application Setup

1. Go to https://discord.com/developers/applications
2. Create a new application
3. Go to OAuth2 settings
4. Add redirect URI: `http://localhost:3000/auth/discord/callback` (adjust port if needed)
5. Copy Client ID and Client Secret

## Discord Bot Setup

1. In your Discord application, go to Bot section  
2. Create a bot and copy the token
3. Give bot permission to view server members
4. Get your Discord server ID

## How It Works

- Discord authentication is integrated directly into the skymp5-server
- No external services needed
- Uses the same port as your server UI (typically port+1)
- All endpoints are handled locally:
  - `/api/users/login-discord` - Discord OAuth
  - `/api/users/login-discord/status` - Login status polling
  - `/api/users/me/play/main` - Session creation
  - `/auth/discord/callback` - OAuth callback

Your existing character selection system will work seamlessly with the integrated Discord auth!