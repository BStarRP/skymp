#pragma once
#include "MessageBase.h"
#include "MsgType.h"
#include <optional>
#include <type_traits>
#include <vector>
#include <cstdint>

struct VoiceChatMessage : public MessageBase<VoiceChatMessage>
{
  static constexpr auto kMsgType =
    std::integral_constant<char, static_cast<char>(MsgType::VoiceChatMessage)>{};

  struct Data
  {
    template <class Archive>
    void Serialize(Archive& archive)
    {
      archive.Serialize("t", kMsgType)
             .Serialize("isTalking", isTalking)
             .Serialize("audioData", audioData)
             .Serialize("speakerId", speakerId);
    }

    bool isTalking = false;
    std::vector<uint8_t> audioData; // Opus-encoded audio frames
    uint32_t speakerId = 0; // Actor form ID for voice identification
  };

  template <class Archive>
  void Serialize(Archive& archive)
  {
    archive.Serialize("t", kMsgType).Serialize("data", data);
  }

  Data data;
};
