import { System, Log, Content, SystemContext } from "./system";
import * as fs from "fs";
import * as path from "path";
import axios from 'axios';

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

/** Persisted mapping: Discord user ID (string) -> small integer profileId for character storage. */
interface ProfilesData {
  lastIndex: number;
  users: Record<string, number>;
}

export class LoginDiscord implements System {
  systemName = "LoginDiscord";
  private discordGuildId: string | undefined;
  private discordBotToken: string | undefined;
  private whitelistRoleId: string | undefined;
  private profilesFilePath: string = "";

  constructor(private log: Log) {}

  async initAsync(ctx: SystemContext): Promise<void> {
    const settings = (ctx as any).settings?.allSettings || {};
    const discordSettings = settings.discordAuth || settings.discord || {};

    this.discordGuildId = discordSettings.guildId || discordSettings.serverId;
    this.discordBotToken = discordSettings.token || discordSettings.botToken;
    this.whitelistRoleId = discordSettings.whitelistRoleId;
    this.profilesFilePath = path.join(process.cwd(), "profiles.json");

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

    if (!gameData) {
      this.log(`No gameData for user ${userId}`);
      ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
      return;
    }

    const accessToken = gameData.accessToken as string | undefined;

    // Require Discord access token. Identity (Discord id, username, etc.) comes only from Discord API response, not from client.
    if (!accessToken || typeof accessToken !== "string" || accessToken.trim() === "") {
      this.log(`No or empty accessToken in gameData for user ${userId}`);
      ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
      ctx.svr.setEnabled(userId, false);
      return;
    }

    this.handleLoginWithAccessToken(userId, accessToken.trim(), ctx);
  }

  /**
   * Validate Discord access token with Discord API, then use verified identity + profiles.json (reference: skyrim-roleplay/skymp).
   */
  private handleLoginWithAccessToken(userId: number, accessToken: string, ctx: SystemContext): void {
    const guidBeforeAsyncOp = ctx.svr.getUserGuid(userId);

    axios
      .get<{ id: string; username?: string; discriminator?: string; avatar?: string }>(
        "https://discord.com/api/v10/users/@me",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 5000,
        }
      )
      .then((response) => {
        const userData = response.data;
        const discordIdFromApi = userData.id;

        if (!discordIdFromApi) {
          this.log(`Discord API did not return user id for user ${userId}`);
          ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
          return;
        }

        if (ctx.svr.isConnected(userId) && ctx.svr.getUserGuid(userId) !== guidBeforeAsyncOp) {
          this.log(`User ${userId} changed guid during async operation`);
          return;
        }

        // Set masterApiId from Discord id (string from API; use as-is for identity)
        const masterApiId = discordIdFromApi;

        // Ensure profiles.json exists and get or create stable profileId
        const profileId = this.getOrCreateProfileId(masterApiId, userId);
        this.log(`Verified Discord user ${masterApiId}. Using profileId: ${profileId}`);

        // Fetch Discord roles (if bot token and guild are configured)
        const roles: string[] = [];
        if (this.discordGuildId && this.discordBotToken) {
          this.getUserDiscordRoles(masterApiId)
            .then((userRoles) => {
              roles.push(...userRoles);
              if (this.whitelistRoleId && !roles.includes(this.whitelistRoleId)) {
                this.log(`User ${masterApiId} does not have whitelist role`);
                ctx.svr.sendCustomPacket(userId, loginFailedNotInTheDiscordServer);
                return;
              }
              this.emit(ctx, "loginSuccess", userId, profileId, roles, masterApiId);
            })
            .catch((err) => {
              this.log(`Failed to get Discord roles for ${masterApiId}:`, err);
              this.emit(ctx, "loginSuccess", userId, profileId, roles, masterApiId);
            });
          return;
        }

        this.emit(ctx, "loginSuccess", userId, profileId, roles, masterApiId);
      })
      .catch((error) => {
        this.log(`Discord token validation failed for user ${userId}:`, error?.message || error);
        ctx.svr.sendCustomPacket(userId, loginFailedNotLoggedViaDiscord);
        ctx.svr.setEnabled(userId, false);
      });
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

  /**
   * Returns a stable integer profileId for the given Discord user ID.
   * Persists mapping in profiles.json so the same user always gets the same profileId
   * (avoids 64-bit Discord IDs overflowing int32 / JS number precision and ensures
   * character list lookups find saved characters on re-login).
   */
  private getOrCreateProfileId(discordId: string, fallbackUserId: number): number {
    if (!discordId) {
      return fallbackUserId;
    }
    const key = discordId.toString();
    let data: ProfilesData;
    if (!fs.existsSync(this.profilesFilePath)) {
      data = { lastIndex: 0, users: {} };
      fs.writeFileSync(this.profilesFilePath, JSON.stringify(data, null, 2), "utf8");
    } else {
      const raw = fs.readFileSync(this.profilesFilePath, "utf8");
      data = JSON.parse(raw) as ProfilesData;
      if (!data.users) {
        data.users = {};
      }
      if (typeof data.lastIndex !== "number") {
        data.lastIndex = 0;
      }
    }
    if (data.users[key] !== undefined) {
      const profileId = data.users[key];
      this.log(`Using stored profileId ${profileId} for Discord user ${key}`);
      return profileId;
    }
    data.lastIndex += 1;
    const profileId = data.lastIndex;
    data.users[key] = profileId;
    fs.writeFileSync(this.profilesFilePath, JSON.stringify(data, null, 2), "utf8");
    this.log(`Assigned new profileId ${profileId} for Discord user ${key}`);
    return profileId;
  }

  private emit(ctx: SystemContext, eventName: string, ...args: unknown[]) {
    (ctx.gm as any).emit(eventName, ...args);
  }
}
