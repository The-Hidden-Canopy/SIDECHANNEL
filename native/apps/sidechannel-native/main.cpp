#include "sidechannel/core.hpp"

#include <chrono>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

namespace {

std::string quote_json(const std::string& value) {
  std::string quoted = "\"";
  for (const char character : value) {
    if (character == '\\' || character == '"') quoted += '\\';
    if (character == '\n') quoted += "\\n";
    else if (character == '\r') quoted += "\\r";
    else if (character == '\t') quoted += "\\t";
    else quoted += character;
  }
  quoted += '"';
  return quoted;
}

void write_json_string(const std::string& value) {
  std::cout << quote_json(value);
}

std::vector<std::string> split_pipe(const std::string& value) {
  std::vector<std::string> fields;
  std::size_t start = 0;
  while (start <= value.size()) {
    const auto end = value.find('|', start);
    if (end == std::string::npos) {
      fields.push_back(value.substr(start));
      break;
    }
    fields.push_back(value.substr(start, end - start));
    start = end + 1;
  }
  return fields;
}

std::vector<std::string> split_csv(const std::string& value) {
  if (value.empty()) return {};
  std::vector<std::string> fields;
  std::size_t start = 0;
  while (start <= value.size()) {
    const auto end = value.find(',', start);
    const auto field = value.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (!field.empty()) fields.push_back(field);
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return fields;
}

std::string string_array_json(const std::vector<std::string>& values) {
  std::ostringstream output;
  output << '[';
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index > 0) output << ',';
    output << quote_json(values[index]);
  }
  output << ']';
  return output.str();
}

std::string adapter_record_json(const sidechannel::NativeAdapterRecord& record) {
  std::ostringstream output;
  output << "{\"providerId\":" << quote_json(record.manifest.provider_id)
    << ",\"providerVersion\":" << quote_json(record.manifest.provider_version)
    << ",\"providerDigest\":" << quote_json(record.manifest.provider_digest)
    << ",\"protocolVersion\":" << quote_json(record.manifest.protocol_version)
    << ",\"capabilities\":" << string_array_json(record.manifest.capabilities)
    << ",\"requiredPermissions\":" << string_array_json(record.manifest.required_permissions)
    << ",\"grantedPermissions\":" << string_array_json(record.granted_permissions)
    << ",\"maximumFrameBytes\":" << record.manifest.maximum_frame_bytes
    << ",\"state\":" << quote_json(record.state)
    << ",\"failureCount\":" << record.failure_count
    << ",\"lastFailure\":";
  if (record.last_failure.empty()) output << "null";
  else output << quote_json(record.last_failure);
  output << ",\"lastTransitionAtMs\":" << record.last_transition_at_ms << '}';
  return output.str();
}

bool parse_observation_payload(const std::string& payload, sidechannel::Observation& observation) {
  const auto fields = split_pipe(payload);
  if (fields.size() != 7 || fields[0].empty() || fields[1].empty() || fields[2].empty()) return false;
  try {
    std::size_t consumed = 0;
    const auto timestamp_ms = std::stoll(fields[3], &consumed, 10);
    if (consumed != fields[3].size()) return false;
    consumed = 0;
    const auto value = std::stod(fields[4], &consumed);
    if (consumed != fields[4].size() || !std::isfinite(value)) return false;
    consumed = 0;
    const auto quality_score = std::stod(fields[5], &consumed);
    if (consumed != fields[5].size() || !std::isfinite(quality_score) || quality_score < 0.0 || quality_score > 1.0) return false;
    consumed = 0;
    const auto evidence_value = std::stoul(fields[6], &consumed, 10);
    if (consumed != fields[6].size() || evidence_value > 6) return false;
    observation = sidechannel::Observation{
      "sidechannel.observation/2",
      fields[0], fields[1], fields[2], timestamp_ms, value, quality_score, 0,
      static_cast<sidechannel::EvidenceState>(evidence_value)
    };
    return true;
  } catch (...) {
    return false;
  }
}

std::int64_t now_ms() {
  const auto now = std::chrono::system_clock::now().time_since_epoch();
  return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
}

