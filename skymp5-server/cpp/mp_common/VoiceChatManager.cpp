#include "VoiceChatManager.h"
#include <spdlog/spdlog.h>

VoiceChatManager::VoiceChatManager()
  : m_capture(std::make_unique<VoiceCapture>())
  , m_playback(std::make_unique<VoicePlayback>())
{
}

VoiceChatManager::~VoiceChatManager()
{
  Shutdown();
}

bool VoiceChatManager::Initialize(SendVoiceDataCallback sendCallback)
{
  if (m_initialized) {
    spdlog::warn("VoiceChatManager::Initialize - Already initialized");
    return true;
  }

  if (!sendCallback) {
    spdlog::error("VoiceChatManager::Initialize - Invalid send callback");
    return false;
  }

  m_sendCallback = sendCallback;

  // Initialize playback first
  if (!m_playback->Initialize()) {
    spdlog::error("VoiceChatManager::Initialize - Failed to initialize playback");
    return false;
  }

  // Initialize capture with callback
  auto captureCallback = [this](const std::vector<uint8_t>& encodedData) {
    OnCapturedAudio(encodedData);
  };

  if (!m_capture->Initialize(captureCallback)) {
    spdlog::error("VoiceChatManager::Initialize - Failed to initialize capture");
    m_playback->Shutdown();
    return false;
  }

  m_initialized = true;
  spdlog::info("VoiceChatManager initialized successfully");
  return true;
}

void VoiceChatManager::Shutdown()
{
  if (!m_initialized) {
    return;
  }

  if (m_isTalking) {
    StopTalking();
  }

  m_capture->Shutdown();
  m_playback->Shutdown();

  m_initialized = false;
  spdlog::info("VoiceChatManager shut down");
}

void VoiceChatManager::StartTalking()
{
  if (!m_initialized) {
    spdlog::warn("VoiceChatManager::StartTalking - Not initialized");
    return;
  }

  if (m_isTalking) {
    return; // Already talking
  }

  m_isTalking = true;
  m_capture->StartCapture();

  // Send "started talking" notification (with empty audio data)
  if (m_sendCallback) {
    m_sendCallback(true, {});
  }

  spdlog::debug("VoiceChatManager: Started talking");
}

void VoiceChatManager::StopTalking()
{
  if (!m_isTalking) {
    return;
  }

  m_isTalking = false;
  m_capture->StopCapture();

  // Send "stopped talking" notification
  if (m_sendCallback) {
    m_sendCallback(false, {});
  }

  spdlog::debug("VoiceChatManager: Stopped talking");
}

bool VoiceChatManager::IsTalking() const
{
  return m_isTalking;
}

void VoiceChatManager::OnReceiveVoiceData(uint32_t speakerIdx,
                                          const std::vector<uint8_t>& audioData,
                                          const std::array<float, 3>& speakerPosition,
                                          const std::array<float, 3>& listenerPosition,
                                          float listenerYaw)
{
  if (!m_initialized) {
    return;
  }

  if (!audioData.empty()) {
    m_playback->PlayVoiceData(speakerIdx, audioData, speakerPosition, listenerPosition, listenerYaw);
  }
}

void VoiceChatManager::OnPlayerStoppedTalking(uint32_t speakerIdx)
{
  if (!m_initialized) {
    return;
  }

  m_playback->StopSpeaker(speakerIdx);
}

void VoiceChatManager::OnCapturedAudio(const std::vector<uint8_t>& encodedData)
{
  if (!m_initialized || !m_isTalking || encodedData.empty()) {
    return;
  }

  // Send encoded audio data to server
  if (m_sendCallback) {
    m_sendCallback(true, encodedData);
  }
}
