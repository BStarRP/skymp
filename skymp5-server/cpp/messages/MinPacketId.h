#pragma once
namespace Networking {
constexpr unsigned char MinPacketId = 134;
// Special packet ID for binary voice data (bypasses JSON serialization)
constexpr unsigned char BinaryVoicePacketId = 135;
}
