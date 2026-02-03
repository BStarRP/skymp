import { MsgType } from "../../messages";

export interface VoiceChatMessage {
    t: MsgType.VoiceChatMessage;
    data: {
        speakerId: number;
        audioData: number[]; // Array of bytes representing audio data
        isTalking: boolean; // Whether the speaker is currently talking
    };
}
