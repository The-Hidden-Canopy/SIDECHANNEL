#include "sidechannel/core.hpp"
#include "sidechannel/sqlite_store.hpp"

#include <cassert>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>

int main() {
  sidechannel::DeterministicSimulator first(1337);
  sidechannel::DeterministicSimulator second(1337);
  const auto first_tick = first.tick(0, 1000);
  const auto second_tick = second.tick(0, 1000);
  assert(first_tick.size() == 9);
  assert(first_tick.size() == second_tick.size());
  for (std::size_t index = 0; index < first_tick.size(); ++index) {
    assert(first_tick[index].schema == "sidechannel.observation/2");
    assert(first_tick[index].id == second_tick[index].id);
    assert(first_tick[index].channel == second_tick[index].channel);
    assert(first_tick[index].value == second_tick[index].value);
    assert(first_tick[index].evidence_state == sidechannel::EvidenceState::simulated);
  }

  sidechannel::AdmissionSequencer sequencer(2);
  assert(sequencer.enqueue(first_tick[0]));
  assert(sequencer.enqueue(first_tick[1]));
  assert(!sequencer.enqueue(first_tick[2]));
  assert(sequencer.pending() == 2);
  const auto admitted = sequencer.drain();
  assert(admitted.size() == 2);
  assert(admitted[0].id == first_tick[0].id);
  assert(admitted[1].id == first_tick[1].id);
  assert(sequencer.receipt().frames_received == 3);
  assert(sequencer.receipt().frames_admitted == 2);
  assert(sequencer.receipt().frames_dropped_backpressure == 1);
  assert(sequencer.receipt().max_depth == 2);
  assert(std::string(sidechannel::to_string(sidechannel::EvidenceState::simulated)) == "simulated");

  sidechannel::NativeAdapterSupervisor adapters(2);
  sidechannel::NativeAdapterManifest manifest{
    "sidechannel.adapter/1", "fixture-provider", "0.1.0", "fixture-digest",
    {"normalized_observation"}, {"fixture.read"}, 4096
  };
  std::string adapter_error;
  assert(adapters.register_provider(manifest, 10, adapter_error));
  assert(adapters.get("fixture-provider") != nullptr);
  assert(adapters.get("fixture-provider")->state == "VALIDATED");
  assert(!adapters.start("fixture-provider", 11, adapter_error));
  assert(adapters.get("fixture-provider")->state == "DISABLED");
  assert(adapters.grant_permissions("fixture-provider", {"fixture.read"}, 12, adapter_error));
  assert(adapters.start("fixture-provider", 13, adapter_error));
  assert(adapters.get("fixture-provider")->state == "RUNNING");
  assert(adapters.record_failure("fixture-provider", "malformed frame", 14, adapter_error));
  assert(adapters.get("fixture-provider")->state == "RUNNING");
  assert(adapters.record_failure("fixture-provider", "provider stopped", 15, adapter_error));
  assert(adapters.get("fixture-provider")->state == "QUARANTINED");
  assert(!adapters.start("fixture-provider", 16, adapter_error));
  assert(adapters.clear_quarantine("fixture-provider", 17, adapter_error));
  assert(adapters.get("fixture-provider")->state == "DISABLED");
  assert(adapters.start("fixture-provider", 18, adapter_error));
  assert(adapters.revoke_permissions("fixture-provider", {}, 19, adapter_error));
  assert(adapters.get("fixture-provider")->state == "DISABLED");
  assert(!adapters.register_provider(
    sidechannel::NativeAdapterManifest{"sidechannel.adapter/0", "bad", "0.1.0", "digest", {"x"}, {}, 4096},
    20, adapter_error
  ));
  assert(adapters.list().size() == 1);

  const sidechannel::IpcFrame ping{"request-1", "ping", ""};
  const auto ping_wire = sidechannel::LocalIpcCodec::encode(ping, "launch-token");
  const auto decoded_ping = sidechannel::LocalIpcCodec::decode(ping_wire, "launch-token");
  assert(decoded_ping.ok);
  const auto decoded_literal = sidechannel::LocalIpcCodec::decode(
    "sidechannel.native-ipc/1\t31\t6c61756e63682d746f6b656e\t70696e67\t\n", "launch-token");
  assert(decoded_literal.ok);
  assert(decoded_ping.frame.request_id == "request-1");
  assert(decoded_ping.frame.type == "ping");
  assert(sidechannel::LocalIpcCodec::encode(ping, "").empty());
  assert(!sidechannel::LocalIpcCodec::decode(ping_wire, "").ok);
  assert(!sidechannel::LocalIpcCodec::decode(ping_wire, "wrong-token").ok);
  assert(!sidechannel::LocalIpcCodec::decode("sidechannel.native-ipc/0\n", "launch-token").ok);
  const sidechannel::IpcFrame oversized{"request-2", "data", std::string(sidechannel::LocalIpcCodec::max_payload_bytes + 1, 'x')};
  assert(sidechannel::LocalIpcCodec::encode(oversized, "launch-token").empty());

  const auto native_view = sidechannel::create_native_scene_view(
    first_tick, 10000, sidechannel::SceneViewLimits{2, 9, 0, 0, 0}
  );
  assert(native_view.source_count == 9);
  assert(native_view.observation_count == 9);
  assert(native_view.source_projections.size() == 2);
  assert(native_view.observations.size() == 9);
  bool has_stale_projection = false;
  for (const auto& projection : native_view.source_projections) {
    if (projection.health == "stale") has_stale_projection = true;
  }
  assert(has_stale_projection);
  const auto bounded_native_view = sidechannel::create_native_scene_view(
    first_tick, 10000, sidechannel::SceneViewLimits{2, 2, 0, 0, 0}
  );
  assert(bounded_native_view.observations.size() == 2);
  const auto native_view_json = bounded_native_view.to_json();
  assert(native_view_json.find("\"format\":\"sidechannel.scene-view/1\"") != std::string::npos);
  assert(native_view_json.find("\"maxSources\":2") != std::string::npos);
  assert(native_view_json.find("\"boundedObservationCount\":2") != std::string::npos);

  sidechannel::SessionArchive archive("session_test");
  archive.append(first_tick[0]);
  archive.append(first_tick[1]);
  assert(archive.observations().size() == 2);
  assert(archive.observations()[0].sequence == 1);
  assert(archive.observations()[1].sequence == 2);
  const auto package = archive.to_json();
  assert(package.find("\"format\":\"sidechannel-session\"") != std::string::npos);
  assert(package.find("\"snapshotDigest\":\"") != std::string::npos);
  assert(package.find("\"packageDigest\":\"") != std::string::npos);
  assert(package.find("\"type\":\"SessionOpened\"") != std::string::npos);
  assert(package.find("\"type\":\"ObservationAdmitted\"") != std::string::npos);
  assert(package.find("\"type\":\"SessionClosed\"") != std::string::npos);
  assert(package.find("\"sequence\":1") != std::string::npos);

  const auto journal_path = std::filesystem::temp_directory_path() / "sidechannel-native-session-test.scj";
  std::error_code cleanup_error;
  std::filesystem::remove(journal_path, cleanup_error);
  {
    sidechannel::NativeSessionStore store(journal_path, "session_native_test");
    assert(store.open());
    assert(store.state() == "recording");
    assert(store.record_event("ProviderRegistered", 100,
      "{\"providerId\":\"fixture-provider\"}"));
    assert(store.append(first_tick[0]));
    assert(store.close(1250));
    assert(store.state() == "completed");
    assert(store.verify().ok);
  }
  {
    sidechannel::NativeSessionStore reopened(journal_path, "session_native_test");
    assert(reopened.open());
    assert(reopened.state() == "completed");
    assert(reopened.observations().size() == 1);
    assert(reopened.observations()[0].id == first_tick[0].id);
    assert(reopened.journal().entries().size() == 4);
    assert(reopened.journal().entries()[1].type == "ProviderRegistered");
    assert(reopened.verify().ok);
    const auto exported = reopened.export_json();
    assert(exported.find("\"packageDigest\":\"") != std::string::npos);
    assert(exported.find("\"type\":\"ProviderRegistered\"") != std::string::npos);
  }

  std::filesystem::remove(journal_path, cleanup_error);
  {
    sidechannel::NativeSessionStore interrupted(journal_path, "session_native_test");
    assert(interrupted.open());
    assert(interrupted.append(first_tick[1]));
  }
  {
    sidechannel::NativeSessionStore recovered(journal_path, "session_native_test");
    assert(recovered.open());
    assert(recovered.state() == "interrupted");
    assert(recovered.observations().size() == 1);
    assert(!recovered.append(first_tick[2]));
    assert(recovered.verify().ok);
  }

  std::ifstream journal_input(journal_path, std::ios::binary);
  const std::string journal_contents((std::istreambuf_iterator<char>(journal_input)), {});
  journal_input.close();
  const auto observation_event = journal_contents.find("4f62736572766174696f6e41646d6974746564");
  assert(observation_event != std::string::npos);
  std::string tampered_contents = journal_contents;
  tampered_contents[observation_event] = '5';
  std::ofstream journal_output(journal_path, std::ios::binary | std::ios::trunc);
  journal_output << tampered_contents;
  journal_output.close();
  sidechannel::NativeSessionStore tampered(journal_path, "session_native_test");
  assert(!tampered.open());

  std::filesystem::remove(journal_path, cleanup_error);
  {
    sidechannel::NativeSessionStore value_tamper_source(journal_path, "session_native_test");
    assert(value_tamper_source.open());
    assert(value_tamper_source.append(first_tick[2]));
    assert(value_tamper_source.close(1500));
  }
  std::ifstream value_input(journal_path, std::ios::binary);
  std::string value_contents((std::istreambuf_iterator<char>(value_input)), {});
  value_input.close();
  const auto observation_line = value_contents.find("O\t");
  assert(observation_line != std::string::npos);
  auto value_start = observation_line;
  for (int field = 0; field < 6; ++field) {
    value_start = value_contents.find('\t', value_start) + 1;
    assert(value_start != 0);
  }
  value_contents[value_start] = value_contents[value_start] == '0' ? '1' : '0';
  std::ofstream value_output(journal_path, std::ios::binary | std::ios::trunc);
  value_output << value_contents;
  value_output.close();
  sidechannel::NativeSessionStore value_tampered(journal_path, "session_native_test");
  assert(!value_tampered.open());
  std::filesystem::remove(journal_path, cleanup_error);

  const auto sqlite_path = std::filesystem::temp_directory_path() / "sidechannel-native-sqlite-test.db";
  std::filesystem::remove(sqlite_path, cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-wal", cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-shm", cleanup_error);
  {
    sidechannel::NativeSqliteSessionStore store(sqlite_path, "session_native_sqlite_test");
    assert(store.open());
    assert(store.state() == "recording");
    assert(store.record_event("ProviderRegistered", 100,
      "{\"providerId\":\"fixture-provider\"}"));
    assert(store.append(first_tick[0]));
    assert(!store.append(first_tick[0]));
    assert(store.observations().size() == 1);
    assert(store.verify().ok);
    assert(store.close(1250));
    assert(store.state() == "completed");
    assert(store.verify().ok);
    assert(store.export_json().find("\"type\":\"ProviderRegistered\"") != std::string::npos);
  }
  {
    sidechannel::NativeSqliteSessionStore reopened(sqlite_path, "session_native_sqlite_test");
    assert(reopened.open());
    assert(reopened.state() == "completed");
    assert(reopened.observations().size() == 1);
    assert(reopened.journal().size() == 4);
    assert(reopened.verify().ok);
  }
  std::filesystem::remove(sqlite_path, cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-wal", cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-shm", cleanup_error);
  {
    sidechannel::NativeSqliteSessionStore interrupted(sqlite_path, "session_native_sqlite_test");
    assert(interrupted.open());
    assert(interrupted.append(first_tick[1]));
  }
  {
    sidechannel::NativeSqliteSessionStore recovered(sqlite_path, "session_native_sqlite_test");
    assert(recovered.open());
    assert(recovered.state() == "interrupted");
    assert(recovered.observations().size() == 1);
    assert(recovered.verify().ok);
    assert(!recovered.append(first_tick[2]));
  }
  std::filesystem::remove(sqlite_path, cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-wal", cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-shm", cleanup_error);
  return 0;
}
