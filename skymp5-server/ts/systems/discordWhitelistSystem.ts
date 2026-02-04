import { Settings } from "../settings";
import { System, SystemContext } from "./system";
import { Client, ClientOptions, GatewayIntentBits } from "discord.js";

type Mp = any; // TODO

export class DiscordWhitelistSystem implements System {
    systemName = "DiscordWhitelistSystem";

    constructor(
    ) { }

    async initAsync(ctx: SystemContext): Promise<void> {
        const settingsObject = await Settings.get();

        let discordAuth = settingsObject.discordAuth;

        if (settingsObject.offlineMode) {
            return console.log("discord whitelist system is disabled due to offline mode");
        }
        if (!discordAuth) {
            return console.warn("discordAuth is missing, skipping Discord whitelist system");
        }
        if (!discordAuth.botToken) {
            return console.warn("discordAuth.botToken is missing, skipping Discord whitelist system");
        }
        if (!discordAuth.guildId) {
            return console.warn("discordAuth.guildId is missing, skipping Discord whitelist system");
        }
        if (!discordAuth.whitelistRoleId) {
            return console.warn("discordAuth.whitelistRoleId is missing, skipping Discord whitelist system");
        }

        const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

        try {
            await client.login(discordAuth.botToken);
        } catch (e) {
            return console.error(`Error logging in Discord client: ${e}`);
        }

        client.on("error", (error) => {
            console.error(error);
        });

        client.on("warn", (message) => {
            console.warn(message);
        })

        client.on("guildMemberUpdate", (oldMember, newMember) => {
            // Not sure if it is possible, but better to protect
            if (!oldMember) {
                return console.warn(`oldMember was ${oldMember} in guildMemberUpdate`);
            }
            if (!newMember) {
                return console.warn(`newMember was ${newMember} in guildMemberUpdate`);
            }

            // Check if whitelist role was removed
            const removedRole = oldMember.roles.cache
                .filter(r => !newMember.roles.cache.has(r.id))
                .first();

            if (removedRole && removedRole.id === discordAuth.whitelistRoleId) {
                const discordId = newMember.id;
                
                const mp = ctx.svr as unknown as Mp;
                const forms = mp.findFormsByPropertyValue("private.indexed.discordId", discordId) as number[];

                forms.forEach(formId => {
                    console.log(`Whitelist role removed from user ${formId.toString(16)}, kicking`);
                    ctx.svr.setEnabled(formId, false);
                });
            }

            // Check if whitelist role was added (for logging)
            const addedRole = newMember.roles.cache
                .filter(r => !oldMember.roles.cache.has(r.id))
                .first();

            if (addedRole && addedRole.id === discordAuth.whitelistRoleId) {
                console.log(`Whitelist role added to user ${newMember.id}, they can now join`);
            }
        });
    }
}