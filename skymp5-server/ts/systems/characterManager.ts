import { Settings } from "../settings";
import { System, Log, Content, SystemContext } from "./system";

type Mp = any; // TODO

interface CharacterInfo {
  visibleId: number;
  name: string;
  raceId: number;
  isFemale: boolean;
}

interface SessionData {
  profileId: number;
  discordRoles: string[];
  discordId?: string;
}

export interface CharacterManagerSettings {
  defaultMaxCharacters: number;
  extraSlotRoleId?: string;
  maxCharactersWithRole: number;
}

const DEFAULT_SETTINGS: CharacterManagerSettings = {
  defaultMaxCharacters: 2,
  maxCharactersWithRole: 3,
  extraSlotRoleId: undefined,
};

export class CharacterManager implements System {
  systemName = "CharacterManager";

  private sessions = new Map<number, SessionData>();
  private settings: CharacterManagerSettings = DEFAULT_SETTINGS;
  private log: Log;

  constructor(log: Log) {
    this.log = log;
  }

  async initAsync(ctx: SystemContext): Promise<void> {
    const settingsObject = await Settings.get();

    // Load character manager settings from server-settings.json
    const allSettings = settingsObject.allSettings as Record<string, unknown> | null;
    if (allSettings?.characterManager) {
      const cmSettings = allSettings.characterManager as Partial<CharacterManagerSettings>;
      this.settings = { ...DEFAULT_SETTINGS, ...cmSettings };
    }

    this.log(`CharacterManager initialized with settings:`, JSON.stringify(this.settings));

    // Listen for loginSuccess event from login systems
    (ctx.gm as any).on("loginSuccess", (userId: number, profileId: number, discordRoles: string[], discordId?: string) => {
      this.handleLoginSuccess(userId, profileId, discordRoles, discordId, ctx);
    });
  }

  disconnect(userId: number, ctx: SystemContext): void {
    // Clean up session data on disconnect
    this.sessions.delete(userId);
  }

  customPacket(
    userId: number,
    type: string,
    content: Content,
    ctx: SystemContext
  ): void {
    switch (type) {
      case "selectCharacter":
        this.handleSelectCharacter(userId, content, ctx);
        break;
      case "createCharacter":
        this.handleCreateCharacter(userId, content, ctx);
        break;
      case "deleteCharacter":
        this.handleDeleteCharacter(userId, content, ctx);
        break;
      case "requestCharacterList":
        // Re-send character list
        this.sendCharacterList(userId, ctx);
        break;
    }
  }

  private handleLoginSuccess(
    userId: number,
    profileId: number,
    discordRoles: string[],
    discordId: string | undefined,
    ctx: SystemContext
  ): void {
    // Store session data
    this.sessions.set(userId, { profileId, discordRoles, discordId });

    // Get characters and send list to client
    this.sendCharacterList(userId, ctx);
  }

  private sendCharacterList(userId: number, ctx: SystemContext): void {
    const session = this.sessions.get(userId);
    if (!session) {
      this.log(`No session found for userId ${userId}`);
      return;
    }

    const mp = ctx.svr as unknown as Mp;
    const actorIds = ctx.svr.getActorsByProfileId(session.profileId);
    const maxSlots = this.getMaxSlots(session.discordRoles);

    const characters: CharacterInfo[] = actorIds.map((actorId, index) => {
      let appearance = null;

      try {
        appearance = mp.get(actorId, "appearance");
      } catch (e) {
        // Ignore
      }

      return {
        visibleId: index + 1,
        name: appearance?.name || "Unnamed",
        raceId: appearance?.raceId || 0,
        isFemale: appearance?.isFemale || false,
      };
    });

    const packet = JSON.stringify({
      customPacketType: "characterList",
      characters,
      maxSlots,
      currentCount: characters.length,
    });

    ctx.svr.sendCustomPacket(userId, packet);
  }

  private handleSelectCharacter(userId: number, content: Content, ctx: SystemContext): void {
    const session = this.sessions.get(userId);
    if (!session) {
      this.log(`No session for userId ${userId} when selecting character`);
      this.sendError(userId, ctx, "No active session. Please reconnect.");
      return;
    }

    const visibleId = content.visibleId as number;
    if (typeof visibleId !== "number" || visibleId < 1) {
      this.sendError(userId, ctx, "Invalid character selection.");
      return;
    }

    const actorIds = ctx.svr.getActorsByProfileId(session.profileId);
    const index = visibleId - 1; // Convert to 0-based index

    if (index < 0 || index >= actorIds.length) {
      this.sendError(userId, ctx, "Character not found.");
      return;
    }

    const actorId = actorIds[index];
    this.log(`User ${userId} selected character visibleId=${visibleId}, actorId=0x${actorId.toString(16)}`);

    // Emit spawnAllowed with the selected actorId
    this.emitSpawnAllowed(userId, session, actorId, ctx);
  }

  private handleCreateCharacter(userId: number, content: Content, ctx: SystemContext): void {
    const session = this.sessions.get(userId);
    if (!session) {
      this.log(`No session for userId ${userId} when creating character`);
      this.sendError(userId, ctx, "No active session. Please reconnect.");
      return;
    }

    const actorIds = ctx.svr.getActorsByProfileId(session.profileId);
    const maxSlots = this.getMaxSlots(session.discordRoles);

    if (actorIds.length >= maxSlots) {
      this.sendError(userId, ctx, `Maximum character limit reached (${maxSlots}).`);
      return;
    }

    // Emit spawnAllowed with actorId=0 to indicate new character creation
    this.log(`User ${userId} creating new character (slot ${actorIds.length + 1}/${maxSlots})`);
    this.emitSpawnAllowed(userId, session, 0, ctx);
  }

  private handleDeleteCharacter(userId: number, content: Content, ctx: SystemContext): void {
    const session = this.sessions.get(userId);
    if (!session) {
      this.log(`No session for userId ${userId} when deleting character`);
      this.sendError(userId, ctx, "No active session. Please reconnect.");
      return;
    }

    const visibleId = content.visibleId as number;
    if (typeof visibleId !== "number" || visibleId < 1) {
      this.sendError(userId, ctx, "Invalid character selection for deletion.");
      return;
    }

    const actorIds = ctx.svr.getActorsByProfileId(session.profileId);
    const index = visibleId - 1; // Convert to 0-based index

    if (index < 0 || index >= actorIds.length) {
      this.sendError(userId, ctx, "Character not found for deletion.");
      return;
    }

    const actorId = actorIds[index];
    this.log(`User ${userId} deleting character visibleId=${visibleId}, actorId=0x${actorId.toString(16)}`);

    // Delete the character
    ctx.svr.destroyActor(actorId);

    // Send updated character list
    this.sendCharacterList(userId, ctx);
  }

  private emitSpawnAllowed(
    userId: number,
    session: SessionData,
    actorId: number,
    ctx: SystemContext
  ): void {
    // Emit spawnAllowed event with actorId parameter
    (ctx.gm as any).emit("spawnAllowed", userId, session.profileId, session.discordRoles, session.discordId, actorId);
  }

  private getMaxSlots(discordRoles: string[]): number {
    const { defaultMaxCharacters, extraSlotRoleId, maxCharactersWithRole } = this.settings;
    
    if (extraSlotRoleId && discordRoles.includes(extraSlotRoleId)) {
      return maxCharactersWithRole;
    }
    
    return defaultMaxCharacters;
  }

  private sendError(userId: number, ctx: SystemContext, message: string): void {
    const packet = JSON.stringify({
      customPacketType: "characterError",
      message,
    });
    ctx.svr.sendCustomPacket(userId, packet);
  }
}