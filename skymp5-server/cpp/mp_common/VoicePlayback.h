#pragma once

#include <opus/opus.h>
#include <miniaudio.h>
#include <vector>
#include <cstdint>
#include <map>
#include <mutex>
#include <array>

/// <summary>
/// Handles playback of voice chat audio with 3D spatialization.
/// Decodes Opus audio and applies distance attenuation and stereo panning.
/// </summary>
class VoicePlayback
{
public:
  VoicePlayback();
  ~VoicePlayback();

  /// Initialize the playback system
  bool Initialize();

  /// Play voice data from a specific speaker with 3D positioning
  /// @param speakerIdx - Unique index of the speaker
  /// @param encodedData - Opus-encoded audio data
  /// @param speakerPosition - 3D position of the speaker [x, y, z]
  /// @param listenerPosition - 3D position of the listener (player) [x, y, z]
  /// @param listenerYaw - Listener's facing direction in radians (0 = north, increases clockwise)
  void PlayVoiceData(uint32_t speakerIdx,
                     const std::vector<uint8_t>& encodedData,
                     const std::array<float, 3>& speakerPosition,
                     const std::array<float, 3>& listenerPosition,
                     float listenerYaw = 0.0f);

  /// Stop all playback from a specific speaker
  void StopSpeaker(uint32_t speakerIdx);

  /// Shutdown and cleanup
  void Shutdown();

private:
  struct SpeakerData
  {
    OpusDecoder* decoder = nullptr;
    std::vector<float> audioBuffer; // Decoded PCM samples (mono)
    std::array<float, 3> position = { 0.0f, 0.0f, 0.0f };

    // Jitter buffer settings
    size_t targetBufferSize = 4800;  // ~300ms at 16kHz (3-5 packets)
    size_t minBufferSize = 3200;      // ~200ms minimum before playback
    bool isBuffering = true;          // Wait for buffer to fill initially
    uint32_t consecutiveLostPackets = 0; // Track packet loss for PLC
    uint64_t lastPacketTime = 0;      // Timestamp of last received packet
  };

  static void DataCallback(ma_device* pDevice, void* pOutput,
                           const void* pInput, ma_uint32 frameCount);
  void MixAudio(float* pOutput, ma_uint32 frameCount);

  /// Calculate 3D spatialization parameters
  struct SpatialParams
  {
    float volume; // Distance attenuation (0.0 - 1.0)
    float panLeft; // Left channel gain (0.0 - 1.0)
    float panRight; // Right channel gain (0.0 - 1.0)
  };

  SpatialParams CalculateSpatial(const std::array<float, 3>& speakerPos,
                                 const std::array<float, 3>& listenerPos,
                                 float listenerYaw);

  /// Generate concealment audio for lost packets using Opus PLC
  void GenerateConcealmentAudio(SpeakerData& speakerData);

  /// Check if we should apply packet loss concealment
  bool ShouldConcealPacketLoss(SpeakerData& speakerData);

  // Audio configuration
  static constexpr int kSampleRate = 16000; // 16kHz for voice
  static constexpr int kChannels = 2; // Stereo output
  static constexpr int kFrameSize = 320; // 20ms at 16kHz
  static constexpr int kMaxFrameSize = 5760;
  // Max Opus frame size (120ms at 48kHz)
  static constexpr float kMaxVoiceDistance = 2000.0f; // Same as server

  // Jitter buffer and PLC configuration
  static constexpr uint64_t kPacketTimeoutMs = 60; // 60ms = 3x frame time (20ms)
  static constexpr uint32_t kMaxConsecutivePLC = 5; // Max 5 consecutive PLC frames (100ms)

  // miniaudio device for playback
  ma_device m_device = {};
  bool m_deviceInitialized = false;

  // Speaker data (idx -> SpeakerData)
  std::map<uint32_t, SpeakerData> m_speakers;
  std::mutex m_mutex;

  // Listener position and orientation for 3D audio
  std::array<float, 3> m_listenerPosition = { 0.0f, 0.0f, 0.0f };
  float m_listenerYaw = 0.0f; // Facing direction in radians
};
