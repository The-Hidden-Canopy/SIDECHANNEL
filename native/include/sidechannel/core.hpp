#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <filesystem>
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

class SessionArchive {
public:
  explicit SessionArchive(std::string session_id = "session_native_reference");

  void append(Observation observation);
  [[nodiscard]] const std::vector<Observation>& observations() const noexcept;
  [[nodiscard]] std::string to_json() const;

private:
  std::string session_id_;
  std::vector<Observation> observations_;
};

struct JournalEntry {
  std::uint64_t sequence = 0;
  std::int64_t timestamp_ms = 0;
  std::string type;
  std::string payload;
  std::string previous_digest;
  std::string event_digest;
};

struct JournalVerification {
  bool ok = false;
  std::size_t event_count = 0;
  std::string error;
};

struct IpcFrame {
  std::string request_id;
  std::string type;
  std::string payload;
};

struct IpcDecodeReceipt {
  bool ok = false;
  IpcFrame frame;
  std::string error;
};

struct SceneViewLimits {
  std::size_t max_sources = 256;
  std::size_t max_observations = 512;
  std::size_t max_events = 0;
  std::size_t max_diagnostics = 0;
  std::size_t max_adapters = 0;
};

struct NativeSourceProjection {
  std::string id;
  std::string channel;
  std::string observation_id;
  std::int64_t observation_timestamp_ms = 0;
  std::string observation_status;
  std::string health;
};

struct NativeSceneView {
  std::int64_t generated_at_ms = 0;
  std::size_t source_count = 0;
  std::size_t observation_count = 0;
  std::vector<NativeSourceProjection> source_projections;
  std::vector<Observation> observations;
  SceneViewLimits limits;

  [[nodiscard]] std::string to_json() const;
};

[[nodiscard]] NativeSceneView create_native_scene_view(
  const std::vector<Observation>& observations,
  std::int64_t now_ms,
  SceneViewLimits limits = {}
);

class LocalIpcCodec {
public:
  static constexpr std::size_t max_wire_bytes = 64 * 1024;
  static constexpr std::size_t max_payload_bytes = 48 * 1024;

  [[nodiscard]] static std::string encode(const IpcFrame& frame, const std::string& token);
  [[nodiscard]] static IpcDecodeReceipt decode(const std::string& wire, const std::string& token);
};

class SessionJournal {
public:
  SessionJournal(std::filesystem::path file_path, std::string session_id);

  bool open();
  [[nodiscard]] bool was_created() const noexcept;
  [[nodiscard]] const std::vector<JournalEntry>& entries() const noexcept;
  JournalEntry append(std::string type, std::int64_t timestamp_ms, std::string payload);
  [[nodiscard]] JournalVerification verify() const;

private:
  std::filesystem::path file_path_;
  std::string session_id_;
  std::vector<JournalEntry> entries_;
  bool opened_ = false;
  bool was_created_ = false;
};

class NativeSessionStore {
public:
  NativeSessionStore(std::filesystem::path file_path, std::string session_id);

  bool open();
  bool append(Observation observation);
  bool close(std::int64_t ended_at_ms);
  [[nodiscard]] const std::string& state() const noexcept;
  [[nodiscard]] const std::vector<Observation>& observations() const noexcept;
  [[nodiscard]] const SessionJournal& journal() const noexcept;
  [[nodiscard]] JournalVerification verify() const;
  [[nodiscard]] std::string export_json() const;

private:
  bool load_observations();
  bool append_observation_record(const Observation& observation);

  std::filesystem::path file_path_;
  std::string session_id_;
  SessionJournal journal_;
  std::vector<Observation> observations_;
  std::string state_ = "closed";
};

const char* to_string(EvidenceState state) noexcept;

} // namespace sidechannel
