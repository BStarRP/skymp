import { MsgType } from "../../messages";

export interface UpdateVoiceChatMessage {
    t: MsgType.UpdateVoiceChatMessage;
    data: {
        speakerId: number;
        audioData: number[]; // Array of bytes representing audio data
        position: number[]; // Array of 3 floats [x, y, z]
        worldOrCell: number; // World or cell ID
        isTalking: boolean; // Whether the speaker is currently talking
    };
}
