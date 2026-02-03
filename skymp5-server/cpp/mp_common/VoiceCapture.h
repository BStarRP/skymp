#pragma once

#include <opus/opus.h>
#include <miniaudio.h>
#include <vector>
#include <cstdint>
#include <functional>
#include <mutex>

/// <summary>
/// Captures microphone audio and encodes it to Opus format for voice chat.
/// </summary>
class VoiceCapture
{
public:
  /// Callback for when encoded audio data is ready to send
  using AudioDataCallback = std::function<void(const std::vector<uint8_t>& encodedData)>;

  VoiceCapture();
  ~VoiceCapture();

  /// Initialize the capture system
  bool Initialize(AudioDataCallback callback);

  /// Start capturing audio (push-to-talk pressed)
  void StartCapture();

  /// Stop capturing audio (push-to-talk released)
  void StopCapture();

  /// Check if currently capturing
  bool IsCapturing() const { return m_isCapturing; }

  /// Shutdown and cleanup
  void Shutdown();

private:
  static void DataCallback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount);
  void ProcessAudioData(const float* pInput, ma_uint32 frameCount);

  // Audio configuration
  static constexpr int kSampleRate = 16000;      // 16kHz for voice (Opus wideband)
  static constexpr int kChannels = 1;            // Mono
  static constexpr int kFrameSize = 320;         // 20ms at 16kHz (320 samples)
  static constexpr int kMaxPacketSize = 4000;    // Max Opus packet size

  // miniaudio device
  ma_device m_device = {};
  bool m_deviceInitialized = false;
  bool m_isCapturing = false;

  // Opus encoder
  OpusEncoder* m_encoder = nullptr;

  // Callback for sending encoded data
  AudioDataCallback m_callback;

  // Audio buffer for accumulating samples
  std::vector<float> m_audioBuffer;
  std::mutex m_mutex;
};
