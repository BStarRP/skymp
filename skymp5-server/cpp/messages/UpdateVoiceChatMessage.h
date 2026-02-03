#pragma once

#include "../server_guest_lib/VoiceChat.h"
#include "MessageBase.h"
#include "MsgType.h"
#include <array>
#include <cstdint>
#include <nlohmann/json.hpp>
#include <optional>
#include <string>
#include <type_traits>
#include <vector>

struct UpdateVoiceChatMessage : public MessageBase<UpdateVoiceChatMessage>
{
  static constexpr auto kMsgType =
    std::integral_constant<char, static_cast<char>(MsgType::UpdateVoiceChatMessage)>{};

  uint32_t idx = 0;

  struct Data
  {
    template <class Archive>
    void Serialize(Archive& archive)
    {
      archive.Serialize("isTalking", isTalking)
             .Serialize("audioData", audioData)
             .Serialize("worldOrCell", worldOrCell)
             .Serialize("position", position)
             .Serialize("speakerId", speakerId);
    }
    bool isTalking = false;
    std::vector<uint8_t> audioData;    // Opus-encoded audio frames
    uint32_t worldOrCell = 0;          // Speaker's world/cell for channel validation
    std::array<float, 3> position = {0.0f, 0.0f, 0.0f}; // Speaker's position for 3D audio
    uint32_t speakerId = 0; // Actor form ID for voice identification
  };

  template <class Archive>
  void Serialize(Archive& archive)
  {
    archive.Serialize("t", kMsgType)
      .Serialize("idx", idx)
      .Serialize("data", data);
  }

  Data data;
};
