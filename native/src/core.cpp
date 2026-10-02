#include "sidechannel/core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <filesystem>
#include <iomanip>
#include <limits>
#include <map>
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

std::string quote_json(std::string_view value) {
  std::ostringstream output;
  write_json_string(output, value);
  return output.str();
}

std::string hex_encode(std::string_view value) {
  static constexpr char digits[] = "0123456789abcdef";
  std::string encoded;
  encoded.reserve(value.size() * 2);
  for (const auto character : value) {
    const auto byte = static_cast<unsigned char>(character);
    encoded.push_back(digits[byte >> 4u]);
    encoded.push_back(digits[byte & 0x0fu]);
  }
  return encoded;
}

int hex_value(char character) {
  if (character >= '0' && character <= '9') return character - '0';
  if (character >= 'a' && character <= 'f') return character - 'a' + 10;
  if (character >= 'A' && character <= 'F') return character - 'A' + 10;
  return -1;
}

bool hex_decode(std::string_view value, std::string& decoded) {
  if (value.size() % 2 != 0) return false;
  decoded.clear();
  decoded.reserve(value.size() / 2);
  for (std::size_t index = 0; index < value.size(); index += 2) {
    const auto high = hex_value(value[index]);
    const auto low = hex_value(value[index + 1]);
    if (high < 0 || low < 0) return false;
    decoded.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

std::vector<std::string> split_tab(std::string_view line) {
  std::vector<std::string> fields;
  std::size_t start = 0;
  while (start <= line.size()) {
    const auto end = line.find('\t', start);
    if (end == std::string_view::npos) {
      fields.emplace_back(line.substr(start));
      break;
    }
    fields.emplace_back(line.substr(start, end - start));
    start = end + 1;
  }
  return fields;
}

bool parse_u64(std::string_view value, std::uint64_t& parsed) {
  try {
    std::size_t consumed = 0;
    const auto text = std::string(value);
    parsed = std::stoull(text, &consumed, 10);
    return consumed == text.size();
  } catch (...) {
    return false;
  }
}

bool parse_i64(std::string_view value, std::int64_t& parsed) {
  try {
    std::size_t consumed = 0;
    const auto text = std::string(value);
    parsed = std::stoll(text, &consumed, 10);
    return consumed == text.size();
  } catch (...) {
    return false;
  }
}

bool parse_double(std::string_view value, double& parsed) {
  try {
    std::size_t consumed = 0;
    const auto text = std::string(value);
    parsed = std::stod(text, &consumed);
    return consumed == text.size() && std::isfinite(parsed);
  } catch (...) {
    return false;
  }
}

int evidence_value(EvidenceState state) {
  switch (state) {
    case EvidenceState::measured: return 0;
    case EvidenceState::simulated: return 1;
    case EvidenceState::derived: return 2;
    case EvidenceState::imported: return 3;
    case EvidenceState::stale: return 4;
    case EvidenceState::rejected: return 5;
    case EvidenceState::unknown: return 6;
  }
  return 6;
}

bool evidence_from_value(std::string_view value, EvidenceState& state) {
  std::uint64_t parsed = 0;
  if (!parse_u64(value, parsed) || parsed > 6) return false;
  state = static_cast<EvidenceState>(parsed);
  return true;
}

std::string observation_payload(const Observation& observation) {
  std::ostringstream canonical;
  canonical << std::setprecision(17)
    << "{\"schema\":" << quote_json(observation.schema)
    << ",\"id\":" << quote_json(observation.id)
    << ",\"sourceId\":" << quote_json(observation.source_id)
    << ",\"channel\":" << quote_json(observation.channel)
    << ",\"timestampMs\":" << observation.timestamp_ms
    << ",\"value\":" << observation.value
    << ",\"qualityScore\":" << observation.quality_score
    << ",\"sequence\":" << observation.sequence
    << ",\"evidenceState\":" << evidence_value(observation.evidence_state) << '}';
  return "{\"observationId\":" + quote_json(observation.id) +
    ",\"sequence\":" + std::to_string(observation.sequence) +
    ",\"recordDigest\":\"" + sha256(canonical.str()) + "\"}";
}

std::string journal_digest(
  std::string_view session_id,
  std::size_t sequence,
  std::int64_t timestamp_ms,
  std::string_view type,
  std::string_view payload,
  std::string_view previous_digest
) {
  const std::string canonical = "{\"sessionId\":" + quote_json(session_id) +
    ",\"sequence\":" + std::to_string(sequence) +
    ",\"timestampMs\":" + std::to_string(timestamp_ms) +
    ",\"type\":" + quote_json(type) +
    ",\"payload\":" + std::string(payload) +
    ",\"previousDigest\":" + (previous_digest.empty() ? "null" : quote_json(previous_digest)) + '}';
  return sha256(canonical);
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
  if (std::string_view(channel) == "network") return "bytes/s";
  if (std::string_view(channel) == "electrical") return "W";
  if (std::string_view(channel) == "bluetooth") return "devices";
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

std::string compute_journal_digest(
  std::string_view session_id,
  std::size_t sequence,
  std::int64_t timestamp_ms,
  std::string_view type,
  std::string_view payload,
  std::string_view previous_digest
) {
  return journal_digest(session_id, sequence, timestamp_ms, type, payload, previous_digest);
}

std::string observation_admission_payload(const Observation& observation) {
  return observation_payload(observation);
}

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

NativeAdapterSupervisor::NativeAdapterSupervisor(std::size_t failure_threshold)
  : failure_threshold_(std::max<std::size_t>(failure_threshold, 1)) {}

NativeAdapterRecord* NativeAdapterSupervisor::require(const std::string& provider_id, std::string& error) {
  const auto found = adapters_.find(provider_id);
  if (found == adapters_.end()) {
    error = "adapter not registered: " + provider_id;
    return nullptr;
  }
  return &found->second;
}

bool NativeAdapterSupervisor::register_provider(NativeAdapterManifest manifest, std::int64_t now_ms,
  std::string& error) {
  if (manifest.protocol_version != "sidechannel.adapter/1") {
    error = "unsupported adapter protocol version";
    return false;
  }
  if (manifest.provider_id.empty() || manifest.provider_version.empty() || manifest.provider_digest.empty()) {
    error = "provider identity and digest are required";
    return false;
  }
  if (manifest.capabilities.empty()) {
    error = "at least one adapter capability is required";
    return false;
  }
  if (manifest.maximum_frame_bytes < 256 || manifest.maximum_frame_bytes > 2'000'000) {
    error = "maximum frame bytes are outside the bounded adapter contract";
    return false;
  }
  for (const auto& capability : manifest.capabilities) {
    if (capability.empty()) {
      error = "adapter capabilities cannot be empty";
      return false;
    }
  }
  auto [found, inserted] = adapters_.try_emplace(manifest.provider_id);
  if (!inserted) {
    const auto granted = found->second.granted_permissions;
    const auto failures = found->second.failure_count;
    const auto last_failure = found->second.last_failure;
    found->second = NativeAdapterRecord{};
    found->second.granted_permissions = granted;
    found->second.failure_count = failures;
    found->second.last_failure = last_failure;
  }
  found->second.manifest = std::move(manifest);
  found->second.state = "VALIDATED";
  found->second.last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::grant_permissions(const std::string& provider_id,
  std::vector<std::string> permissions, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  std::sort(permissions.begin(), permissions.end());
  permissions.erase(std::unique(permissions.begin(), permissions.end()), permissions.end());
  for (const auto& permission : permissions) {
    if (std::find(adapter->manifest.required_permissions.begin(), adapter->manifest.required_permissions.end(), permission) ==
        adapter->manifest.required_permissions.end()) {
      error = "permission grant exceeds provider manifest request";
      return false;
    }
  }
  adapter->granted_permissions = std::move(permissions);
  adapter->state = "DISABLED";
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::revoke_permissions(const std::string& provider_id,
  std::vector<std::string> permissions, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  if (permissions.empty()) permissions = adapter->granted_permissions;
  std::sort(permissions.begin(), permissions.end());
  permissions.erase(std::unique(permissions.begin(), permissions.end()), permissions.end());
  for (const auto& permission : permissions) {
    if (std::find(adapter->granted_permissions.begin(), adapter->granted_permissions.end(), permission) ==
        adapter->granted_permissions.end()) {
      error = "permission revocation includes a permission that is not granted";
      return false;
    }
  }
  std::vector<std::string> remaining;
  for (const auto& granted : adapter->granted_permissions) {
    if (std::find(permissions.begin(), permissions.end(), granted) == permissions.end()) remaining.push_back(granted);
  }
  adapter->granted_permissions = std::move(remaining);
  adapter->state = "DISABLED";
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::start(const std::string& provider_id, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  if (adapter->state == "QUARANTINED") {
    error = "adapter is quarantined";
    return false;
  }
  for (const auto& permission : adapter->manifest.required_permissions) {
    if (std::find(adapter->granted_permissions.begin(), adapter->granted_permissions.end(), permission) ==
        adapter->granted_permissions.end()) {
      adapter->state = "DISABLED";
      error = "required permissions are not granted: " + permission;
      return false;
    }
  }
  adapter->state = "STARTING";
  adapter->last_transition_at_ms = now_ms;
  adapter->state = "RUNNING";
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::stop(const std::string& provider_id, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  if (adapter->state == "RUNNING" || adapter->state == "STARTING") {
    adapter->state = "STOPPING";
    adapter->last_transition_at_ms = now_ms;
  }
  adapter->state = "STOPPED";
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::record_failure(const std::string& provider_id, std::string reason,
  std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  ++adapter->failure_count;
  adapter->last_failure = std::move(reason);
  adapter->last_transition_at_ms = now_ms;
  if (adapter->failure_count >= failure_threshold_) adapter->state = "QUARANTINED";
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::record_success(const std::string& provider_id, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  adapter->failure_count = 0;
  adapter->last_failure.clear();
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

bool NativeAdapterSupervisor::clear_quarantine(const std::string& provider_id, std::int64_t now_ms, std::string& error) {
  auto* adapter = require(provider_id, error);
  if (!adapter) return false;
  if (adapter->state != "QUARANTINED") {
    error.clear();
    return true;
  }
  adapter->state = "DISABLED";
  adapter->failure_count = 0;
  adapter->last_failure.clear();
  adapter->last_transition_at_ms = now_ms;
  error.clear();
  return true;
}

const NativeAdapterRecord* NativeAdapterSupervisor::get(const std::string& provider_id) const noexcept {
  const auto found = adapters_.find(provider_id);
  return found == adapters_.end() ? nullptr : &found->second;
}

std::vector<NativeAdapterRecord> NativeAdapterSupervisor::list() const {
  std::vector<NativeAdapterRecord> records;
  records.reserve(adapters_.size());
  for (const auto& [provider_id, record] : adapters_) records.push_back(record);
  return records;
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

void SessionArchive::set_journal(std::vector<JournalEntry> entries) {
  journal_entries_ = std::move(entries);
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
    << ",\"poses\":[],\"journal\":[";
  std::ostringstream journal;
  std::size_t journal_sequence = 1;
  const auto write_journal_entry = [&journal, this](const JournalEntry& entry) {
    if (entry.sequence > 1) journal << ',';
    journal << "{\"id\":\"journal_native_" << entry.sequence << "\",\"sessionId\":"
      << quote_json(session_id_) << ",\"sequence\":" << entry.sequence
      << ",\"timestampMs\":" << entry.timestamp_ms << ",\"type\":" << quote_json(entry.type)
      << ",\"payload\":" << entry.payload << ",\"previousDigest\":"
      << (entry.previous_digest.empty() ? "null" : quote_json(entry.previous_digest))
      << ",\"eventDigest\":\"" << entry.event_digest << "\"}";
  };
  if (!journal_entries_.empty()) {
    for (const auto& entry : journal_entries_) write_journal_entry(entry);
  } else {
    std::string previous_digest;
    const auto append_journal = [&](std::string_view type, std::int64_t timestamp_ms, const std::string& payload) {
      const auto sequence = journal_sequence++;
      const std::string digest = journal_digest(session_id_, sequence, timestamp_ms, type, payload, previous_digest);
      JournalEntry entry{sequence, timestamp_ms, std::string(type), payload, previous_digest, digest};
      write_journal_entry(entry);
      previous_digest = digest;
    };
    const std::string snapshot_digest = sha256(snapshot_canonical);
    append_journal("SessionOpened", 0, "{\"snapshotDigest\":\"" + snapshot_digest + "\"}");
    for (std::size_t index = 0; index < observations_.size(); ++index) {
      append_journal("ObservationAdmitted", observations_[index].timestamp_ms,
        "{\"observationId\":" + quote_json(observations_[index].id) +
        ",\"sequence\":" + std::to_string(observations_[index].sequence) + "}");
    }
    const auto ended_at_ms = observations_.empty() ? std::int64_t{0} : observations_.back().timestamp_ms;
    append_journal("SessionClosed", ended_at_ms, "{\"endedAtMs\":" + std::to_string(ended_at_ms) + "}");
  }
  output << journal.str() << "],\"observations\":[";
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

NativeSceneView create_native_scene_view(
  const std::vector<Observation>& observations,
  std::int64_t now_ms,
  SceneViewLimits limits
) {
  constexpr std::size_t max_source_cap = 256;
  constexpr std::size_t max_observation_cap = 512;
  limits.max_sources = std::clamp(limits.max_sources, std::size_t{1}, max_source_cap);
  limits.max_observations = std::clamp(limits.max_observations, std::size_t{1}, max_observation_cap);

  NativeSceneView view;
  view.generated_at_ms = now_ms;
  view.observation_count = observations.size();
  view.limits = limits;

  std::map<std::string, std::string> source_channels;
  for (const auto& observation : observations) {
    if (!observation.source_id.empty()) source_channels.try_emplace(observation.source_id, observation.channel);
  }
  view.source_count = source_channels.size();

  view.observations = observations;
  std::sort(view.observations.begin(), view.observations.end(), [](const Observation& left, const Observation& right) {
    return left.timestamp_ms < right.timestamp_ms ||
      (left.timestamp_ms == right.timestamp_ms && left.id < right.id);
  });
  if (view.observations.size() > limits.max_observations) {
    view.observations.erase(view.observations.begin(), view.observations.end() - limits.max_observations);
  }

  std::map<std::string, Observation> latest_by_source;
  for (const auto& observation : view.observations) latest_by_source[observation.source_id] = observation;
  std::size_t source_index = 0;
  for (const auto& [source_id, channel] : source_channels) {
    if (source_index++ >= limits.max_sources) break;
    NativeSourceProjection projection{source_id, channel, "", 0, "", "waiting"};
    const auto latest = latest_by_source.find(source_id);
    if (latest != latest_by_source.end()) {
      projection.observation_id = latest->second.id;
      projection.observation_timestamp_ms = latest->second.timestamp_ms;
      projection.observation_status = to_string(latest->second.evidence_state);
      const bool stale_by_age = now_ms >= latest->second.timestamp_ms &&
        now_ms - latest->second.timestamp_ms > 5000;
      projection.health = latest->second.evidence_state == EvidenceState::stale || stale_by_age ? "stale" : "live";
    }
    view.source_projections.push_back(std::move(projection));
  }
  return view;
}

std::string NativeSceneView::to_json() const {
  std::ostringstream output;
  output << "{\"format\":\"sidechannel.scene-view/1\",\"formatVersion\":1,\"generatedAtMs\":"
    << generated_at_ms << ",\"scene\":null,\"sourceProjections\":[";
  for (std::size_t index = 0; index < source_projections.size(); ++index) {
    if (index > 0) output << ',';
    const auto& projection = source_projections[index];
    output << "{\"id\":" << quote_json(projection.id)
      << ",\"name\":" << quote_json(projection.id)
      << ",\"adapterType\":\"native-reference\",\"channels\":["
      << quote_json(projection.channel) << "],\"providerId\":null,\"position\":null"
      << ",\"health\":" << quote_json(projection.health) << ",\"observationId\":";
    if (projection.observation_id.empty()) output << "null";
    else output << quote_json(projection.observation_id);
    output << ",\"observationTimestampMs\":";
    if (projection.observation_id.empty()) output << "null";
    else output << projection.observation_timestamp_ms;
    output << ",\"observationStatus\":";
    if (projection.observation_id.empty()) output << "null";
    else output << quote_json(projection.observation_status);
    output << '}';
  }
  output << "],\"observations\":[";
  for (std::size_t index = 0; index < observations.size(); ++index) {
    if (index > 0) output << ',';
    output << observation_json(observations[index]);
  }
  output << "],\"events\":[],\"diagnostics\":[],\"adapterRuntime\":[],\"recording\":null"
    << ",\"limits\":{\"maxSources\":" << limits.max_sources
    << ",\"maxObservations\":" << limits.max_observations
    << ",\"maxEvents\":" << limits.max_events
    << ",\"maxDiagnostics\":" << limits.max_diagnostics
    << ",\"maxAdapters\":" << limits.max_adapters << '}'
    << ",\"summary\":{\"sourceCount\":" << source_count
    << ",\"boundedSourceCount\":" << source_projections.size()
    << ",\"observationCount\":" << observation_count
    << ",\"boundedObservationCount\":" << observations.size()
    << ",\"eventCount\":0,\"diagnosticCount\":0}}";
  return output.str();
}

std::string LocalIpcCodec::encode(const IpcFrame& frame, const std::string& token) {
  if (token.empty() || frame.request_id.empty() || frame.type.empty()) return {};
  const auto wire = std::string("sidechannel.native-ipc/1\t") + hex_encode(frame.request_id) +
    '\t' + hex_encode(token) + '\t' + hex_encode(frame.type) + '\t' + hex_encode(frame.payload) + '\n';
  if (wire.size() > max_wire_bytes || frame.payload.size() > max_payload_bytes) return {};
  return wire;
}

IpcDecodeReceipt LocalIpcCodec::decode(const std::string& wire, const std::string& token) {
  IpcDecodeReceipt result;
  if (token.empty()) {
    result.error = "ipc token is required";
    return result;
  }
  if (wire.size() > max_wire_bytes) {
    result.error = "ipc frame exceeds wire limit";
    return result;
  }
  std::string line = wire;
  if (!line.empty() && line.back() == '\n') line.pop_back();
  if (!line.empty() && line.back() == '\r') line.pop_back();
  const auto fields = split_tab(line);
  if (fields.size() != 5 || fields[0] != "sidechannel.native-ipc/1") {
    result.error = "unsupported or malformed ipc frame";
    return result;
  }
  std::string frame_token;
  if (!hex_decode(fields[1], result.frame.request_id) || !hex_decode(fields[2], frame_token) ||
      !hex_decode(fields[3], result.frame.type) || !hex_decode(fields[4], result.frame.payload)) {
    result.error = "ipc frame contains invalid encoding";
    return result;
  }
  if (frame_token != token) {
    result.error = "ipc token mismatch";
    return result;
  }
  if (result.frame.request_id.empty() || result.frame.type.empty()) {
    result.error = "ipc frame requires request id and type";
    return result;
  }
  if (result.frame.payload.size() > max_payload_bytes) {
    result.error = "ipc payload exceeds limit";
    return result;
  }
  result.ok = true;
  return result;
}

SessionJournal::SessionJournal(std::filesystem::path file_path, std::string session_id)
  : file_path_(std::move(file_path)), session_id_(std::move(session_id)) {}

bool SessionJournal::open() {
  if (opened_) return true;
  entries_.clear();
  std::error_code error;
  const bool exists = std::filesystem::exists(file_path_, error);
  if (error) return false;
  if (!exists) {
    if (!file_path_.parent_path().empty()) {
      std::filesystem::create_directories(file_path_.parent_path(), error);
      if (error) return false;
    }
    std::ofstream output(file_path_, std::ios::binary | std::ios::trunc);
    if (!output) return false;
    output << "SIDECHANNEL_NATIVE_SESSION/1\t" << hex_encode(session_id_) << '\n';
    output.flush();
    if (!output) return false;
    opened_ = true;
    was_created_ = true;
    return true;
  }

  std::ifstream input(file_path_, std::ios::binary);
  if (!input) return false;
  std::string line;
  if (!std::getline(input, line)) return false;
  const auto header = split_tab(line);
  std::string header_session_id;
  if (header.size() != 2 || header[0] != "SIDECHANNEL_NATIVE_SESSION/1" ||
      !hex_decode(header[1], header_session_id) || header_session_id != session_id_) {
    return false;
  }
  while (std::getline(input, line)) {
    if (line.empty()) continue;
    const auto fields = split_tab(line);
    if (fields.empty()) return false;
    if (fields[0] == "O") continue;
    if (fields[0] != "E" || fields.size() != 7) return false;
    JournalEntry entry;
    if (!parse_u64(fields[1], entry.sequence) || !parse_i64(fields[2], entry.timestamp_ms) ||
        !hex_decode(fields[3], entry.type) || !hex_decode(fields[4], entry.payload)) {
      return false;
    }
    if (fields[5] == "-") entry.previous_digest.clear();
    else if (!hex_decode(fields[5], entry.previous_digest)) return false;
    entry.event_digest = fields[6];
    if (entry.event_digest.size() != 64) return false;
    entries_.push_back(std::move(entry));
  }
  if (!input.eof()) return false;
  opened_ = true;
  was_created_ = false;
  return true;
}

bool SessionJournal::was_created() const noexcept {
  return was_created_;
}

const std::vector<JournalEntry>& SessionJournal::entries() const noexcept {
  return entries_;
}

JournalEntry SessionJournal::append(std::string type, std::int64_t timestamp_ms, std::string payload) {
  if (!opened_) return {};
  JournalEntry entry;
  entry.sequence = entries_.size() + 1;
  entry.timestamp_ms = timestamp_ms;
  entry.type = std::move(type);
  entry.payload = std::move(payload);
  entry.previous_digest = entries_.empty() ? std::string{} : entries_.back().event_digest;
  entry.event_digest = journal_digest(session_id_, entry.sequence, entry.timestamp_ms, entry.type,
    entry.payload, entry.previous_digest);
  std::ofstream output(file_path_, std::ios::binary | std::ios::app);
  if (!output) return {};
  output << "E\t" << entry.sequence << '\t' << entry.timestamp_ms << '\t'
    << hex_encode(entry.type) << '\t' << hex_encode(entry.payload) << '\t'
    << (entry.previous_digest.empty() ? "-" : hex_encode(entry.previous_digest)) << '\t'
    << entry.event_digest << '\n';
  output.flush();
  if (!output) return {};
  entries_.push_back(entry);
  return entry;
}

JournalVerification SessionJournal::verify() const {
  JournalVerification result;
  result.event_count = entries_.size();
  if (!opened_) {
    result.error = "journal is not open";
    return result;
  }
  std::uint64_t expected_sequence = 1;
  std::string previous_digest;
  for (const auto& entry : entries_) {
    if (entry.sequence != expected_sequence) {
      result.error = "journal sequence is not contiguous";
      return result;
    }
    if (entry.previous_digest != previous_digest) {
      result.error = "journal previous digest mismatch";
      return result;
    }
    const auto expected_digest = journal_digest(session_id_, entry.sequence, entry.timestamp_ms,
      entry.type, entry.payload, entry.previous_digest);
    if (entry.event_digest != expected_digest) {
      result.error = "journal event digest mismatch";
      return result;
    }
    previous_digest = entry.event_digest;
    ++expected_sequence;
  }
  result.ok = true;
  return result;
}

NativeSessionStore::NativeSessionStore(std::filesystem::path file_path, std::string session_id)
  : file_path_(std::move(file_path)), session_id_(std::move(session_id)), journal_(file_path_, session_id_) {}

bool NativeSessionStore::load_observations() {
  observations_.clear();
  std::ifstream input(file_path_, std::ios::binary);
  if (!input) return false;
  std::string line;
  if (!std::getline(input, line)) return false;
  while (std::getline(input, line)) {
    if (line.empty() || line.rfind("O\t", 0) != 0) continue;
    const auto fields = split_tab(line);
    if (fields.size() != 9) return false;
    Observation observation;
    if (!parse_u64(fields[1], observation.sequence) || !parse_i64(fields[2], observation.timestamp_ms) ||
        !hex_decode(fields[3], observation.id) || !hex_decode(fields[4], observation.source_id) ||
        !hex_decode(fields[5], observation.channel) || !parse_double(fields[6], observation.value) ||
        !parse_double(fields[7], observation.quality_score) || !evidence_from_value(fields[8], observation.evidence_state)) {
      return false;
    }
    observation.schema = "sidechannel.observation/2";
    observations_.push_back(std::move(observation));
  }
  return input.eof();
}

bool NativeSessionStore::append_observation_record(const Observation& observation) {
  std::ofstream output(file_path_, std::ios::binary | std::ios::app);
  if (!output) return false;
  output << std::setprecision(17) << "O\t" << observation.sequence << '\t'
    << observation.timestamp_ms << '\t' << hex_encode(observation.id) << '\t'
    << hex_encode(observation.source_id) << '\t' << hex_encode(observation.channel) << '\t'
    << observation.value << '\t' << observation.quality_score << '\t'
    << evidence_value(observation.evidence_state) << '\n';
  output.flush();
  return static_cast<bool>(output);
}

bool NativeSessionStore::open() {
  if (state_ != "closed") return true;
  if (!journal_.open()) return false;
  if (!load_observations()) return false;
  if (!journal_.verify().ok) return false;
  if (journal_.entries().empty()) {
    if (!journal_.was_created()) return false;
    const auto opened = journal_.append("SessionOpened", 0,
      "{\"sessionId\":" + quote_json(session_id_) + '}');
    if (opened.sequence == 0) return false;
    state_ = "recording";
    return verify().ok;
  }
  const auto& last = journal_.entries().back();
  if (last.type == "SessionClosed") {
    state_ = "completed";
    return verify().ok;
  }
  if (last.type == "RuntimeRecovered") {
    state_ = "interrupted";
    return verify().ok;
  }
  const auto recovered = journal_.append("RuntimeRecovered", last.timestamp_ms,
    "{\"reason\":\"process_restart\"}");
  if (recovered.sequence == 0) return false;
  state_ = "interrupted";
  return verify().ok;
}

bool NativeSessionStore::append(Observation observation) {
  if (state_ != "recording") return false;
  observation.sequence = observations_.size() + 1;
  const auto admitted = journal_.append("ObservationAdmitted", observation.timestamp_ms,
    observation_payload(observation));
  if (admitted.sequence == 0 || !append_observation_record(observation)) return false;
  observations_.push_back(std::move(observation));
  return true;
}

bool NativeSessionStore::record_event(std::string type, std::int64_t timestamp_ms, std::string payload) {
  if (state_ != "recording") return false;
  const auto event = journal_.append(std::move(type), timestamp_ms, std::move(payload));
  return event.sequence != 0;
}

bool NativeSessionStore::close(std::int64_t ended_at_ms) {
  if (state_ != "recording") return false;
  const auto closed = journal_.append("SessionClosed", ended_at_ms,
    "{\"endedAtMs\":" + std::to_string(ended_at_ms) + '}');
  if (closed.sequence == 0) return false;
  state_ = "completed";
  return true;
}

const std::string& NativeSessionStore::state() const noexcept {
  return state_;
}

const std::vector<Observation>& NativeSessionStore::observations() const noexcept {
  return observations_;
}

const SessionJournal& NativeSessionStore::journal() const noexcept {
  return journal_;
}

JournalVerification NativeSessionStore::verify() const {
  auto result = journal_.verify();
  if (!result.ok) return result;
  std::size_t admitted_count = 0;
  for (const auto& entry : journal_.entries()) {
    if (entry.type != "ObservationAdmitted") continue;
    if (admitted_count >= observations_.size() || entry.payload != observation_payload(observations_[admitted_count])) {
      result.ok = false;
      result.error = "observation journal does not match retained records";
      return result;
    }
    ++admitted_count;
  }
  if (admitted_count != observations_.size()) {
    result.ok = false;
    result.error = "retained observation count does not match journal";
    return result;
  }
  result.ok = true;
  return result;
}

std::string NativeSessionStore::export_json() const {
  SessionArchive archive(session_id_);
  for (const auto& observation : observations_) archive.append(observation);
  archive.set_journal(journal_.entries());
  return archive.to_json();
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
