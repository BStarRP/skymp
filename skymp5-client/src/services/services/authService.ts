import * as crypto from "crypto";
import { AuthGameData, RemoteAuthGameData, authGameDataStorageKey } from "../../features/authModel";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { BrowserMessageEvent, Menu, browser } from "skyrimPlatform";
import { AuthNeededEvent } from "../events/authNeededEvent";
import { BrowserWindowLoadedEvent } from "../events/browserWindowLoadedEvent";
import { TimersService } from "./timersService";
import { MasterApiAuthStatus } from "../messages_http/masterApiAuthStatus";
import { logTrace, logError } from "../../logging";
import { ConnectionMessage } from "../events/connectionMessage";
import { CreateActorMessage } from "../messages/createActorMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { NetworkingService } from "./networkingService";
import { MsgType } from "../../messages";
import { ConnectionDenied } from "../events/connectionDenied";
import { SettingsService } from "./settingsService";
import { CharacterSelectService } from "./characterSelectService";

// Define as module-level variables instead of global declarations
const window: any = (global as any).window || (globalThis as any).window || {};

// Constants used on both client and browser side
const events = {
  openDiscordOauth: 'openDiscordOauth',
  authAttempt: 'authAttemptEvent',
  openGithub: 'openGithub',
  openPatreon: 'openPatreon',
  clearAuthData: 'clearAuthData',
  updateRequired: 'updateRequired',
  backToLogin: 'backToLogin',
  joinDiscord: 'joinDiscord',
  hideBrowser: 'hideBrowser',
};

// Variables used on both client and browser side
let browserState = {
  comment: '',
  failCount: 9000,
  loginFailedReason: '',
};
let authData: RemoteAuthGameData | null = null;

