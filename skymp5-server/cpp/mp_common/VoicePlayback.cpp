#include "VoicePlayback.h"
#include <spdlog/spdlog.h>
#include <cmath>
#include <algorithm>
#include <chrono>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

VoicePlayback::VoicePlayback()
{
}

VoicePlayback::~VoicePlayback()
{
  Shutdown();
}

bool VoicePlayback::Initialize()
{
  // Configure miniaudio device for playback
  ma_device_config deviceConfig = ma_device_config_init(
    ma_device_type_playback);
  deviceConfig.playback.format = ma_format_f32;
  deviceConfig.playback.channels = kChannels; // Stereo
  deviceConfig.sampleRate = kSampleRate;
  deviceConfig.dataCallback = DataCallback;
  deviceConfig.pUserData = this;

  if (ma_device_init(nullptr, &deviceConfig, &m_device) != MA_SUCCESS) {
    spdlog::error(
      "VoicePlayback::Initialize - Failed to initialize playback device");
    return false;
  }

  if (ma_device_start(&m_device) != MA_SUCCESS) {
    spdlog::error(
      "VoicePlayback::Initialize - Failed to start playback device");
    ma_device_uninit(&m_device);
    return false;
  }

  m_deviceInitialized = true;
  spdlog::info("VoicePlayback initialized successfully");
  return true;
}

void VoicePlayback::PlayVoiceData(uint32_t speakerIdx,
                                  const std::vector<uint8_t>& encodedData,
                                  const std::array<float, 3>& speakerPosition,
                                  const std::array<float, 3>& listenerPosition,
                                  float listenerYaw)
{
  std::lock_guard<std::mutex> lock(m_mutex);

  m_listenerPosition = listenerPosition;
  m_listenerYaw = listenerYaw;

  // Get or create speaker data
  SpeakerData& speakerData = m_speakers[speakerIdx];
  speakerData.position = speakerPosition;

  // Create Opus decoder if needed
  if (!speakerData.decoder) {
    int error = 0;
    speakerData.decoder = opus_decoder_create(kSampleRate, 1, &error); // Mono
    if (error != OPUS_OK || !speakerData.decoder) {
      spdlog::error("VoicePlayback::PlayVoiceData - Failed to create Opus decoder: {}", opus_strerror(error));
      m_speakers.erase(speakerIdx);
      return;
    }
  }

  // Decode Opus data
  std::vector<opus_int16> pcmData(kMaxFrameSize);
  int decodedSamples = opus_decode(speakerData.decoder,
                                   encodedData.data(),
                                   static_cast<opus_int32>(encodedData.size()),
                                   pcmData.data(),
                                   kMaxFrameSize,
                                   0);

  if (decodedSamples < 0) {
    spdlog::warn("VoicePlayback::PlayVoiceData - Opus decoding failed: {}",
                 opus_strerror(decodedSamples));
    return;
  }

  // Update packet timing (for jitter buffer and PLC)
  auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
  speakerData.lastPacketTime = now;
  speakerData.consecutiveLostPackets = 0; // Reset loss counter

  // Convert int16 to float and append to buffer
  size_t oldSize = speakerData.audioBuffer.size();
  speakerData.audioBuffer.resize(oldSize + decodedSamples);
  for (int i = 0; i < decodedSamples; ++i) {
    speakerData.audioBuffer[oldSize + i] =
      static_cast<float>(pcmData[i]) / 32768.0f;
  }

  // Handle jitter buffer logic
  if (speakerData.isBuffering) {
    if (speakerData.audioBuffer.size() >= speakerData.targetBufferSize) {
      speakerData.isBuffering = false;
      spdlog::debug("VoicePlayback - Speaker {} buffer filled, starting playback", speakerIdx);
    }
  }
}

void VoicePlayback::StopSpeaker(uint32_t speakerIdx)
{
  std::lock_guard<std::mutex> lock(m_mutex);

  auto it = m_speakers.find(speakerIdx);
  if (it != m_speakers.end()) {
    if (it->second.decoder) {
      opus_decoder_destroy(it->second.decoder);
    }
    m_speakers.erase(it);
  }
}

void VoicePlayback::Shutdown()
{
  if (m_deviceInitialized) {
    ma_device_stop(&m_device);
    ma_device_uninit(&m_device);
    m_deviceInitialized = false;
  }

  std::lock_guard<std::mutex> lock(m_mutex);
  for (auto& [idx, speaker] : m_speakers) {
    if (speaker.decoder) {
      opus_decoder_destroy(speaker.decoder);
    }
  }
  m_speakers.clear();
}

void VoicePlayback::DataCallback(ma_device* pDevice, void* pOutput,
                                 const void* pInput, ma_uint32 frameCount)
{
  (void)pInput; // Unused for playback

  if (!pDevice || !pDevice->pUserData || !pOutput) {
    return;
  }

  VoicePlayback* playback = static_cast<VoicePlayback*>(pDevice->pUserData);
  playback->MixAudio(static_cast<float*>(pOutput), frameCount);
}

