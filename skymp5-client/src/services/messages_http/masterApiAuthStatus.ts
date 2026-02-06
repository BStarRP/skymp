export interface MasterApiAuthStatus {
    token: string;
    masterApiId: number;
    discordUsername: string | null;
    discordDiscriminator: string | null;
    discordAvatar: string | null;
    /** Optional Discord OAuth access token for server-side validation. */
    accessToken?: string;
}
