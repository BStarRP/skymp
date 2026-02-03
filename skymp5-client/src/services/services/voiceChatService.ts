import { logTrace, logError } from "../../logging";
import { ClientListener, CombinedController, Sp } from "./clientListener";
import { RemoteServer } from "./remoteServer";
import { SendRawMessageEvent } from "../events/sendRawMessageEvent";

export class VoiceChatService extends ClientListener {
  private isInitialized = false;
  private isTalking = false;
  private pushToTalkKey = 0x56; // V key

  constructor(private sp: Sp, private controller: CombinedController) {
    super();

    this.controller.on("tick", () => this.onTick());
    this.controller.on("update", () => this.onUpdate());
  }

  onConnect() {
    // Voice chat initialization handled elsewhere for now
    logTrace(`VoiceChatService: Connected`);
  }

  onDisconnect() {
    if (this.isTalking) {
      this.stopTalking();
    }
    this.isInitialized = false;
  }

  private onTick() {
    if (!this.isInitialized) {
      return;
    }

    // Check push-to-talk key state
    const keyPressed = this.sp.Input.isKeyPressed(this.pushToTalkKey);

    if (keyPressed && !this.isTalking) {
      this.startTalking();
    } else if (!keyPressed && this.isTalking) {
      this.stopTalking();
    }
  }

  private onUpdate() {
    // Handle continuous voice chat updates if needed
  }

  private startTalking() {
    try {
      this.isTalking = true;
      logTrace(`VoiceChatService: Started talking`);
      // Actual voice capture handled by underlying system
    } catch (error) {
      logError(`VoiceChatService: Failed to start talking: ${error}`);
    }
  }

  private stopTalking() {
    try {
      this.isTalking = false;
      logTrace(`VoiceChatService: Stopped talking`);
      // Actual voice capture stopping handled by underlying system
    } catch (error) {
      logError(`VoiceChatService: Failed to stop talking: ${error}`);
    }
  }

  // Handle incoming voice chat data from other players
  onReceiveVoiceData(speakerId: number, audioData: ArrayBuffer, x: number, y: number, z: number) {
    if (!this.isInitialized) {
      return;
    }

    try {
      // Voice playback handled by underlying system
      logTrace(`VoiceChatService: Received voice data from ${speakerId} at (${x}, ${y}, ${z})`);
    } catch (error) {
      logError(`VoiceChatService: Failed to process voice data: ${error}`);
    }
  }

  // Handle binary voice packets received from the server
  onPacket(type: string, rawContent: ArrayBuffer, error: string) {
    if (error) {
      logError(`VoiceChatService: Packet error: ${error}`);
      return;
    }

    if (!rawContent || rawContent.byteLength === 0) {
      return;
    }

    // Check if this is a binary voice packet
    const data = new Uint8Array(rawContent);
    if (data[0] === 135) { // BinaryVoicePacketId
      if (rawContent.byteLength >= 9) {
        // Extract speaker ID (4 bytes)
        const speakerIdBytes = data.slice(1, 5);
        const speakerId = new DataView(speakerIdBytes.buffer).getUint32(0, true);

        // Extract data size (4 bytes)
        const dataSizeBytes = data.slice(5, 9);
        const dataSize = new DataView(dataSizeBytes.buffer).getUint32(0, true);

        if (rawContent.byteLength === 9 + dataSize) {
          // Extract audio data
          const audioData = data.slice(9);

          // Get speaker position from world model
          const remoteServer = this.controller.lookupListener(RemoteServer);
          const worldModel = remoteServer.getWorldModel();

          let x = 0, y = 0, z = 0;

          // Find the speaker in the world model to get position
          const speakerForm = worldModel.forms.find(f => f && f.refrId === speakerId);
          if (speakerForm && speakerForm.movement) {
            x = speakerForm.movement.pos[0];
            y = speakerForm.movement.pos[1];
            z = speakerForm.movement.pos[2];
          }

          this.onReceiveVoiceData(speakerId, audioData.buffer, x, y, z);
        }
      }
    }
  }

  // Get current push-to-talk key
  getPushToTalkKey(): number {
    return this.pushToTalkKey;
  }

  // Set push-to-talk key
  setPushToTalkKey(key: number) {
    if (this.isTalking) {
      this.stopTalking();
    }
    this.pushToTalkKey = key;
  }

  // Check if currently talking
  getIsTalking(): boolean {
    return this.isTalking;
  }

  // Check if voice chat is initialized
  getIsInitialized(): boolean {
    return this.isInitialized;
  }
}
