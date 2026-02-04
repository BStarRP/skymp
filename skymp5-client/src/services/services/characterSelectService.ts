import { ClientListener, CombinedController, Sp } from "./clientListener";
import { BrowserMessageEvent } from "skyrimPlatform";
import { ConnectionMessage } from "../events/connectionMessage";
import { CustomPacketMessage } from "../messages/customPacketMessage";
import { MsgType } from "../../messages";
import { logTrace, logError } from "../../logging";

// Define as module-level variables instead of global declarations
const window: any = (global as any).window || (globalThis as any).window || {};
const confirm = (global as any).confirm || ((msg: string) => true); // Default confirm to true

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

// Define event constants for browser messages
const characterEvents = {
  selectCharacter: 'selectCharacter',
  createCharacter: 'createCharacter',
  deleteCharacter: 'deleteCharacter',
};

// Events used on both client and browser side
const events = {
  selectCharacter: 'characterSelect_select',
  createCharacter: 'characterSelect_create',
  deleteCharacter: 'characterSelect_delete',
};

export class CharacterSelectService extends ClientListener {
  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.emitter.on("customPacketMessage", (e) => this.onCustomPacketMessage(e));
    this.controller.on("browserMessage", (e) => this.onBrowserMessage(e));
    
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

    // Create character selection widget
    const characterElements = data.characters.map((char, index) => ({
      type: "button",
      text: `${char.name} (${char.isFemale ? 'Female' : 'Male'})`,
      tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
      click: () => window.skyrimPlatform.sendMessage(characterEvents.selectCharacter, char.visibleId),
      hint: `Select character: ${char.name}`,
    }));

    // Add create character button if there's room
    if (data.characters.length < data.maxSlots) {
      characterElements.push({
        type: "button",
        text: "Create New Character",
        tags: ["BUTTON_STYLE_FRAME", "ELEMENT_STYLE_MARGIN_EXTENDED"],
        click: () => window.skyrimPlatform.sendMessage(characterEvents.createCharacter),
        hint: `Create a new character (${data.characters.length}/${data.maxSlots} slots used)`,
      });
    }

    // Add delete character buttons
    if (data.characters.length > 0) {
      characterElements.push({
        type: "text",
        text: "Delete Character:",
        tags: [],
        click: () => {}, // Empty click handler for text elements
        hint: "Delete character options below",
      });

      data.characters.forEach((char) => {
        characterElements.push({
          type: "button",
          text: `Delete ${char.name}`,
          tags: ["ELEMENT_STYLE_MARGIN_EXTENDED"],
          click: () => {
            if (confirm(`Are you sure you want to delete character "${char.name}"?`)) {
              window.skyrimPlatform.sendMessage(characterEvents.deleteCharacter, char.visibleId);
            }
          },
          hint: `Delete character: ${char.name}`,
        });
      });
    }

    const characterWidget = {
      type: "form",
      id: 3,
      caption: "Character Selection",
      elements: [
        {
          type: "text",
          text: `Select a character (${data.characters.length}/${data.maxSlots} slots used)`,
          tags: [],
          click: () => {}, // Empty click handler for text elements
          hint: "Character selection instructions",
        },
        ...characterElements,
      ]
    };

    // Show character selection UI
    window.skyrimPlatform.widgets.set([characterWidget]);
    this.sp.browser.setVisible(true);
    this.sp.browser.setFocused(true);
  }

  private handleCharacterError(message: string): void {
    logError(this, `Character error: ${message}`);

    const errorWidget = {
      type: "form",
      id: 4,
      caption: "Character Error",
      elements: [
        {
          type: "text",
          text: message,
          tags: [],
          click: () => {}, // Empty click handler for text elements
          hint: "Error message",
        },
        {
          type: "button",
          text: "OK",
          tags: ["BUTTON_STYLE_FRAME", "ELEMENT_STYLE_MARGIN_EXTENDED"],
          click: () => {
            // Hide error and go back to character selection
            window.skyrimPlatform.widgets.set([]);
            // Request character list again
            const message: CustomPacketMessage = {
              t: MsgType.CustomPacket,
              contentJsonDump: JSON.stringify({
                customPacketType: 'requestCharacterList',
              }),
            };
            this.controller.emitter.emit("sendMessage", {
              message,
              reliability: "reliable"
            });
          },
          hint: "Close error message",
        },
      ]
    };

    window.skyrimPlatform.widgets.set([errorWidget]);
  }

  private onBrowserMessage(e: BrowserMessageEvent): void {
    const eventKey = e.arguments[0];
    const eventData = e.arguments[1];

    switch (eventKey) {
      case characterEvents.selectCharacter:
        this.sendSelectCharacter(eventData as number);
        break;
      case characterEvents.createCharacter:
        this.sendCreateCharacter();
        break;
      case characterEvents.deleteCharacter:
        this.sendDeleteCharacter(eventData as number);
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
}