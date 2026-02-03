#include "MpClientPlugin.h"

#include "MessageSerializerFactory.h"
#include "MsgType.h"
#include "MinPacketId.h"
#include <FileUtils.h>
#include <nlohmann/json.hpp>
#include <slikenet/BitStream.h>
#include <spdlog/spdlog.h>
#include <tuple>
#include <vector>

void MpClientPlugin::CreateClient(State& state, const char* targetHostname,
                                  uint16_t targetPort)
{
  std::string password = kNetworkingPasswordPrefix;
  // Keep in sync with installer code
  static const std::string kPasswordPath =
    "Data/Platform/Distribution/password";
  static const int kTimeoutMs = 60000;
  try {
    password = Viet::ReadFileIntoString(kPasswordPath);

    // Remove trailing Windows-style newlines (\r\n)
    while (password.size() >= 2 && password[password.length() - 2] == '\r' &&
           password[password.length() - 1] == '\n') {
      password.erase(password.length() - 2);
    }

    // Remove trailing Unix-style newlines (\n)
    while (!password.empty() && password.back() == '\n') {
      password.pop_back();
    }

    password = kNetworkingPasswordPrefix + password;
  } catch (std::exception& e) {
    spdlog::warn("Unable to read password from '{}', will use standard '{}'",
                 kPasswordPath, password.data());
  }
  state.cl = Networking::CreateClient(targetHostname, targetPort, kTimeoutMs,
                                      password.data());
}

void MpClientPlugin::DestroyClient(State& state)
{
  state.cl.reset();
}

bool MpClientPlugin::IsConnected(State& state)
{
  return state.cl && state.cl->IsConnected();
}

void MpClientPlugin::Tick(State& state, OnPacket onPacket,
                          DeserializeMessage deserializeMessageFn,
                          void* state_)
{
  if (!state.cl)
    return;

  std::tuple<OnPacket, DeserializeMessage, void*> locals(
    onPacket, deserializeMessageFn, state_);

  state.cl->Tick(
    [](void* rawState, Networking::PacketType packetType,
       Networking::PacketData data, size_t length, const char* error) {
      const auto& [onPacket, deserializeMessageFn, state] =
        *reinterpret_cast<std::tuple<OnPacket, DeserializeMessage, void*>*>(
          rawState);

      if (packetType != Networking::PacketType::Message) {
        return onPacket(static_cast<int32_t>(packetType), "", 0, error, state);
      }

      std::string deserializedJsonContent;
      if (deserializeMessageFn(data, length, deserializedJsonContent)) {
        return onPacket(static_cast<int32_t>(packetType),
                        deserializedJsonContent.data(),
                        deserializedJsonContent.size(), error, state);
      }

      // Previously, it was string-only
      // Now it can be any bytes while still being std::string
      std::string rawContent =
        std::string(reinterpret_cast<const char*>(data) + 1, length - 1);
      onPacket(static_cast<int32_t>(packetType), rawContent.data(),
               rawContent.size(), error, state);
    },
    &locals);
}

void MpClientPlugin::Send(State& state, const char* jsonContent, bool reliable,
                          SerializeMessage serializeMessageFn)
{
  if (!state.cl) {
    // TODO(#263): we probably should log something here
    return;
  }

  SLNet::BitStream stream;
  serializeMessageFn(jsonContent, stream);
  state.cl->Send(stream.GetData(), stream.GetNumberOfBytesUsed(), reliable);
}

void MpClientPlugin::SendRaw(State& state, const void* data, size_t size,
                             bool reliable)
{
  if (!state.cl) {
    // TODO(#263): we probably should log something here
    return;
  }

  state.cl->Send(reinterpret_cast<Networking::PacketData>(data), size,
                 reliable);
}

void MpClientPlugin::InitVoiceChat(State& state)
{
  // Set up voice data callback to send voice data over the network
  state.voiceChatManager.Initialize([&state](bool isTalking, const std::vector<uint8_t>& audioData) {
    if (state.cl && isTalking && !audioData.empty()) {
      // Create binary packet with voice data
      std::vector<uint8_t> packet;
      packet.push_back(Networking::BinaryVoicePacketId);

      // Add speaker ID (4 bytes) - use 0x14 as placeholder for player
      uint32_t speakerId = 0x14;
      packet.resize(packet.size() + 4);
      memcpy(&packet[1], &speakerId, 4);

      // Add data size (4 bytes)
      packet.resize(packet.size() + 4);
      uint32_t size32 = static_cast<uint32_t>(audioData.size());
      memcpy(&packet[5], &size32, 4);

      // Add audio data
      packet.resize(packet.size() + audioData.size());
      memcpy(&packet[9], audioData.data(), audioData.size());

      // Send as unreliable for low latency
      state.cl->Send(reinterpret_cast<Networking::PacketData>(packet.data()), packet.size(), false);
    }
  });
}

void MpClientPlugin::StartTalking(State& state)
{
  state.voiceChatManager.StartTalking();
}

void MpClientPlugin::StopTalking(State& state)
{
  state.voiceChatManager.StopTalking();
}

void MpClientPlugin::OnReceiveVoiceData(State& state, uint32_t speakerId, const uint8_t* audioData, size_t dataSize, float x, float y, float z)
{
  // Convert parameters to match VoiceChatManager interface
  std::vector<uint8_t> audioVector(audioData, audioData + dataSize);
  std::array<float, 3> speakerPosition = {x, y, z};
  std::array<float, 3> listenerPosition = {0.0f, 0.0f, 0.0f}; // TODO: Get actual listener position

  state.voiceChatManager.OnReceiveVoiceData(speakerId, audioVector, speakerPosition, listenerPosition);
}
