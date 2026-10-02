#include "sidechannel/core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>
#include <string_view>
#include <utility>

namespace sidechannel {
namespace {

struct SourceSpec {
  const char* id;
  const char* channel;
  double range_min;
  double range_max;
};

constexpr std::array<SourceSpec, 9> kSources = {{
  {"sim_rf", "rf", -120.0, 0.0},
  {"sim_magnetic", "magnetic", 0.0, 200.0},
  {"sim_heat", "heat", -20.0, 80.0},
  {"sim_vibration", "vibration", 0.0, 1.0},
  {"sim_sound", "sound", 0.0, 1.0},
  {"sim_network", "network", 0.0, 100000.0},
  {"sim_electrical", "electrical", 0.0, 5000.0},
  {"sim_bluetooth", "bluetooth", 0.0, 100.0},
  {"sim_light", "light_flicker", 0.0, 1.0}
}};

double round4(double value) {
  return std::round(value * 10000.0) / 10000.0;
}

double round3(double value) {
  return std::round(value * 1000.0) / 1000.0;
}

constexpr std::array<std::uint32_t, 64> kSha256RoundConstants = {
  0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
  0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
  0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
  0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
  0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
  0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
  0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
  0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u
};

std::uint32_t rotate_right(std::uint32_t value, std::uint32_t amount) {
  return (value >> amount) | (value << (32u - amount));
}

std::string sha256(std::string_view input) {
  std::array<std::uint32_t, 8> hash = {
    0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u
  };
  std::array<std::uint8_t, 64> block{};
  std::size_t block_size = 0;
  std::uint64_t bit_length = 0;

  const auto transform = [&hash](const std::array<std::uint8_t, 64>& bytes) {
    std::array<std::uint32_t, 64> schedule{};
    for (std::size_t index = 0; index < 16; ++index) {
      schedule[index] = (static_cast<std::uint32_t>(bytes[index * 4]) << 24u) |
        (static_cast<std::uint32_t>(bytes[index * 4 + 1]) << 16u) |
        (static_cast<std::uint32_t>(bytes[index * 4 + 2]) << 8u) |
        static_cast<std::uint32_t>(bytes[index * 4 + 3]);
    }
    for (std::size_t index = 16; index < schedule.size(); ++index) {
      const auto small_sigma0 = rotate_right(schedule[index - 15], 7u) ^
        rotate_right(schedule[index - 15], 18u) ^ (schedule[index - 15] >> 3u);
      const auto small_sigma1 = rotate_right(schedule[index - 2], 17u) ^
        rotate_right(schedule[index - 2], 19u) ^ (schedule[index - 2] >> 10u);
      schedule[index] = schedule[index - 16] + small_sigma0 + schedule[index - 7] + small_sigma1;
    }
    auto a = hash[0]; auto b = hash[1]; auto c = hash[2]; auto d = hash[3];
    auto e = hash[4]; auto f = hash[5]; auto g = hash[6]; auto h = hash[7];
    for (std::size_t index = 0; index < schedule.size(); ++index) {
      const auto big_sigma1 = rotate_right(e, 6u) ^ rotate_right(e, 11u) ^ rotate_right(e, 25u);
      const auto choose = (e & f) ^ ((~e) & g);
      const auto temp1 = h + big_sigma1 + choose + kSha256RoundConstants[index] + schedule[index];
      const auto big_sigma0 = rotate_right(a, 2u) ^ rotate_right(a, 13u) ^ rotate_right(a, 22u);
      const auto majority = (a & b) ^ (a & c) ^ (b & c);
      const auto temp2 = big_sigma0 + majority;
      h = g; g = f; f = e; e = d + temp1; d = c; c = b; b = a; a = temp1 + temp2;
    }
    hash[0] += a; hash[1] += b; hash[2] += c; hash[3] += d;
    hash[4] += e; hash[5] += f; hash[6] += g; hash[7] += h;
  };

  for (const auto character : input) {
    block[block_size++] = static_cast<std::uint8_t>(character);
    bit_length += 8;
    if (block_size == block.size()) {
      transform(block);
      block_size = 0;
    }
  }
  block[block_size++] = 0x80u;
  if (block_size > 56) {
    while (block_size < block.size()) block[block_size++] = 0;
    transform(block);
    block_size = 0;
  }
  while (block_size < 56) block[block_size++] = 0;
  for (std::size_t index = 0; index < 8; ++index) {
    block[63 - index] = static_cast<std::uint8_t>(bit_length >> (index * 8));
  }
  transform(block);

  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (const auto word : hash) output << std::setw(8) << word;
  return output.str();
}

void write_json_string(std::ostringstream& output, std::string_view value) {
  output << '"';
  for (const auto character : value) {
    switch (character) {
      case '\\': output << "\\\\"; break;
      case '"': output << "\\\""; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default: output << character; break;
    }
  }
  output << '"';
}

std::string source_registry_json() {
  std::ostringstream output;
  output << '[';
  for (std::size_t index = 0; index < kSources.size(); ++index) {
    if (index > 0) output << ',';
    output << "{\"id\":";
    write_json_string(output, kSources[index].id);
    output << '}';
  }
  output << ']';
  return output.str();
}

const char* unit_for(const char* channel) {
  if (std::string_view(channel) == "rf") return "dBm";
  if (std::string_view(channel) == "magnetic") return "uT";
  if (std::string_view(channel) == "heat") return "C";
  if (std::string_view(channel) == "vibration") return "g";
  if (std::string_view(channel) == "sound") return "normalized";
  if (std::string_view(channel) == "network") return "bps";
  if (std::string_view(channel) == "electrical") return "W";
  if (std::string_view(channel) == "bluetooth") return "percent";
  return "normalized";
}

std::string observation_json(const Observation& observation) {
  std::ostringstream output;
  output << std::setprecision(15);
  output << "{\"schema\":\"sidechannel.observation/2\",\"id\":";
  write_json_string(output, observation.id);
  output << ",\"sourceId\":";
  write_json_string(output, observation.source_id);
  output << ",\"channel\":";
  write_json_string(output, observation.channel);
  output << ",\"timestampMs\":" << observation.timestamp_ms
    << ",\"value\":" << observation.value << ",\"unit\":";
  write_json_string(output, unit_for(observation.channel.c_str()));
  output << ",\"status\":\"measured\",\"evidenceState\":";
  write_json_string(output, to_string(observation.evidence_state));
  output << ",\"quality\":{\"score\":" << observation.quality_score
    << ",\"state\":\"good\",\"reasons\":[]},\"transformRevision\":0,\"sequence\":"
    << observation.sequence << '}';
  return output.str();
}

} // namespace

AdmissionSequencer::AdmissionSequencer(std::size_t max_queue)
  : max_queue_(std::max<std::size_t>(1, max_queue)) {}

bool AdmissionSequencer::enqueue(Observation observation) {
  ++receipt_.frames_received;
  if (queue_.size() >= max_queue_) {
    ++receipt_.frames_dropped_backpressure;
    return false;
  }
  queue_.push_back(std::move(observation));
  receipt_.max_depth = std::max(receipt_.max_depth, queue_.size());
  return true;
}

std::vector<Observation> AdmissionSequencer::drain() {
  std::vector<Observation> admitted;
  admitted.reserve(queue_.size());
  while (!queue_.empty()) {
    admitted.push_back(std::move(queue_.front()));
    queue_.pop_front();
    ++receipt_.frames_admitted;
  }
  receipt_.pending = queue_.size();
  return admitted;
}

std::size_t AdmissionSequencer::pending() const noexcept {
  return queue_.size();
}

const IngressReceipt& AdmissionSequencer::receipt() const noexcept {
  return receipt_;
}

DeterministicSimulator::DeterministicSimulator(std::uint32_t seed)
  : random_state_(seed) {}

double DeterministicSimulator::random() {
  random_state_ += 0x6D2B79F5u;
  std::uint32_t value = random_state_;
  value = static_cast<std::uint32_t>((value ^ (value >> 15u)) * (1u | value));
  value ^= value + static_cast<std::uint32_t>((value ^ (value >> 7u)) * (61u | value));
  return static_cast<double>(value ^ (value >> 14u)) / 4294967296.0;
}

std::vector<Observation> DeterministicSimulator::tick(std::uint64_t tick, std::int64_t timestamp_ms) {
  std::vector<Observation> observations;
  observations.reserve(kSources.size());
  for (std::size_t index = 0; index < kSources.size(); ++index) {
    const auto& source = kSources[index];
    const double wave = 0.5 + 0.5 * std::sin(static_cast<double>(tick) * 0.18 + static_cast<double>(index) * 0.91);
    const double pulse = 0.5 + 0.5 * std::sin(static_cast<double>(tick) * 0.047 + static_cast<double>(index) * 1.7);
    const double jitter = (random() - 0.5) * 0.06;
    const double normalized = std::clamp(0.18 + 0.62 * wave + 0.18 * pulse + jitter, 0.02, 0.98);
    const double value = source.range_min + (source.range_max - source.range_min) * normalized;
    observations.push_back(Observation{
      "sidechannel.observation/2",
      std::string(source.id) + "_" + std::to_string(tick),
      source.id,
      source.channel,
      timestamp_ms,
      round4(value),
      round3(0.88 + random() * 0.11),
      0,
      EvidenceState::simulated
    });
  }
  return observations;
}

SessionArchive::SessionArchive(std::string session_id)
  : session_id_(std::move(session_id)) {}

void SessionArchive::append(Observation observation) {
  observation.sequence = observations_.size() + 1;
  observations_.push_back(std::move(observation));
}

const std::vector<Observation>& SessionArchive::observations() const noexcept {
  return observations_;
}

std::string SessionArchive::to_json() const {
  const std::string scene_snapshot = "{\"id\":\"scene_native\"}";
  const std::string source_registry = source_registry_json();
  const std::string transform_snapshot = "{\"revision\":0,\"edges\":[]}";
  const std::string runtime_build = "sidechannel-native-reference";
  const std::string schema_set = "sidechannel-schema-set/0.1";
  const std::string snapshot_canonical = "{\"sceneSnapshot\":" + scene_snapshot +
    ",\"sourceRegistrySnapshot\":" + source_registry +
    ",\"calibrationRegistrySnapshot\":[],\"transformGraphSnapshot\":" + transform_snapshot +
    ",\"runtimeBuildId\":\"" + runtime_build + "\",\"schemaSetDigest\":\"" + schema_set + "\"}";

  std::ostringstream output;
  output << "{\"format\":\"sidechannel-session\",\"formatVersion\":\"0.2\",\"sessionId\":";
  write_json_string(output, session_id_);
  output << ",\"scene\":" << scene_snapshot << ",\"sources\":" << source_registry
    << ",\"sceneSnapshot\":" << scene_snapshot
    << ",\"sourceRegistrySnapshot\":" << source_registry
    << ",\"calibrationRegistrySnapshot\":[],\"transformGraphSnapshot\":" << transform_snapshot
    << ",\"runtimeBuildId\":\"" << runtime_build << "\",\"schemaSetDigest\":\"" << schema_set
    << "\",\"snapshotDigest\":\"" << sha256(snapshot_canonical)
    << "\",\"historicalSnapshotComplete\":true,\"sessionState\":\"completed\",\"interruptionReason\":null"
    << ",\"poses\":[],\"journal\":[],\"observations\":[";
  for (std::size_t index = 0; index < observations_.size(); ++index) {
    if (index > 0) output << ',';
    output << observation_json(observations_[index]);
  }
  output << "],\"events\":[],\"createdAtMs\":0,\"privacy\":{\"classes\":[\"local_numeric\"],"
    << "\"rawAudioIncluded\":false,\"networkPayloadsIncluded\":false,\"persistentDeviceIdsIncluded\":false}}";
  const std::string package_without_digest = output.str();
  return package_without_digest.substr(0, package_without_digest.size() - 1) +
    ",\"packageDigest\":\"" + sha256(package_without_digest) + "\"}";
}

const char* to_string(EvidenceState state) noexcept {
  switch (state) {
    case EvidenceState::measured: return "measured";
    case EvidenceState::simulated: return "simulated";
    case EvidenceState::derived: return "derived";
    case EvidenceState::imported: return "imported";
    case EvidenceState::stale: return "stale";
    case EvidenceState::rejected: return "rejected";
    case EvidenceState::unknown: return "unknown";
  }
  return "unknown";
}

} // namespace sidechannel
