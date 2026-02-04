# Database Configuration

The server now uses `server-settings.json` for database configuration instead of environment variables.

## server-settings.json Structure

```json
{
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "skymp",
    "password": "skymp",
    "name": "skymp_auth"
  },
  "jwtSecret": "your_jwt_secret_here_change_in_production",
  "discordAuth": {
    "clientId": "your_discord_client_id",
    "clientSecret": "your_discord_client_secret",
    "guildId": "your_discord_server_id",
    "redirectUri": "http://localhost:3000/auth/discord/callback"
  }
}
```

## Database Setup

1. Install MySQL or MariaDB on your system
2. Create a database for the auth system:
   ```sql
   CREATE DATABASE skymp_auth;
   CREATE USER 'skymp'@'localhost' IDENTIFIED BY 'skymp';
   GRANT ALL PRIVILEGES ON skymp_auth.* TO 'skymp'@'localhost';
   FLUSH PRIVILEGES;
   ```
3. Update the `database` section in your `server-settings.json` with your connection details
4. The server will automatically create the necessary tables on first run

## Migration from Environment Variables

If you were previously using environment variables for database configuration (DB_HOST, DB_PORT, etc.), those are no longer used. Move your settings to the `database` section of `server-settings.json`.

## Troubleshooting

### Error: `auth_gssapi_client` / `AUTH_SWITCH_PLUGIN_ERROR`

If you see:
```
Server requests authentication using unknown plugin auth_gssapi_client
```

Your MySQL/MariaDB user is set to use GSSAPI (Kerberos) authentication, which the Node.js mysql2 driver does not support. Switch the user to a supported auth method:

**MariaDB:**
```sql
-- Connect as root or admin, then:
ALTER USER 'skymp'@'localhost' IDENTIFIED VIA mysql_native_password USING PASSWORD('skymp');
FLUSH PRIVILEGES;
```

**MySQL 8.x:**
```sql
ALTER USER 'skymp'@'localhost' IDENTIFIED WITH mysql_native_password BY 'skymp';
FLUSH PRIVILEGES;
```

Replace `skymp` with your actual username and `'skymp'` with your password. If the user has a different host (e.g. `%`), use that instead of `localhost`:
```sql
ALTER USER 'skymp'@'%' IDENTIFIED WITH mysql_native_password BY 'skymp';
```

---

## Security Notes

- Change the default `jwtSecret` in production
- Use a strong database password
- For production deployments, consider using environment variables to set sensitive values and reading them in your server-settings.json programmatically
