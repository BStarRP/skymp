import * as crypto from "crypto";
import { AuthGameData, RemoteAuthGameData, authGameDataStorageKey } from "../../features/authModel";
import { FunctionInfo } from "../../lib/functionInfo";
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

// Constants used on both client and browser side (see browsersideWidgetSetter)
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

// Vaiables used on both client and browser side (see browsersideWidgetSetter)
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
        logTrace(this, `Received createActorMessage for self, resetting widgets`);
        this.sp.browser.executeJavaScript('window.skyrimPlatform.widgets.set([]);');
        this.authDialogOpen = false;
      } else {
        logTrace(this, `Received createActorMessage for self, but auth dialog was not open so not resetting widgets`);
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
        this.sp.browser.executeJavaScript(new FunctionInfo(this.loginFailedWidgetSetter).getText({ events, browserState, authData: authData }));
        break;
      case 'loginFailedNotInTheDiscordServer':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedNotInTheDiscordServer received');
        browserState.loginFailedReason = 'please join the discord server';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedNotInTheDiscordServer received');
        this.loggingStartMoment = 0;
        this.sp.browser.executeJavaScript(new FunctionInfo(this.loginFailedWidgetSetter).getText({ events, browserState, authData: authData }));
        break;
      case 'loginFailedBanned':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedBanned received');
        browserState.loginFailedReason = 'you are banned';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedBanned received');
        this.loggingStartMoment = 0;
        this.sp.browser.executeJavaScript(new FunctionInfo(this.loginFailedWidgetSetter).getText({ events, browserState, authData: authData }));
        break;
      case 'loginFailedIpMismatch':
        this.authAttemptProgressIndicator = false;
        this.controller.lookupListener(NetworkingService).close();
        logTrace(this, 'loginFailedIpMismatch received');
        browserState.loginFailedReason = 'what was that?';
        browserState.comment = '';
        this.setListenBrowserMessage(true, 'loginFailedIpMismatch received');
        this.loggingStartMoment = 0;
        this.sp.browser.executeJavaScript(new FunctionInfo(this.loginFailedWidgetSetter).getText({ events, browserState, authData: authData }));
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

    logTrace(this, `Showing widgets and starting loop`);

    // Make sure auth data is loaded
    if (!authData) {
      authData = this.readAuthDataFromDisk();
    }

    // Show login widgets
    this.refreshWidgets();
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);

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
        this.refreshWidgets();

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
          this.refreshWidgets();
          break;
        }

        logTrace(this, `Emitting authAttempt event with authData:`, JSON.stringify(authData));

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
        }

        // Reload auth data from disk so user sees their previous account info
        authData = this.readAuthDataFromDisk();
        logTrace(this, 'Reloaded auth data after Back button pressed:', authData ? 'found' : 'not found');
        this.sp.browser.executeJavaScript(new FunctionInfo(this.browsersideWidgetSetter).getText({ events, browserState, authData: authData }));
        break;
      case events.joinDiscord:
        this.sp.win32.loadUrl("https://discord.gg/bstarrp");
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
              } = JSON.parse(response.body) as MasterApiAuthStatus;
              browserState.failCount = 0;
              this.createPlaySession(token, (playSession, error) => {
                if (error) {
                  browserState.failCount = 0;
                  browserState.comment = (error);
                  timersService.setTimeout(() => this.checkLoginState(), Math.floor((1.5 + Math.random() * 2) * 1000));
                  this.refreshWidgets();
                  return;
                }
                authData = {
                  session: playSession,
                  masterApiId,
                  discordUsername,
                  discordDiscriminator,
                  discordAvatar,
                };
                logTrace(this, `Discord auth successful, authData set:`, JSON.stringify(authData));
                browserState.comment = 'connected successfully';
                this.refreshWidgets();
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

  private refreshWidgets() {
    logTrace(this, 'refreshWidgets called');
    this.sp.browser.executeJavaScript(
      new FunctionInfo(this.loginWidgetSetter).getText({
        events,
        browserState,
        authData,
        isConnecting: this.authAttemptProgressIndicator
      })
    );
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

  private loginFailedWidgetSetter = () => {
    const splitParts = browserState.loginFailedReason.split('\n');

    const textElements = splitParts.map((part) => ({
      type: "text",
      text: part,
      tags: [],
    }));

    const widget = {
      type: "form",
      id: 2,
      caption: "Error",
      elements: new Array<any>()
    }

    textElements.forEach((element) => widget.elements.push(element));

    if (browserState.loginFailedReason === 'please join the discord server') {
      widget.elements.push({
        type: "button",
        text: "Join Server",
        tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
        click: () => window.skyrimPlatform.sendMessage(events.joinDiscord),
        hint: null
      });
    }

    widget.elements.push({
      type: "button",
      text: "Back",
      tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
      click: () => window.skyrimPlatform.sendMessage(events.backToLogin),
      hint: undefined
    });

    if (window.skyrimPlatform && window.skyrimPlatform.widgets) {
      window.skyrimPlatform.widgets.set([widget]);
    }
  }

  private loginWidgetSetter = () => {
    // Note: isConnecting is injected via getText() wrapper
    // @ts-ignore - isConnecting is provided by FunctionInfo.getText()
    const connecting = isConnecting;

    const authDataUsername = authData ? (
      authData.discordUsername
        ? authData.discordUsername
        : `id: ${authData.masterApiId}`
    ) : "not authorized";

    const buttonText = authData ? "Change Account" : "Login via Discord";

    const elements: any[] = [
      {
        type: "text",
        text: authDataUsername,
        tags: [],
      }
    ];

    // Only show buttons if not connecting
    if (!connecting) {
      elements.push({
        type: "button",
        text: buttonText,
        tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
        click: () => window.skyrimPlatform.sendMessage(events.openDiscordOauth),
        hint: "You can login or change account",
      });
      elements.push({
        type: "button",
        text: "Connect",
        tags: ["BUTTON_STYLE_FRAME", "ELEMENT_STYLE_MARGIN_EXTENDED"],
        click: () => window.skyrimPlatform.sendMessage(events.authAttempt),
        hint: "Connect to game server",
      });
    }

    // Always show status text
    elements.push({
      type: "text",
      text: browserState.comment,
      tags: [],
    });

    const loginWidget = {
      type: "form",
      id: 1,
      caption: "Authentication",
      elements: elements
    };

    window.skyrimPlatform.widgets.set([loginWidget]);
  };

  private browsersideWidgetSetter = () => {
    const loginWidget = {
      type: "form",
      id: 1,
      caption: "Authentication",
      elements: [
        {
          type: "text",
          text: (
            authData ? (
              authData.discordUsername
                ? `${authData.discordUsername}`
                : `id: ${authData.masterApiId}`
            ) : "not authorized"
          ),
          tags: [],
        },
        {
          type: "button",
          text: authData ? "Change Account" : "Login via Discord",
          tags: [],
          click: () => window.skyrimPlatform.sendMessage(events.openDiscordOauth),
          hint: "You can login or change account",
        },
        {
          type: "button",
          text: "Connect",
          tags: ["BUTTON_STYLE_FRAME", "ELEMENT_STYLE_MARGIN_EXTENDED"],
          click: () => window.skyrimPlatform.sendMessage(events.authAttempt),
          hint: "Connect to game server",
        },
        {
          type: "text",
          text: browserState.comment,
          tags: [],
        },
      ]
    };
    window.skyrimPlatform.widgets.set([loginWidget]);
  };

  private handleConnectionDenied(e: ConnectionDenied) {
    this.authAttemptProgressIndicator = false;

    if (e.error.toLowerCase().includes("invalid password")) {
      this.controller.once("tick", () => {
        this.controller.lookupListener(NetworkingService).close();
      });
      this.sp.browser.executeJavaScript(new FunctionInfo(this.deniedWidgetSetter).getText({ events }));
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
      const message: CustomPacketMessage = {
        t: MsgType.CustomPacket,
        contentJsonDump: JSON.stringify({
          customPacketType: 'loginWithSkympIo',
          gameData: {
            session: authData.remote.session,
            masterApiId: authData.remote.masterApiId,
            discordUsername: authData.remote.discordUsername,
            discordDiscriminator: authData.remote.discordDiscriminator,
            discordAvatar: authData.remote.discordAvatar,
          },
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
        this.sp.browser.executeJavaScript(new FunctionInfo(this.loginFailedWidgetSetter).getText({ events, browserState, authData: authData }));

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
        this.refreshWidgets();
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

  private readonly githubUrl = "https://github.com/skyrim-multiplayer/skymp";
  private readonly patreonUrl = "https://www.patreon.com/skymp";
  private readonly pluginAuthDataName = `auth-data-no-load`;

  private getServerPort(): number {
    // Use the same port that the UI server uses (typically 3000 for dev, port+1 for custom ports)
    // This matches the pattern in ui.ts
    const settingsService = this.controller.lookupListener(SettingsService);
    const serverPort = settingsService.getServerPort();
    return serverPort === 7777 ? 3000 : serverPort + 1;
  }
}
