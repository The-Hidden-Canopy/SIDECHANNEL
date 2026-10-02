#include "sidechannel/c_api.h"

#include <cassert>
#include <filesystem>
#include <string>

int main() {
  const auto path = std::filesystem::temp_directory_path() / "sidechannel-c-api-test.scj";
  std::error_code cleanup_error;
  std::filesystem::remove(path, cleanup_error);

  char error[256]{};
  sidechannel_session* session = nullptr;
  assert(sidechannel_session_open(path.string().c_str(), "c_api_session", &session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(session != nullptr);

  char state[32]{};
  assert(sidechannel_session_state(session, state, sizeof(state)) == SIDECHANNEL_C_OK);
  assert(std::string(state) == "recording");

  const sidechannel_observation observation{
    "c_api_observation",
    "c_api_source",
    "heat",
    1000,
    23.5,
    0.91,
    1
  };
  assert(sidechannel_session_append(session, &observation, error, sizeof(error)) == SIDECHANNEL_C_OK);
  char scene[8192]{};
  assert(sidechannel_session_scene_view(session, 1000, 2, 2, scene, sizeof(scene)) == SIDECHANNEL_C_OK);
  assert(std::string(scene).find("\"format\":\"sidechannel.scene-view/1\"") != std::string::npos);
  assert(std::string(scene).find("\"maxSources\":2") != std::string::npos);
  assert(sidechannel_session_scene_view(session, 1000, 0, 2, scene, sizeof(scene)) == SIDECHANNEL_C_INVALID_ARGUMENT);
  assert(sidechannel_session_scene_view(session, 1000, 2, 2, scene, 4) == SIDECHANNEL_C_BUFFER_TOO_SMALL);
  const sidechannel_observation invalid_observation{
    "invalid", "c_api_source", "heat", 1100, 23.5, 2.0, 1
  };
  assert(sidechannel_session_append(session, &invalid_observation, error, sizeof(error)) == SIDECHANNEL_C_INVALID_ARGUMENT);
  char package[16384]{};
  assert(sidechannel_session_export(session, package, sizeof(package), error, sizeof(error)) == SIDECHANNEL_C_IO_ERROR);
  assert(sidechannel_session_close(session, 1250, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_verify(session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_export(session, package, sizeof(package), error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(std::string(package).find("\"format\":\"sidechannel-session\"") != std::string::npos);
  assert(std::string(package).find("\"packageDigest\":\"") != std::string::npos);
  assert(sidechannel_session_export(session, package, 4, error, sizeof(error)) == SIDECHANNEL_C_BUFFER_TOO_SMALL);
  sidechannel_session_destroy(session);

  session = nullptr;
  assert(sidechannel_session_open(path.string().c_str(), "c_api_session", &session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_state(session, state, sizeof(state)) == SIDECHANNEL_C_OK);
  assert(std::string(state) == "completed");
  assert(sidechannel_session_verify(session, error, sizeof(error)) == SIDECHANNEL_C_OK);

  char wire[512]{};
  assert(sidechannel_ipc_encode("token", "request", "ping", "", wire, sizeof(wire)) == SIDECHANNEL_C_OK);
  assert(std::string(wire).find("sidechannel.native-ipc/1\t") == 0);
  assert(sidechannel_ipc_encode("token", "request", "ping", "", wire, 4) == SIDECHANNEL_C_BUFFER_TOO_SMALL);

  sidechannel_session_destroy(session);
  std::filesystem::remove(path, cleanup_error);

  const auto sqlite_path = std::filesystem::temp_directory_path() / "sidechannel-c-api-test.db";
  std::filesystem::remove(sqlite_path, cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-wal", cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-shm", cleanup_error);
  session = nullptr;
  assert(sidechannel_session_open_sqlite(sqlite_path.string().c_str(), "c_api_sqlite_session", &session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(session != nullptr);
  assert(sidechannel_session_append(session, &observation, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_scene_view(session, 1000, 2, 2, scene, sizeof(scene)) == SIDECHANNEL_C_OK);
  assert(std::string(scene).find("\"boundedObservationCount\":1") != std::string::npos);
  assert(sidechannel_session_close(session, 1250, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_verify(session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_export(session, package, sizeof(package), error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(std::string(package).find("\"packageDigest\":\"") != std::string::npos);
  sidechannel_session_destroy(session);

  session = nullptr;
  assert(sidechannel_session_open_sqlite(sqlite_path.string().c_str(), "c_api_sqlite_session", &session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  assert(sidechannel_session_state(session, state, sizeof(state)) == SIDECHANNEL_C_OK);
  assert(std::string(state) == "completed");
  assert(sidechannel_session_verify(session, error, sizeof(error)) == SIDECHANNEL_C_OK);
  sidechannel_session_destroy(session);
  std::filesystem::remove(sqlite_path, cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-wal", cleanup_error);
  std::filesystem::remove(sqlite_path.string() + "-shm", cleanup_error);
  return 0;
}