int run_ipc_stdio(const std::string& token, const std::string& session_file) {
  std::unique_ptr<sidechannel::NativeSessionStore> session;
  sidechannel::NativeAdapterSupervisor adapters;
  if (!session_file.empty()) {
    session = std::make_unique<sidechannel::NativeSessionStore>(session_file, "session_native_cli");
    if (!session->open()) {
      std::cerr << "could not open native IPC session file\n";
      return 1;
    }
  }

  std::string line;
  while (std::getline(std::cin, line)) {
    const auto decoded = sidechannel::LocalIpcCodec::decode(line, token);
    if (!decoded.ok) {
      std::cerr << "native ipc rejected frame: " << decoded.error << '\n';
      return 1;
    }
    sidechannel::IpcFrame response{
      decoded.frame.request_id,
      "error",
      "{\"error\":\"unsupported command\"}"
    };
    if (decoded.frame.type == "ping") {
      response.type = "pong";
      response.payload = "{\"protocol\":\"sidechannel.native-ipc/1\"}";
    } else if (decoded.frame.type == "status") {
      response.type = "status";
      response.payload = "{\"authority\":\"native-reference\",\"state\":\"ready\",\"hardware\":\"excluded\"";
      if (session) response.payload += ",\"sessionState\":" + quote_json(session->state());
      response.payload += '}';
    } else if (decoded.frame.type == "session.status") {
      if (!session) response.payload = "{\"error\":\"session file is required\"}";
      else {
        response.type = "session.status";
        response.payload = "{\"state\":" + quote_json(session->state()) +
          ",\"observations\":" + std::to_string(session->observations().size()) +
          ",\"journalEvents\":" + std::to_string(session->journal().entries().size()) + '}';
      }
    } else if (decoded.frame.type == "session.observe") {
      sidechannel::Observation observation;
      if (!session) response.payload = "{\"error\":\"session file is required\"}";
      else if (!parse_observation_payload(decoded.frame.payload, observation)) {
        response.payload = "{\"error\":\"invalid observation payload\"}";
      } else if (!session->append(std::move(observation))) {
        response.payload = "{\"error\":\"session rejected observation\"}";
      } else {
        response.type = "observation.accepted";
        response.payload = "{\"observations\":" + std::to_string(session->observations().size()) +
          ",\"journalEvents\":" + std::to_string(session->journal().entries().size()) + '}';
      }
    } else if (decoded.frame.type == "session.verify") {
      if (!session) response.payload = "{\"error\":\"session file is required\"}";
      else {
        const auto verification = session->verify();
        if (!verification.ok) response.payload = "{\"error\":" + quote_json(verification.error) + '}';
        else {
          response.type = "session.verified";
          response.payload = "{\"verified\":true,\"journalEvents\":" +
            std::to_string(session->journal().entries().size()) + '}';
        }
      }
    } else if (decoded.frame.type == "session.close") {
      if (!session) response.payload = "{\"error\":\"session file is required\"}";
      else if (!session->close(now_ms())) response.payload = "{\"error\":\"session close rejected\"}";
      else {
        response.type = "session.closed";
        response.payload = "{\"state\":" + quote_json(session->state()) + '}';
      }
    } else if (decoded.frame.type == "adapter.register") {
      const auto fields = split_pipe(decoded.frame.payload);
      sidechannel::NativeAdapterManifest manifest;
      bool valid = fields.size() == 6;
      if (valid) {
        manifest.protocol_version = "sidechannel.adapter/1";
        manifest.provider_id = fields[0];
        manifest.provider_version = fields[1];
        manifest.provider_digest = fields[2];
        manifest.capabilities = split_csv(fields[3]);
        manifest.required_permissions = split_csv(fields[4]);
        try {
          std::size_t consumed = 0;
          manifest.maximum_frame_bytes = std::stoul(fields[5], &consumed, 10);
          valid = consumed == fields[5].size();
        } catch (...) {
          valid = false;
        }
      }
      std::string adapter_error;
      if (!valid || !adapters.register_provider(std::move(manifest), now_ms(), adapter_error)) {
        response.payload = "{\"error\":" + quote_json(valid ? adapter_error : "invalid adapter manifest payload") + '}';
      } else {
        response.type = "adapter.updated";
        response.payload = "{\"adapter\":" + adapter_record_json(*adapters.get(fields[0])) + '}';
      }
    } else if (decoded.frame.type == "adapter.grant" || decoded.frame.type == "adapter.revoke") {
      const auto fields = split_pipe(decoded.frame.payload);
      std::string adapter_error;
      bool ok = fields.size() == 1 || fields.size() == 2;
      if (ok) {
        const auto permissions = fields.size() == 2 ? split_csv(fields[1]) : std::vector<std::string>{};
        if (decoded.frame.type == "adapter.grant") {
          ok = adapters.grant_permissions(fields[0], permissions, now_ms(), adapter_error);
        } else {
          ok = adapters.revoke_permissions(fields[0], permissions, now_ms(), adapter_error);
        }
      } else {
        adapter_error = "invalid adapter permission payload";
      }
      if (!ok) response.payload = "{\"error\":" + quote_json(adapter_error) + '}';
      else {
        response.type = "adapter.updated";
        response.payload = "{\"adapter\":" + adapter_record_json(*adapters.get(fields[0])) + '}';
      }
    } else if (decoded.frame.type == "adapter.start" || decoded.frame.type == "adapter.stop" ||
        decoded.frame.type == "adapter.clear") {
      const auto fields = split_pipe(decoded.frame.payload);
      std::string adapter_error;
      bool ok = fields.size() == 1;
      if (ok) {
        if (decoded.frame.type == "adapter.start") ok = adapters.start(fields[0], now_ms(), adapter_error);
        else if (decoded.frame.type == "adapter.stop") ok = adapters.stop(fields[0], now_ms(), adapter_error);
        else ok = adapters.clear_quarantine(fields[0], now_ms(), adapter_error);
      } else {
        adapter_error = "invalid adapter provider payload";
      }
      if (!ok) response.payload = "{\"error\":" + quote_json(adapter_error) + '}';
      else {
        response.type = "adapter.updated";
        response.payload = "{\"adapter\":" + adapter_record_json(*adapters.get(fields[0])) + '}';
      }
    } else if (decoded.frame.type == "adapter.fail") {
      const auto fields = split_pipe(decoded.frame.payload);
      std::string adapter_error;
      const bool ok = fields.size() == 2 && adapters.record_failure(fields[0], fields[1], now_ms(), adapter_error);
      if (!ok) response.payload = "{\"error\":" + quote_json(adapter_error.empty() ? "invalid adapter failure payload" : adapter_error) + '}';
      else {
        response.type = "adapter.updated";
        response.payload = "{\"adapter\":" + adapter_record_json(*adapters.get(fields[0])) + '}';
      }
    } else if (decoded.frame.type == "adapter.list") {
      if (!decoded.frame.payload.empty()) response.payload = "{\"error\":\"adapter.list does not accept a payload\"}";
      else {
        response.type = "adapter.list";
        const auto records = adapters.list();
        std::ostringstream payload;
        payload << "{\"adapters\":[";
        for (std::size_t index = 0; index < records.size(); ++index) {
          if (index > 0) payload << ',';
          payload << adapter_record_json(records[index]);
        }
        payload << "]}";
        response.payload = payload.str();
      }
    } else if (decoded.frame.type == "shutdown") {
      response.type = "stopped";
      response.payload = "{\"reason\":\"requested\"}";
    }
    const auto wire = sidechannel::LocalIpcCodec::encode(response, token);
    if (wire.empty()) {
      std::cerr << "native ipc response exceeded bounds\n";
      return 1;
    }
    std::cout << wire << std::flush;
    if (decoded.frame.type == "shutdown") return 0;
  }
  return 0;
}

} // namespace