export class AuthService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.emitter.on("authNeeded", (e) => this.onAuthNeeded(e));
    this.controller.emitter.on("browserWindowLoaded", (e) => this.onBrowserWindowLoaded(e));
    this.controller.emitter.on("createActorMessage", (e) => this.onCreateActorMessage(e));
    this.controller.emitter.on("connectionAccepted", () => this.handleConnectionAccepted());
    this.controller.emitter.on("connectionDenied", (e) => this.handleConnectionDenied(e));
    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.on("tick", () => this.onTick());
    this.controller.once("update", () => this.onceUpdate());
  }

  private onAuthNeeded(e: AuthNeededEvent) {
    logTrace(this, `Received authNeeded event`);

    this.setListenBrowserMessage(true, 'authNeeded received');

    // Try to read auth data from disk first
    authData = this.readAuthDataFromDisk();

    // If no auth file exists, check for offline mode settings
    if (!authData) {
      const settingsGameData = this.sp.settings["skymp5-client"]["gameData"] as any;
      const hasOfflineSettings = Number.isInteger(settingsGameData?.profileId);

      if (hasOfflineSettings) {
        logTrace(this, `No auth file found, using offline mode from settings with profileId:`, settingsGameData.profileId);
        this.controller.emitter.emit("authAttempt", {
          authGameData: {
            local: {
              profileId: settingsGameData.profileId,
              accessToken: settingsGameData.accessToken
            }
          }
        });
        return;
      }
    }

    // Auth file exists or no offline settings - show login menu
    if (authData) {
      logTrace(this, `Auth file found, showing login menu with existing auth data`);
    } else {
      logTrace(this, `No auth file and no offline settings, showing login menu`);
    }

    this.setListenBrowserMessage(true, 'regular auth needed');

    // Show browser and load the UI
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);

    // Try to load the UI explicitly
    try {
      this.sp.browser.loadUrl("file:///Data/Platform/UI/index.html");
      logTrace(this, `Attempted to load UI from file:///Data/Platform/UI/index.html`);
    } catch (e) {
      logError(this, `Failed to load UI:`, e);
    }

    // Set trigger flag and wait for browser to load
    this.trigger.authNeededFired = true;
    this.onBrowserWindowLoadedAndOnlineAuthNeeded();
  }

  private onBrowserWindowLoadedShowStartWindow(data: any) {
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);

    authData = data;

    this.sp.browser?.executeJavaScript(`window?.useMenuStore?.getState().onStart(${JSON.stringify(data)})`);
  }

  private onBrowserWindowLoaded(e: BrowserWindowLoadedEvent) {
    logTrace(this, `Received browserWindowLoaded event`);

    this.trigger.browserWindowLoadedFired = true;
    this.onBrowserWindowLoadedAndOnlineAuthNeeded();
  }

  private onCreateActorMessage(e: ConnectionMessage<CreateActorMessage>) {
    if (e.message.isMe) {
      if (this.authDialogOpen) {
        logTrace(this, `Received createActorMessage for self, hiding auth UI`);
        // Hide the auth UI by signaling the React component
        const hideAuthScript = `
          window.skymp = window.skymp || {};
          window.skymp.authCompleted = true;
          window.dispatchEvent(new CustomEvent('skymp:authCompleted'));
        `;
        this.sp.browser.executeJavaScript(hideAuthScript);
        this.authDialogOpen = false;
      } else {
        logTrace(this, `Received createActorMessage for self, but auth dialog was not open`);
      }
    }

    this.loggingStartMoment = 0;
    this.authAttemptProgressIndicator = false;
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    const msg = event.message;

    let msgContent: Record<string, unknown> = {};

    try {
      msgContent = JSON.parse(msg.contentJsonDump);
    } catch (e) {
      if (e instanceof SyntaxError) {
        logError(this, "onCustomPacketMessage failed to parse JSON", e.message, "json:", msg.contentJsonDump);
        return;
      } else {
        throw e;
      }
    }

    switch (msgContent["customPacketType"]) {
      case 'characterList':
        // Stop the connecting-dots loop; we're now on character select
        this.authAttemptProgressIndicator = false;
        this.authAttemptProgressIndicatorCounter = 0;
        this.lastSlowCounter = -1;
        browserState.comment = '';
        break;
      // case 'loginRequired':
      //   logTrace(this, 'loginRequired received');
      //   this.loginWithSkympIoCredentials();
      //   break;
      case 'loginFailedNotLoggedViaDiscord':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedNotLoggedViaDiscord received');
        browserState.loginFailedReason = 'please login via discord';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedNotLoggedViaDiscord received');
        this.loggingStartMoment = 0;
        this.refreshAuthState();
        break;
      case 'loginFailedNotInTheDiscordServer':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedNotInTheDiscordServer received');
        browserState.loginFailedReason = 'please join the discord server';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedNotInTheDiscordServer received');
        this.loggingStartMoment = 0;
        this.refreshAuthState();
        break;
      case 'loginFailedBanned':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedBanned received');
        browserState.loginFailedReason = 'you are banned';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedBanned received');
        this.loggingStartMoment = 0;
        this.refreshAuthState();
        break;
      case 'loginFailedIpMismatch':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedIpMismatch received');
        browserState.loginFailedReason = 'what was that?';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedIpMismatch received');
        this.loggingStartMoment = 0;
        this.refreshAuthState();
        break;
    }
  }

  private onBrowserWindowLoadedAndOnlineAuthNeeded() {
    if (!this.isListenBrowserMessage) {
      logError(this, `isListenBrowserMessage was false for some reason, aborting auth`);
      return;
    }

    if (!this.trigger.conditionMet) {
      logTrace(this, `onBrowserWindowLoadedAndOnlineAuthNeeded waiting for both triggers to load`);
      return;
    }

    if (this.trigger.loaded){
      return;
    }

    this.trigger.loaded = true;

    logTrace(this, `Showing widgets and starting loop`);

    // Make sure auth data is loaded
    //if (!authData) {
      authData = this.readAuthDataFromDisk();
    //}
  
    // Delay initial state injection to ensure React is mounted
    const timersService = this.controller.lookupListener(TimersService);
    timersService.setTimeout(() => {
      logTrace(this, 'Sending initial auth state to React UI');

      this.sp.browser.setVisible(true);
      this.sp.browser.setFocused(true);
      this.refreshAuthState();
    }, 500);

    // Start Discord OAuth login state checking loop
    this.checkLoginState();
  }

  private onBrowserMessage(e: BrowserMessageEvent) {
    if (!this.isListenBrowserMessage) {
      logTrace(this, `onBrowserMessage: isListenBrowserMessage was false, ignoring message`, JSON.stringify(e.arguments));
      return;
    }

    const settingsService = this.controller.lookupListener(SettingsService);

    logTrace(this, `onBrowserMessage:`, JSON.stringify(e.arguments));

    const eventKey = e.arguments[0];
    switch (eventKey) {
      case events.openDiscordOauth:
        logTrace(this, `openDiscordOauth event received, opening browser`);
        browserState.comment = 'opening browser...';
        this.refreshAuthState();

        const settingsService = this.controller.lookupListener(SettingsService);
        const discordAuthBaseUrl = (this.sp.settings["skymp5-client"]["discord-auth-url"] as string) || `http://localhost:${this.getServerPort()}`;
        const discordAuthUrl = `${discordAuthBaseUrl}/api/users/login-discord?state=${this.discordAuthState}`;
        logTrace(this, `Loading Discord OAuth URL:`, discordAuthUrl);
        logTrace(this, `win32 object:`, this.sp.win32);

        try {
          this.sp.win32.loadUrl(discordAuthUrl);
          logTrace(this, `win32.loadUrl called successfully`);
        } catch (error) {
          logError(this, `Failed to call win32.loadUrl:`, error);
        }

        // Launch checkLoginState loop
        this.checkLoginState();
        break;
      case events.authAttempt:
        logTrace(this, `authAttempt event received (Connect button clicked)`);
        logTrace(this, `Current authData:`, authData);

        if (authData === null) {
          logError(this, `authData is null, cannot connect`);
          browserState.comment = 'please login first';
          this.refreshAuthState();
          break;
        }

        logTrace(this, `Emitting authAttempt event with authData:`, JSON.stringify(authData));

        // Store authData in sp.storage so handleConnectionAccepted can access it
        this.sp.storage[authGameDataStorageKey] = { remote: authData };

        // Emit authAttempt event to trigger connection
        this.controller.emitter.emit("authAttempt", { authGameData: { remote: authData } });

        this.authAttemptProgressIndicator = true;

        break;
      case events.clearAuthData:
        // Doesn't seem to be used - launcher manages auth data
        break;
      case events.openGithub:
        this.sp.win32.loadUrl(this.githubUrl);
        break;
      case events.openPatreon:
        this.sp.win32.loadUrl(this.patreonUrl);
        break;
      case events.updateRequired:
        this.sp.win32.loadUrl("https://skymp.net/UpdInstall");
        break;
      case events.backToLogin:
        // Check if user manually went back from character select
        const characterSelectService = this.controller.lookupListener(CharacterSelectService);
        if (characterSelectService && characterSelectService.resetAuthState) {
          logTrace(this, 'User manually went back from character select, resetting auth state');
          // Reset flag
          characterSelectService.resetAuthState = false;
          // Clear progress indicator to prevent auto-connect
          this.authAttemptProgressIndicator = false;
          // Clear logging start moment
          this.loggingStartMoment = 0;
          // Clear any error messages
          browserState.loginFailedReason = '';
          browserState.comment = '';

          this.trigger.loaded = false;
          this.onBrowserWindowLoadedAndOnlineAuthNeeded();
        }

        // Push reset state to React UI immediately so it shows idle (not connecting)
        this.refreshAuthState();

        // Notify React UI to show auth screen in fresh state
        const backToLoginScript = `
          window.dispatchEvent(new CustomEvent('skymp:backToLogin'));
        `;
        this.sp.browser.executeJavaScript(backToLoginScript);
        break;
      case events.joinDiscord:
        this.sp.win32.loadUrl(this.discordUrl);
        break;
      case events.hideBrowser:
        this.sp.browser.setVisible(false);
        this.sp.browser.setFocused(false);
        break;
      case 'requestAuthState':
        logTrace(this, 'React UI requesting auth state, sending current state');
        this.refreshAuthState();
        break;
      default:
        logError(this, `Unknown event key`, eventKey);
        break;
    }
  }

  private createPlaySession(token: string, callback: (res: string, err: string) => void) {
    const client = new this.sp.HttpClient(`http://localhost:${this.getServerPort()}`);

    const route = `/api/users/me/play/main`;
    logTrace(this, `Creating play session ${route}`);

    client.post(route, {
      body: '{}',
      contentType: 'application/json',
      headers: {
        'authorization': `Bearer ${token}`,
      },
      // @ts-ignore
    }, (res) => {
      if (res.status != 200) {
        callback('', 'status code ' + res.status);
      } else {
        // TODO: handle JSON.parse failure?
        callback(JSON.parse(res.body).session, '');
      }
    });
  }

  private checkLoginState() {
    if (!this.isListenBrowserMessage) {
      logTrace(this, `checkLoginState: isListenBrowserMessage was false, aborting check`);
      return;
    }

    const timersService = this.controller.lookupListener(TimersService);

    // Social engineering protection, don't show the full state
    const halfDiscordAuthState = this.discordAuthState.slice(0, 16);

    logTrace(this, `Checking login state`, halfDiscordAuthState, '...');

    new this.sp.HttpClient(`http://localhost:${this.getServerPort()}`)
      .get("/api/users/login-discord/status?state=" + this.discordAuthState, undefined,
        // @ts-ignore
        (response) => {
          switch (response.status) {
            case 200:
              const {
                token,
                masterApiId,
                discordUsername,
                discordDiscriminator,
                discordAvatar,
                accessToken,
              } = JSON.parse(response.body) as MasterApiAuthStatus;
              browserState.failCount = 0;
              this.createPlaySession(token, (playSession, error) => {
                if (error) {
                  browserState.failCount = 0;
                  browserState.comment = (error);
                  timersService.setTimeout(() => this.checkLoginState(), Math.floor((1.5 + Math.random() * 2) * 1000));
                  this.refreshAuthState();
                  return;
                }
                authData = {
                  session: playSession,
                  masterApiId,
                  discordUsername,
                  discordDiscriminator,
                  discordAvatar,
                  // Server validates this with Discord API; use explicit accessToken or token from API (backend may return Discord OAuth token as either)
                  accessToken: (accessToken != null && accessToken !== '' ? accessToken : token) ?? '',
                };
                logTrace(this, `Discord auth successful, authData set:`, JSON.stringify(authData));
                browserState.comment = 'connected successfully';
                this.refreshAuthState();
              });
              break;
            case 401: // Unauthorized
              browserState.failCount = 0;
              browserState.comment = '';//(`Still waiting...`);
              timersService.setTimeout(() => this.checkLoginState(), Math.floor((1.5 + Math.random() * 2) * 1000));
              break;
            case 403: // Forbidden
            case 404: // Not found
              browserState.failCount = 9000;
              browserState.comment = (`Fail: ${response.body}`);
              break;
            default:
              ++browserState.failCount;
              browserState.comment = `Server returned ${response.status.toString() || "???"} "${response.body || response.error}"`;
              timersService.setTimeout(() => this.checkLoginState(), Math.floor((1.5 + Math.random() * 2) * 1000));
          }
        });
  };

  private refreshAuthState() {
    logTrace(this, 'refreshAuthUI called');

    // Inject auth state into window for React UI
    const authState = {
      authData,
      comment: browserState.comment,
      loginFailedReason: browserState.loginFailedReason,
      isConnecting: this.authAttemptProgressIndicator
    };

    const injectScript = `
      window.skymp = window.skymp || {};
      window.skymp.auth = ${JSON.stringify(authState)};
      window.dispatchEvent(new CustomEvent('skymp:authUpdate', { detail: ${JSON.stringify(authState)} }));
    `;
    this.sp.browser.executeJavaScript(injectScript);
    this.authDialogOpen = true;
  };

  public readAuthDataFromDisk(): RemoteAuthGameData | null {
    logTrace(this, `Reading`, this.pluginAuthDataName, `from disk`);

    try {
      // @ts-expect-error (TODO: Remove in 2.10.0)
      const data = this.sp.getPluginSourceCode(this.pluginAuthDataName, "PluginsNoLoad");

      if (!data) {
        logTrace(this, `Read empty`, this.pluginAuthDataName, `returning null`);
        return null;
      }

      return JSON.parse(data.slice(2)) || null;
    } catch (e) {
      logError(this, `Error reading`, this.pluginAuthDataName, `from disk:`, e, `, falling back to null`);
      return null;
    }
  }

  private writeAuthDataToDisk(data: RemoteAuthGameData | null) {
    // Auth data writing is handled by the launcher, client only reads
    logTrace(this, `Auth data writing disabled - launcher manages auth data`);
  };

  private deniedWidgetSetter = () => {
    const widget = {
      type: "form",
      id: 2,
      caption: "Update Available",
      elements: [
        {
          type: "text",
          text: "hooray! update released",
          tags: []
        },
        {
          type: "text",
          text: "download now at",
          tags: []
        },
        {
          type: "text",
          text: "skymp.net",
          tags: []
        },
        {
          type: "button",
          text: "open skymp.net",
          tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
          click: () => window.skyrimPlatform.sendMessage(events.updateRequired),
          hint: "Go to download page",
        }
      ]
    }
    window.skyrimPlatform.widgets.set([widget]);

    // Make sure gamemode will not be able to update widgets anymore
    window.skyrimPlatform.widgets = null;
  }

  private handleConnectionDenied(e: ConnectionDenied) {
    this.authAttemptProgressIndicator = false;

    if (e.error.toLowerCase().includes("invalid password")) {
      this.controller.once("tick", () => {
        this.controller.lookupListener(NetworkingService).close();
      });
      browserState.loginFailedReason = 'invalid password';
      this.refreshAuthState();
      this.sp.browser.setVisible(true);
      this.sp.browser.setFocused(true);
      this.controller.once("update", () => {
        this.sp.Game.disablePlayerControls(true, true, true, true, true, true, true, true, 0);
      });
      this.setListenBrowserMessage(true, 'connectionDenied event received');
    }
  }

  private handleConnectionAccepted() {
    logTrace(this, `handleConnectionAccepted called`);
    // Keep browser message listener active so user can still interact with auth menu
    // this.setListenBrowserMessage(false, 'connectionAccepted event received');
    this.loggingStartMoment = Date.now();

    const authData = this.sp.storage[authGameDataStorageKey] as AuthGameData | undefined;
    logTrace(this, `Auth data from storage:`, JSON.stringify(authData));
    if (authData?.local) {
      logTrace(this,
        `Logging in offline mode, profileId =`, authData.local.profileId
      );
      const message: CustomPacketMessage = {
        t: MsgType.CustomPacket,
        contentJsonDump: JSON.stringify({
          customPacketType: 'loginWithSkympIo',
          gameData: {
            profileId: authData.local.profileId,
          },
        }),
      };
      this.controller.emitter.emit("sendMessage", {
        message: message,
        reliability: "reliable"
      });
      return;
    }

    if (authData?.remote) {
      logTrace(this, 'Logging in as a master API user');
      // Server validates accessToken with Discord and gets id/username/etc. from Discord; only accessToken is required.
      const gameData: Record<string, unknown> = {
        accessToken: authData.remote.accessToken ?? '',
      };
      const message: CustomPacketMessage = {
        t: MsgType.CustomPacket,
        contentJsonDump: JSON.stringify({
          customPacketType: 'loginWithSkympIo',
          gameData,
        }),
      };
      this.controller.emitter.emit("sendMessage", {
        message: message,
        reliability: "reliable"
      });
      return;
    }

    logError(this, 'Not found authentication method');
  };

  private onTick() {
    // TODO: Should be no hardcoded/magic-number limit
    // TODO: Busy waiting is bad. Should be replaced with some kind of event
    const maxLoggingDelay = 15000;
    if (this.loggingStartMoment && Date.now() - this.loggingStartMoment > maxLoggingDelay) {
      logTrace(this, 'Max logging delay reached received');

      if (this.playerEverSawActualGameplay) {
        logTrace(this, 'Player saw actual gameplay, reconnecting');
        this.loggingStartMoment = 0;
        this.controller.lookupListener(NetworkingService).reconnect();
        // TODO: should we prompt user to relogin?
      } else {
        logTrace(this, 'Player never saw actual gameplay, showing login dialog');
        this.loggingStartMoment = 0;
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        browserState.comment = "";
        browserState.loginFailedReason = 'technical difficulties\nplease try again\nor contact us on discord';
        this.refreshAuthState();

        authData = null;
        // Note: Auth data cleanup handled by launcher
      }
    }

    if (this.authAttemptProgressIndicator) {
      this.authAttemptProgressIndicatorCounter++;

      if (this.authAttemptProgressIndicatorCounter === 1000000) {
        this.authAttemptProgressIndicatorCounter = 0;
      }

      const slowCounter = Math.floor(this.authAttemptProgressIndicatorCounter / 15);
      const newSlowCounter = Math.floor(slowCounter / 1); // Only changes every ~15 ticks

      // Only refresh widgets when the dot pattern changes
      if (newSlowCounter !== this.lastSlowCounter) {
        this.lastSlowCounter = newSlowCounter;
        const dot = slowCounter % 3 === 0 ? '.' : slowCounter % 3 === 1 ? '..' : '...';
        browserState.comment = "connecting" + dot;
        this.refreshAuthState();
      }
    }
  }

  private onceUpdate() {
    this.playerEverSawActualGameplay = true;
  }

  private isListenBrowserMessage() {
    return this._isListenBrowserMessage;
  }

  private setListenBrowserMessage(value: boolean, reason: string) {
    logTrace(this, `setListenBrowserMessage:`, value, `reason:`, reason);
    this._isListenBrowserMessage = value;
  }

  private _isListenBrowserMessage = false;

  private trigger = {
    authNeededFired: false,
    browserWindowLoadedFired: false,
    loaded: false,

    get conditionMet() {
      return this.authNeededFired && this.browserWindowLoadedFired
    }
  };
  private discordAuthState = crypto.randomBytes(32).toString('hex');
  private authDialogOpen = false;

  private loggingStartMoment = 0;

  private authAttemptProgressIndicator = false;
  private authAttemptProgressIndicatorCounter = 0;
  private lastSlowCounter = -1;

  private playerEverSawActualGameplay = false;

  private readonly githubUrl = "https://github.com/BStarRP/skymp";
  private readonly patreonUrl = "https://www.patreon.com/c/bruinstar";
  private readonly discordUrl = "https://discord.gg/bstarrp";
  private readonly pluginAuthDataName = `auth-data-no-load`;

  private getServerPort(): number {
    // Use the same port that the UI server uses (typically 3000 for dev, port+1 for custom ports)
    // This matches the pattern in ui.ts
    const settingsService = this.controller.lookupListener(SettingsService);
    const serverPort = settingsService.getServerPort();
    return serverPort === 7777 ? 3000 : serverPort + 1;
  }
}
