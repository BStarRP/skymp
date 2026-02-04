import { System, Log, Content, SystemContext } from "./system";
import * as fs from "fs";
import * as path from "path";
import axios from 'axios';

interface UserProfile {
  id: string;
  discordId: string;
  username: string;
  discriminator: string;
  avatar?: string;
}

interface AuthData {
  userId: string;
  username: string;
  discriminator: string;
  avatar?: string;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  authenticatedAt: string;
}

const loginFailedSessionNotFound = JSON.stringify({
  customPacketType: "loginFailedSessionNotFound",
});

const loginFailedNotLoggedViaDiscord = JSON.stringify({
  customPacketType: "loginFailedNotLoggedViaDiscord",
});

const loginFailedNotInTheDiscordServer = JSON.stringify({
  customPacketType: "loginFailedNotInTheDiscordServer",
});

const loginFailedBanned = JSON.stringify({
  customPacketType: "loginFailedBanned",
});

const loginFailedTokenExpired = JSON.stringify({
  customPacketType: "loginFailedTokenExpired",
});

export class LoginDiscord implements System {
  systemName = "LoginDiscord";
  private discordGuildId: string | undefined;
  private discordBotToken: string | undefined;
  private whitelistRoleId: string | undefined;

  constructor(private log: Log) {}

  async initAsync(ctx: SystemContext): Promise<void> {
    const settings = (ctx as any).settings?.allSettings || {};
    const discordSettings = settings.discordAuth || settings.discord || {};

    this.discordGuildId = discordSettings.guildId || discordSettings.serverId;
    this.discordBotToken = discordSettings.token || discordSettings.botToken;
    this.whitelistRoleId = discordSettings.whitelistRoleId;

    this.log("LoginDiscord system initialized");
    if (this.discordGuildId) {
      this.log(`Discord guild/server validation enabled for guild: ${this.discordGuildId}`);
    }
    if (this.whitelistRoleId) {
      this.log(`Discord whitelist role validation enabled for role: ${this.whitelistRoleId}`);
    }
  }

  disconnect(userId: number): void {
    // No cleanup needed
  }

  customPacket(
    userId: number,
    type: string,
    content: Content,
    ctx: SystemContext,
  ): void {
    if (type !== "loginWithSkympIo") {
      return;
    }

    const ip = ctx.svr.getUserIp(userId);
    this.log(`User ${userId} attempting Discord login from ${ip}`);

    const gameData = content["gameData"];

    if (!gameData || !gameData.session) {
      this.log(`No session found in gameData for user ${userId}`);
      ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
      return;
    }

    // Handle Discord authentication validation
    (async () => {
      try {
        const session = gameData.session;
        const guidBeforeAsyncOp = ctx.svr.getUserGuid(userId);

        this.log(`Received session token for user ${userId}: ${session?.substring(0, 10)}...`);

        // For session-based auth, we trust the session token from the launcher
        // The launcher already validated the Discord OAuth
        if (!session || typeof session !== 'string') {
          this.log(`Invalid or missing session token for user ${userId}`);
          ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
          return;
        }

        // Extract user info from gameData if available
        const masterApiId = content["gameData"]?.masterApiId;
        const discordUsername = content["gameData"]?.discordUsername;
        const discordDiscriminator = content["gameData"]?.discordDiscriminator;
        const discordAvatar = content["gameData"]?.discordAvatar;

        this.log(`User ${userId} login details - masterApiId: ${masterApiId}, username: ${discordUsername}`);

        const guidAfterAsyncOp = ctx.svr.isConnected(userId) ? ctx.svr.getUserGuid(userId) : "<disconnected>";

        if (guidBeforeAsyncOp !== guidAfterAsyncOp) {
          this.log(`User ${userId} changed guid during async operation`);
          throw new Error("Guid mismatch after async operation");
        }

        // Create user profile from session data
        const profile: UserProfile = {
          id: masterApiId?.toString() || userId.toString(),
          discordId: masterApiId?.toString() || userId.toString(),
          username: discordUsername || `User${userId}`,
          discriminator: discordDiscriminator || "0000",
          avatar: discordAvatar || null
        };

        // Get Discord roles (if bot token is available and we have Discord ID)
        const roles: string[] = [];
        if (this.discordGuildId && this.discordBotToken && masterApiId) {
          try {
            // Check if user has whitelist role using string Discord ID
            const hasWhitelistRole = await this.checkUserHasWhitelistRole(masterApiId.toString());
            if (!hasWhitelistRole) {
              this.log(`User ${discordUsername || 'unknown'} (${masterApiId}) does not have whitelist role`);
              ctx.svr.sendCustomPacket(userId, loginFailedNotInTheDiscordServer);
              return;
            }

            const userRoles = await this.getUserDiscordRoles(masterApiId.toString());
            roles.push(...userRoles);
          } catch (error) {
            this.log(`Failed to get Discord roles for ${discordUsername || 'unknown'}:`, error);
          }
        }

        this.log(`User ${userId} authenticated successfully as ${discordUsername || 'unknown'}#${discordDiscriminator || '0000'}`);
        // Use Discord ID as profileId (converted to number) for character management, keep discordId as string for API calls
        const profileIdForCharacterManager = masterApiId ? parseInt(masterApiId.toString(), 10) : userId;
        this.emit(ctx, "loginSuccess", userId, profileIdForCharacterManager, roles, profile.discordId);

      } catch (error) {
        this.log(`Login error for user ${userId}:`, error);
        ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
      }
    })();
  }

  private readAuthDataFromDisk(): AuthData | null {
    try {
      const authFilePath = path.join(process.cwd(), '.psc', 'auth.json');

      if (!fs.existsSync(authFilePath)) {
        return null;
      }

      const authFileContent = fs.readFileSync(authFilePath, 'utf8');
      return JSON.parse(authFileContent) as AuthData;

    } catch (error) {
      console.error('Failed to read auth data from disk:', error);
      return null;
    }
  }

  private async validateDiscordToken(accessToken: string): Promise<boolean> {
    try {
      const response = await axios.get('https://discord.com/api/v10/users/@me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        timeout: 5000
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private async checkUserHasWhitelistRole(userId: string): Promise<boolean> {
    if (!this.discordBotToken || !this.discordGuildId || !this.whitelistRoleId) {
      return true; // If not configured, assume valid
    }

    try {
      const response = await axios.get(
        `https://discord.com/api/v10/guilds/${this.discordGuildId}/members/${userId}`,
        {
          headers: {
            'Authorization': `Bot ${this.discordBotToken}`
          },
          timeout: 5000
        }
      );

      const memberRoles = response.data.roles || [];
      return memberRoles.includes(this.whitelistRoleId);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false; // User not in server or doesn't exist
      }
      console.error('Error checking Discord whitelist role:', error);
      return false; // Assume invalid on API error for security
    }
  }

  private async getUserDiscordRoles(userId: string): Promise<string[]> {
    if (!this.discordBotToken || !this.discordGuildId) {
      return [];
    }

    try {
      const response = await axios.get(
        `https://discord.com/api/v10/guilds/${this.discordGuildId}/members/${userId}`,
        {
          headers: {
            'Authorization': `Bot ${this.discordBotToken}`
          },
          timeout: 5000
        }
      );

      return response.data.roles || [];
    } catch (error) {
      console.error('Failed to get Discord roles:', error);
      return [];
    }
  }

  private emit(ctx: SystemContext, eventName: string, ...args: unknown[]) {
    (ctx.gm as any).emit(eventName, ...args);
  }
}
