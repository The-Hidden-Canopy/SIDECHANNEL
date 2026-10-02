#include "sidechannel/core.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <limits>

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
