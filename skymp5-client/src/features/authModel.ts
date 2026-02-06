export interface RemoteAuthGameData {
  session: string;
  masterApiId: number;
  discordUsername: string | null;
  discordDiscriminator: string | null;
  discordAvatar: string | null;
  /** Optional Discord OAuth access token; when sent to server, server validates with Discord API for secure identity. */
  accessToken?: string;
}

export interface LocalAuthGameData {
  accessToken: string;
  profileId: number;
};

export interface AuthGameData {
  remote?: RemoteAuthGameData;
  local?: LocalAuthGameData;
};

export const authGameDataStorageKey = "authGameData";
