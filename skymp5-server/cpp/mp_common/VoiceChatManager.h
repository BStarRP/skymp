#pragma once

#include "VoiceCapture.h"
#include "VoicePlayback.h"
#include <memory>
#include <functional>
#include <cstdint>
#include <array>

/// <summary>
/// Manager class that coordinates voice capture and playback.
/// Integrates with the multiplayer client to send/receive voice data.
/// </summary>
class VoiceChatManager
{
public:
  /// Callback for sending voice data to the server
  /// @param isTalking - Whether the player is talking
  /// @param audioData - Opus-encoded audio data
  using SendVoiceDataCallback = std::function<void(bool isTalking, const std::vector<uint8_t>& audioData)>;

  VoiceChatManager();
  ~VoiceChatManager();

  /// Initialize voice chat system
  /// @param sendCallback - Callback to send voice data to server
  bool Initialize(SendVoiceDataCallback sendCallback);

  /// Shutdown voice chat system
  void Shutdown();

  /// Start push-to-talk (called when PTT key is pressed)
  void StartTalking();

  /// Stop push-to-talk (called when PTT key is released)
  void StopTalking();

  /// Check if currently talking
  bool IsTalking() const;

  /// Handle incoming voice data from another player
  /// @param speakerIdx - Player index of the speaker
  /// @param audioData - Opus-encoded audio data
  /// @param speakerPosition - Speaker's position [x, y, z]
  /// @param listenerPosition - Local player's position [x, y, z]
  /// @param listenerYaw - Local player's facing direction in radians
  void OnReceiveVoiceData(uint32_t speakerIdx,
                          const std::vector<uint8_t>& audioData,
                          const std::array<float, 3>& speakerPosition,
                          const std::array<float, 3>& listenerPosition,
                          float listenerYaw = 0.0f);

  /// Notify that a player has stopped talking (optional cleanup)
  void OnPlayerStoppedTalking(uint32_t speakerIdx);

private:
  /// Called when audio is captured and encoded
  void OnCapturedAudio(const std::vector<uint8_t>& encodedData);

  std::unique_ptr<VoiceCapture> m_capture;
  std::unique_ptr<VoicePlayback> m_playback;

  SendVoiceDataCallback m_sendCallback;
  bool m_initialized = false;
  bool m_isTalking = false;
};
