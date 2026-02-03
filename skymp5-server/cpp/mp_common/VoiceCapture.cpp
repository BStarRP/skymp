#include "VoiceCapture.h"
#include <spdlog/spdlog.h>
#include <algorithm>

#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

VoiceCapture::VoiceCapture()
{
  m_audioBuffer.reserve(kFrameSize);
}

VoiceCapture::~VoiceCapture()
{
  Shutdown();
}

bool VoiceCapture::Initialize(AudioDataCallback callback)
{
  if (!callback) {
    spdlog::error("VoiceCapture::Initialize - Invalid callback");
    return false;
  }

  m_callback = callback;

  // Create Opus encoder
  int error = 0;
  m_encoder = opus_encoder_create(kSampleRate, kChannels, OPUS_APPLICATION_VOIP, &error);
  if (error != OPUS_OK || !m_encoder) {
    spdlog::error("VoiceCapture::Initialize - Failed to create Opus encoder: {}", opus_strerror(error));
    return false;
  }

  // Configure Opus for voice chat quality
  opus_encoder_ctl(m_encoder, OPUS_SET_BITRATE(24000)); // 24 kbps
  opus_encoder_ctl(m_encoder, OPUS_SET_VBR(1));         // Variable bitrate
  opus_encoder_ctl(m_encoder, OPUS_SET_COMPLEXITY(5));  // Medium complexity

  // Configure miniaudio device
  ma_device_config deviceConfig = ma_device_config_init(ma_device_type_capture);
  deviceConfig.capture.format = ma_format_f32;
  deviceConfig.capture.channels = kChannels;
  deviceConfig.sampleRate = kSampleRate;
  deviceConfig.dataCallback = DataCallback;
  deviceConfig.pUserData = this;

  if (ma_device_init(nullptr, &deviceConfig, &m_device) != MA_SUCCESS) {
    spdlog::error("VoiceCapture::Initialize - Failed to initialize capture device");
    opus_encoder_destroy(m_encoder);
    m_encoder = nullptr;
    return false;
  }

  // Start the device immediately (but keep m_isCapturing = false)
  // This eliminates frame drops from ma_device_start() during push-to-talk
  if (ma_device_start(&m_device) != MA_SUCCESS) {
    spdlog::error("VoiceCapture::Initialize - Failed to start device");
    ma_device_uninit(&m_device);
    opus_encoder_destroy(m_encoder);
    m_encoder = nullptr;
    m_deviceInitialized = false;
    return false;
  }

  m_deviceInitialized = true;
  spdlog::info("VoiceCapture initialized successfully");
  return true;
}

void VoiceCapture::StartCapture()
{
  if (!m_deviceInitialized) {
    spdlog::warn("VoiceCapture::StartCapture - Device not initialized");
    return;
  }

  std::lock_guard<std::mutex> lock(m_mutex);
  m_isCapturing = true;
  m_audioBuffer.clear();
}

void VoiceCapture::StopCapture()
{
  std::lock_guard<std::mutex> lock(m_mutex);
  m_isCapturing = false;
  m_audioBuffer.clear();
}

void VoiceCapture::Shutdown()
{
  if (m_deviceInitialized) {
    ma_device_stop(&m_device);
    ma_device_uninit(&m_device);
    m_deviceInitialized = false;
  }

  if (m_encoder) {
    opus_encoder_destroy(m_encoder);
    m_encoder = nullptr;
  }

  m_isCapturing = false;
  m_audioBuffer.clear();
}

void VoiceCapture::DataCallback(ma_device* pDevice, void* pOutput, const void* pInput, ma_uint32 frameCount)
{
  (void)pOutput; // Unused for capture

  if (!pDevice || !pDevice->pUserData || !pInput) {
    return;
  }

  VoiceCapture* capture = static_cast<VoiceCapture*>(pDevice->pUserData);
  capture->ProcessAudioData(static_cast<const float*>(pInput), frameCount);
}

void VoiceCapture::ProcessAudioData(const float* pInput, ma_uint32 frameCount)
{
  std::lock_guard<std::mutex> lock(m_mutex);

  if (!m_isCapturing || !pInput || !m_encoder || frameCount == 0) {
    return;
  }

  // Add samples to buffer
  size_t oldSize = m_audioBuffer.size();
  m_audioBuffer.resize(oldSize + frameCount);
  std::copy(pInput, pInput + frameCount, m_audioBuffer.begin() + oldSize);

  // Process complete frames
  while (m_audioBuffer.size() >= kFrameSize) {
    // Convert float to Opus int16 format
    std::vector<opus_int16> pcmData(kFrameSize);
    for (int i = 0; i < kFrameSize; ++i) {
      float sample = std::clamp(m_audioBuffer[i], -1.0f, 1.0f);
      pcmData[i] = static_cast<opus_int16>(sample * 32767.0f);
    }

    // Encode to Opus
    std::vector<unsigned char> encodedData(kMaxPacketSize);
    int encodedBytes = opus_encode(m_encoder, pcmData.data(), kFrameSize,
                                    encodedData.data(), kMaxPacketSize);

    if (encodedBytes > 0) {
      encodedData.resize(encodedBytes);

      // Send via callback
      if (m_callback) {
        m_callback(encodedData);
      }
    } else {
      spdlog::warn("VoiceCapture::ProcessAudioData - Opus encoding failed: {}", opus_strerror(encodedBytes));
    }

    // Remove processed samples
    m_audioBuffer.erase(m_audioBuffer.begin(), m_audioBuffer.begin() + kFrameSize);
  }
}