int main(int argc, char** argv) {
  std::size_t ticks = 1;
  bool csv = false;
  bool json = false;
  bool session_json = false;
  std::string session_file;
  std::string export_file;
  std::string ipc_token;
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
    } else if (std::string(argv[index]) == "--export-json" && index + 1 < argc) {
      export_file = argv[++index];
    } else if (std::string(argv[index]) == "--ipc-stdio" && index + 1 < argc) {
      ipc_token = argv[++index];
    } else {
      std::cerr << "usage: sidechannel-native [--ticks N] [--csv|--json|--session-json|--session-file PATH [--export-json PATH]|--ipc-stdio TOKEN [--session-file PATH]]\n";
      return 2;
    }
  }
  if (!ipc_token.empty()) {
    if (csv || json || session_json || !export_file.empty()) {
      std::cerr << "ipc mode cannot be combined with a fixture output format\n";
      return 2;
    }
  } else if (!export_file.empty()) {
    if (session_file.empty() || csv || json || session_json) {
      std::cerr << "--export-json requires --session-file and cannot be combined with another output format\n";
      return 2;
    }
  } else if (static_cast<int>(csv) + static_cast<int>(json) + static_cast<int>(session_json) +
      static_cast<int>(!session_file.empty()) > 1) {
      std::cerr << "choose one output format\n";
      return 2;
  }
  if (ticks == 0 || ticks > 10000) {
    std::cerr << "ticks must be between 1 and 10000\n";
    return 2;
  }
  if (!ipc_token.empty()) return run_ipc_stdio(ipc_token, session_file);

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
    bool exported = false;
    if (!export_file.empty()) {
      if (store.state() != "completed") {
        std::cerr << "native session export requires a completed session\n";
        return 1;
      }
      std::ofstream export_output(export_file, std::ios::binary | std::ios::trunc);
      if (!export_output) {
        std::cerr << "could not open native session export path\n";
        return 1;
      }
      export_output << store.export_json() << '\n';
      export_output.flush();
      if (!export_output) {
        std::cerr << "could not write native session export\n";
        return 1;
      }
      exported = true;
    }
    std::cout << "{\"format\":\"sidechannel-native-session-receipt/1\",\"state\":";
    write_json_string(store.state());
    std::cout << ",\"persisted\":" << (persisted ? "true" : "false")
      << ",\"observations\":" << store.observations().size()
      << ",\"journalEvents\":" << store.journal().entries().size()
      << ",\"exported\":" << (exported ? "true" : "false")
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