void VoicePlayback::MixAudio(float* pOutput, ma_uint32 frameCount)
{
  std::lock_guard<std::mutex> lock(m_mutex);

  // Clear output buffer
  std::fill(pOutput, pOutput + frameCount * kChannels, 0.0f);

  auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();

  // Process each active speaker
  for (auto it = m_speakers.begin(); it != m_speakers.end();) {
    SpeakerData& speaker = it->second;
    uint32_t speakerIdx = it->first;

    // Check for packet loss and apply concealment if needed
    if (ShouldConcealPacketLoss(speaker)) {
      GenerateConcealmentAudio(speaker);
    }

    // Skip if still buffering
    if (speaker.isBuffering) {
      ++it;
      continue;
    }

    // Calculate 3D audio parameters
    SpatialParams spatial = CalculateSpatial(speaker.position, m_listenerPosition, m_listenerYaw);

    // Mix available audio samples
    uint32_t samplesToMix = std::min(frameCount, static_cast<uint32_t>(speaker.audioBuffer.size()));

    for (uint32_t i = 0; i < samplesToMix; ++i) {
      float sample = speaker.audioBuffer[i] * spatial.volume;
      pOutput[i * kChannels] += sample * spatial.panLeft;      // Left channel
      pOutput[i * kChannels + 1] += sample * spatial.panRight; // Right channel
    }

    // Remove consumed samples
    if (samplesToMix > 0) {
      speaker.audioBuffer.erase(speaker.audioBuffer.begin(),
                                speaker.audioBuffer.begin() + samplesToMix);
    }

    // Remove speakers with empty buffers and old timestamps
    if (speaker.audioBuffer.empty() &&
        (now - speaker.lastPacketTime) > 1000) { // 1 second timeout
      if (speaker.decoder) {
        opus_decoder_destroy(speaker.decoder);
      }
      it = m_speakers.erase(it);
    } else {
      ++it;
    }
  }
}

VoicePlayback::SpatialParams VoicePlayback::CalculateSpatial(
  const std::array<float, 3>& speakerPos,
  const std::array<float, 3>& listenerPos,
  float listenerYaw)
{
  SpatialParams params = { 1.0f, 1.0f, 1.0f };

  // Calculate distance
  float dx = speakerPos[0] - listenerPos[0];
  float dy = speakerPos[1] - listenerPos[1];
  float dz = speakerPos[2] - listenerPos[2];
  float distance = std::sqrt(dx * dx + dy * dy + dz * dz);

  // Distance attenuation (linear falloff)
  if (distance > kMaxVoiceDistance) {
    params.volume = 0.0f;
    params.panLeft = 0.0f;
    params.panRight = 0.0f;
    return params;
  }

  params.volume = std::max(0.0f, 1.0f - (distance / kMaxVoiceDistance));

  // Calculate stereo panning based on relative position
  // Get angle relative to listener's facing direction
  float angle = std::atan2(dx, dz) - listenerYaw;

  // Normalize angle to [-PI, PI]
  while (angle > M_PI) angle -= 2.0f * M_PI;
  while (angle < -M_PI) angle += 2.0f * M_PI;

  // Convert angle to stereo pan
  // -90° (left) = full left, +90° (right) = full right
  float panFactor = std::sin(angle); // Range [-1, 1]

  // Apply panning
  if (panFactor < 0) {
    // Sound is to the left
    params.panLeft = 1.0f;
    params.panRight = 1.0f + panFactor; // Reduce right channel
  } else {
    // Sound is to the right
    params.panLeft = 1.0f - panFactor; // Reduce left channel
    params.panRight = 1.0f;
  }

  // Ensure values are in valid range
  params.panLeft = std::clamp(params.panLeft, 0.0f, 1.0f);
  params.panRight = std::clamp(params.panRight, 0.0f, 1.0f);

  return params;
}

bool VoicePlayback::ShouldConcealPacketLoss(SpeakerData& speakerData)
{
  auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();

  bool packetLost = (now - speakerData.lastPacketTime) > kPacketTimeoutMs;

  return packetLost &&
         speakerData.consecutiveLostPackets < kMaxConsecutivePLC &&
         !speakerData.isBuffering;
}

void VoicePlayback::GenerateConcealmentAudio(SpeakerData& speakerData)
{
  if (!speakerData.decoder) {
    return;
  }

  // Use Opus PLC to generate concealment audio
  std::vector<opus_int16> plcData(kFrameSize);

  // Pass nullptr for encoded data to trigger PLC
  int concealedSamples = opus_decode(speakerData.decoder,
                                     nullptr,  // nullptr triggers PLC
                                     0,
                                     plcData.data(),
                                     kFrameSize,
                                     0);  // fec=0, use PLC

  if (concealedSamples > 0) {
    // Convert int16 to float and append to buffer
    size_t oldSize = speakerData.audioBuffer.size();
    speakerData.audioBuffer.resize(oldSize + concealedSamples);
    for (int i = 0; i < concealedSamples; ++i) {
      speakerData.audioBuffer[oldSize + i] =
        static_cast<float>(plcData[i]) / 32768.0f;
    }

    speakerData.consecutiveLostPackets++;
    spdlog::debug("VoicePlayback - Applied PLC, consecutive lost packets: {}",
                  speakerData.consecutiveLostPackets);
  }
}
