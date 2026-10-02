#include "sidechannel/core.hpp"

#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <string>

namespace {

void write_json_string(const std::string& value) {
  std::cout << '"';
  for (const char character : value) {
    if (character == '\\' || character == '"') std::cout << '\\' << character;
    else if (character == '\n') std::cout << "\\n";
    else if (character == '\r') std::cout << "\\r";
    else if (character == '\t') std::cout << "\\t";
    else std::cout << character;
  }
  std::cout << '"';
}

} // namespace

int main(int argc, char** argv) {
  std::size_t ticks = 1;
  bool csv = false;
  bool json = false;
  bool session_json = false;
  std::string session_file;
  for (int index = 1; index < argc; ++index) {
    if (std::string(argv[index]) == "--ticks" && index + 1 < argc) {
      ticks = static_cast<std::size_t>(std::strtoul(argv[++index], nullptr, 10));
    } else if (std::string(argv[index]) == "--csv") {
      csv = true;
    } else if (std::string(argv[index]) == "--json") {
      json = true;
    } else if (std::string(argv[index]) == "--session-json") {
      session_json = true;
    } else if (std::string(argv[index]) == "--session-file" && index + 1 < argc) {
      session_file = argv[++index];
    } else {
      std::cerr << "usage: sidechannel-native [--ticks N] [--csv|--json|--session-json|--session-file PATH]\n";
      return 2;
    }
  }
  if (static_cast<int>(csv) + static_cast<int>(json) + static_cast<int>(session_json) +
      static_cast<int>(!session_file.empty()) > 1) {
    std::cerr << "choose one output format\n";
    return 2;
  }
  if (ticks == 0 || ticks > 10000) {
    std::cerr << "ticks must be between 1 and 10000\n";
    return 2;
  }

  sidechannel::DeterministicSimulator simulator;
  sidechannel::AdmissionSequencer sequencer(512);
  for (std::size_t tick = 0; tick < ticks; ++tick) {
    for (auto& observation : simulator.tick(tick, static_cast<std::int64_t>(tick) * 250)) {
      sequencer.enqueue(std::move(observation));
    }
  }
  const auto observations = sequencer.drain();
  const auto& receipt = sequencer.receipt();
  if (!session_file.empty()) {
    sidechannel::NativeSessionStore store(session_file, "session_native_cli");
    if (!store.open()) {
      std::cerr << "could not open native session file\n";
      return 1;
    }
    bool persisted = false;
    if (store.state() == "recording") {
      for (const auto& observation : observations) {
        if (!store.append(observation)) {
          std::cerr << "could not append native session observation\n";
          return 1;
        }
      }
      const auto ended_at_ms = observations.empty() ? std::int64_t{0} : observations.back().timestamp_ms;
      if (!store.close(ended_at_ms)) {
        std::cerr << "could not close native session\n";
        return 1;
      }
      persisted = true;
    }
    const auto verification = store.verify();
    if (!verification.ok) {
      std::cerr << "native session verification failed: " << verification.error << '\n';
      return 1;
    }
    std::cout << "{\"format\":\"sidechannel-native-session-receipt/1\",\"state\":";
    write_json_string(store.state());
    std::cout << ",\"persisted\":" << (persisted ? "true" : "false")
      << ",\"observations\":" << store.observations().size()
      << ",\"journalEvents\":" << store.journal().entries().size()
      << ",\"verified\":true}\n";
    return 0;
  }
  if (session_json) {
    sidechannel::SessionArchive archive("session_native_reference");
    for (const auto& observation : observations) archive.append(observation);
    std::cout << archive.to_json() << '\n';
    return 0;
  }
  if (csv) {
    std::cout << "schema,id,source_id,channel,timestamp_ms,value,quality_score,evidence_state\n";
    std::cout << std::fixed << std::setprecision(4);
    for (const auto& observation : observations) {
      std::cout << observation.schema << ',' << observation.id << ',' << observation.source_id << ',' << observation.channel << ','
        << observation.timestamp_ms << ',' << observation.value << ',' << observation.quality_score << ','
        << sidechannel::to_string(observation.evidence_state) << '\n';
    }
    return 0;
  }
  if (json) {
    std::cout << std::fixed << std::setprecision(4);
    std::cout << "{\"format\":\"sidechannel-native-observation-fixture\",\"formatVersion\":\"0.1\","
      << "\"evidenceLevel\":\"E2\",\"tier\":\"simulator-reference\",\"schema\":\"sidechannel.observation/2\","
      << "\"ticks\":" << ticks << ",\"observations\":[";
    for (std::size_t index = 0; index < observations.size(); ++index) {
      const auto& observation = observations[index];
      if (index > 0) std::cout << ',';
      std::cout << "{\"schema\":";
      write_json_string(observation.schema);
      std::cout << ",\"id\":";
      write_json_string(observation.id);
      std::cout << ",\"sourceId\":";
      write_json_string(observation.source_id);
      std::cout << ",\"channel\":";
      write_json_string(observation.channel);
      std::cout << ",\"timestampMs\":" << observation.timestamp_ms
        << ",\"value\":" << observation.value
        << ",\"qualityScore\":" << observation.quality_score
        << ",\"evidenceState\":";
      write_json_string(sidechannel::to_string(observation.evidence_state));
      std::cout << '}';
    }
    std::cout << "],\"ingress\":{\"framesReceived\":" << receipt.frames_received
      << ",\"framesAdmitted\":" << receipt.frames_admitted
      << ",\"framesRejected\":" << receipt.frames_rejected
      << ",\"framesDroppedBackpressure\":" << receipt.frames_dropped_backpressure
      << ",\"maxDepth\":" << receipt.max_depth
      << ",\"pending\":" << receipt.pending << "}}\n";
    return 0;
  }
  std::cout << "protocol=sidechannel.native-reference/0.1\n";
  std::cout << "observations=" << observations.size() << "\n";
  std::cout << "frames_received=" << receipt.frames_received << "\n";
  std::cout << "frames_admitted=" << receipt.frames_admitted << "\n";
  std::cout << "frames_dropped_backpressure=" << receipt.frames_dropped_backpressure << "\n";
  return 0;
}
