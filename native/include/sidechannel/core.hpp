#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <vector>

namespace sidechannel {

enum class EvidenceState {
  measured,
  simulated,
  derived,
  imported,
  stale,
  rejected,
  unknown
};

struct Observation {
  std::string schema;
  std::string id;
  std::string source_id;
  std::string channel;
  std::int64_t timestamp_ms = 0;
  double value = 0.0;
  double quality_score = 0.0;
  std::uint64_t sequence = 0;
  EvidenceState evidence_state = EvidenceState::unknown;
};

struct IngressReceipt {
  std::size_t frames_received = 0;
  std::size_t frames_admitted = 0;
  std::size_t frames_rejected = 0;
  std::size_t frames_dropped_backpressure = 0;
  std::size_t max_depth = 0;
  std::size_t pending = 0;
};

class AdmissionSequencer {
public:
  explicit AdmissionSequencer(std::size_t max_queue = 256);

  bool enqueue(Observation observation);
  std::vector<Observation> drain();
  [[nodiscard]] std::size_t pending() const noexcept;
  [[nodiscard]] const IngressReceipt& receipt() const noexcept;

private:
  std::size_t max_queue_;
  std::deque<Observation> queue_;
  IngressReceipt receipt_;
};

class DeterministicSimulator {
public:
  explicit DeterministicSimulator(std::uint32_t seed = 1337);

  std::vector<Observation> tick(std::uint64_t tick, std::int64_t timestamp_ms);

private:
  std::uint32_t random_state_;
  double random();
};

const char* to_string(EvidenceState state) noexcept;

} // namespace sidechannel
