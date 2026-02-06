import { ClientListener, CombinedController, Sp } from "./clientListener";
import { BrowserMessageEvent } from "skyrimPlatform";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { MsgType } from "../../messages";
import { logTrace, logError } from "../../logging";
import { NetworkingService } from "./networkingService";

interface CharacterInfo {
  visibleId: number;
  name: string;
  raceId: number;
  isFemale: boolean;
}

interface CharacterListData {
  characters: CharacterInfo[];
  maxSlots: number;
  currentCount: number;
}

// Events used on both client and browser side
const events = {
  selectCharacter: 'characterSelect_select',
  createCharacter: 'characterSelect_create',
  deleteCharacter: 'characterSelect_delete',
  backToLogin: 'characterSelect_back',
};

export class CharacterSelectService extends ClientListener {
  private characterSelectActive = false;
  public resetAuthState = false;

  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    this.controller.emitter.on("createActorMessage", (e) => this.onCreateActorMessage(e));

    // Listen for loginSuccess event from AuthService
    this.controller.emitter.on("loginSuccess", (e) => this.onLoginSuccess(e));
  }

  private onLoginSuccess(e: any): void {
    logTrace(this, `Received loginSuccess event, user authenticated`);
    // The server will send character list automatically after login
    // No need to request it here
  }

  private onCustomPacketMessage(event: ConnectionMessage<CustomPacketMessage>): void {
    try {
      const content = JSON.parse(event.message.contentJsonDump);

      switch (content.customPacketType) {
        case "characterList":
          this.handleCharacterList(content);
          break;
        case "characterError":
          this.handleCharacterError(content.message || "Unknown error occurred");
          break;
      }
    } catch (e) {
      logError(this, `Error parsing custom packet: ${e}`);
    }
  }

  private handleCharacterList(data: CharacterListData): void {
    logTrace(this, `Received character list: ${data.characters.length} characters, ${data.maxSlots} max slots`);

    this.characterSelectActive = true;

    // Inject data into window for custom UI access (following skyrim-roleplay pattern)
    const injectScript = `
      window.skymp = window.skymp || {};
      window.skymp.characterSelect = ${JSON.stringify(data)};
      window.dispatchEvent(new CustomEvent('skymp:characterList', { detail: ${JSON.stringify(data)} }));
    `;
    this.sp.browser.executeJavaScript(injectScript);

    // Show browser for character selection UI
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);
  }

  private handleCharacterError(message: string): void {
    logError(this, `Character error: ${message}`);

    // Inject error into window for custom UI access
    const injectScript = `
      window.skymp = window.skymp || {};
      window.skymp.characterSelectError = ${JSON.stringify(message)};
      window.dispatchEvent(new CustomEvent('skymp:characterError', { detail: ${JSON.stringify({ message })} }));
    `;
    this.sp.browser.executeJavaScript(injectScript);
  }

  private onCreateActorMessage(e: any): void {
    // Hide character select screen when player spawns in world
    if (this.characterSelectActive) {
      logTrace(this, `Player spawned, hiding character select screen`);
      
      const clearScript = `
        if (window.skymp) {
          window.skymp.characterSelect = null;
          window.skymp.characterSelectError = null;
        }
        window.dispatchEvent(new CustomEvent('skymp:characterList', { detail: null }));
      `;
      this.sp.browser.executeJavaScript(clearScript);
      
      this.characterSelectActive = false;
    }
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    const eventKey = e.arguments[0];
    const eventData = e.arguments[1];

    switch (eventKey) {
      case events.selectCharacter:
        this.sendSelectCharacter(eventData as number);
        break;
      case events.createCharacter:
        this.sendCreateCharacter();
        break;
      case events.deleteCharacter:
        this.sendDeleteCharacter(eventData as number);
        break;
      case events.backToLogin:
        this.handleBackToLogin();
        break;
    }
  }

  private sendSelectCharacter(visibleId: number): void {
    logTrace(this, `Selecting character visibleId=${visibleId}`);
    const message: CustomPacketMessage = {
      t: MsgType.CustomPacket,
      contentJsonDump: JSON.stringify({
        customPacketType: 'selectCharacter',
        visibleId,
      }),
    };
    this.controller.emitter.emit("sendMessage", {
      message,
      reliability: "reliable"
    });
  }

  private sendCreateCharacter(): void {
    logTrace(this, `Creating new character`);
    const message: CustomPacketMessage = {
      t: MsgType.CustomPacket,
      contentJsonDump: JSON.stringify({
        customPacketType: 'createCharacter',
      }),
    };
    this.controller.emitter.emit("sendMessage", {
      message,
      reliability: "reliable"
    });
  }

  private sendDeleteCharacter(visibleId: number): void {
    logTrace(this, `Deleting character visibleId=${visibleId}`);
    const message: CustomPacketMessage = {
      t: MsgType.CustomPacket,
      contentJsonDump: JSON.stringify({
        customPacketType: 'deleteCharacter',
        visibleId,
      }),
    };
    this.controller.emitter.emit("sendMessage", {
      message,
      reliability: "reliable"
    });
  }

  private handleBackToLogin(): void {
    logTrace(this, `Back to login - returning to fresh auth screen`);
    
    // Set flag to prevent auto-reconnect in authService
    this.resetAuthState = true;
    
    // Clear character select data
    const clearScript = `
      if (window.skymp) {
        window.skymp.characterSelect = null;
        window.skymp.characterSelectError = null;
      }
      window.dispatchEvent(new CustomEvent('skymp:characterList', { detail: null }));
    `;
    this.sp.browser.executeJavaScript(clearScript);
    
    this.characterSelectActive = false;
    
    // Close connection and ensure browser stays visible for auth screen
    this.controller.lookupListener(NetworkingService).close();
    
    // Keep browser visible for auth UI
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);
  }
}
