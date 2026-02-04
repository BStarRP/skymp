import { Settings } from "../settings";
import { System, Log, SystemContext } from "./system";

type Mp = any; // TODO

function randomInteger(min: number, max: number) {
  const rand = min + Math.random() * (max + 1 - min);
  return Math.floor(rand);
}

export class Spawn implements System {
  systemName = "Spawn";
  constructor(private log: Log) { }

  async initAsync(ctx: SystemContext): Promise<void> {
    const settingsObject = await Settings.get();
    // spawnAllowed now receives an optional actorId parameter from CharacterManager
    // actorId = 0 means create new character
    // actorId > 0 means load existing character
    const listenerFn = (userId: number, userProfileId: number, discordRoleIds: string[], discordId?: string, selectedActorId?: number) => {
      const { startPoints } = settingsObject;

      let actorId: number;

      if (selectedActorId && selectedActorId > 0) {
        // Load existing character (selected from CharacterManager)
        actorId = selectedActorId;
        this.log("Loading character", actorId.toString(16));
        ctx.svr.setEnabled(actorId, true);
        ctx.svr.setUserActor(userId, actorId);
      } else if (selectedActorId === 0) {
        // Create new character (requested from CharacterManager)
        const idx = randomInteger(0, startPoints.length - 1);
        actorId = ctx.svr.createActor(
          0,
          startPoints[idx].pos,
          startPoints[idx].angleZ,
          +startPoints[idx].worldOrCell,
          userProfileId
        );
        this.log("Creating new character", actorId.toString(16));
        ctx.svr.setUserActor(userId, actorId);
        ctx.svr.setRaceMenuOpen(actorId, true);
      } else {
        // Legacy behavior: auto-select first character or create new one
        // This path is used when CharacterManager is not active
        actorId = ctx.svr.getActorsByProfileId(userProfileId)[0];
        if (actorId) {
          this.log("Loading character (legacy)", actorId.toString(16));
          ctx.svr.setEnabled(actorId, true);
          ctx.svr.setUserActor(userId, actorId);
        } else {
          const idx = randomInteger(0, startPoints.length - 1);
          actorId = ctx.svr.createActor(
            0,
            startPoints[idx].pos,
            startPoints[idx].angleZ,
            +startPoints[idx].worldOrCell,
            userProfileId
          );
          this.log("Creating character (legacy)", actorId.toString(16));
          ctx.svr.setUserActor(userId, actorId);
          ctx.svr.setRaceMenuOpen(actorId, true);
        }
      }

      const mp = ctx.svr as unknown as Mp;
      mp.set(actorId, "private.discordRoles", discordRoleIds);

      if (discordId !== undefined) {
        // This helps us to test if indexes registration works in LoadForm or not
        if (mp.get(actorId, "private.indexed.discordId") !== discordId) {
          mp.set(actorId, "private.indexed.discordId", discordId);
        }

        const forms = mp.findFormsByPropertyValue("private.indexed.discordId", discordId) as number[];
        console.log(`Found forms ${forms}`);
      }
    };
    (ctx.gm as any).on("spawnAllowed", listenerFn);
    (ctx.svr as any)._onSpawnAllowed = listenerFn;
  }

  disconnect(userId: number, ctx: SystemContext): void {
    const actorId = ctx.svr.getUserActor(userId);
    if (actorId !== 0) {
      ctx.svr.setEnabled(actorId, false);
    }
  }
}
