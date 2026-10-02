#include "sidechannel/c_api.h"

#include "sidechannel/core.hpp"
#include "sidechannel/sqlite_store.hpp"

#include <cmath>
#include <cstring>
#include <exception>
#include <memory>
#include <new>
#include <string>
#include <utility>

struct sidechannel_session {
  std::unique_ptr<sidechannel::NativeSessionStore> file_store;
  std::unique_ptr<sidechannel::NativeSqliteSessionStore> sqlite_store;

  sidechannel_session(const char* file_path, const char* session_id, bool sqlite) {
    if (sqlite) sqlite_store = std::make_unique<sidechannel::NativeSqliteSessionStore>(file_path, session_id);
    else file_store = std::make_unique<sidechannel::NativeSessionStore>(file_path, session_id);
  }

  bool open() {
    return sqlite_store ? sqlite_store->open() : file_store->open();
  }

  bool append(sidechannel::Observation observation) {
    return sqlite_store ? sqlite_store->append(std::move(observation)) : file_store->append(std::move(observation));
  }

  bool close(int64_t ended_at_ms) {
    return sqlite_store ? sqlite_store->close(ended_at_ms) : file_store->close(ended_at_ms);
  }

  const std::string& state() const {
    return sqlite_store ? sqlite_store->state() : file_store->state();
  }

  const std::vector<sidechannel::Observation>& observations() const {
    return sqlite_store ? sqlite_store->observations() : file_store->observations();
  }

  sidechannel::JournalVerification verify() const {
    return sqlite_store ? sqlite_store->verify() : file_store->verify();
  }
};

namespace {

int copy_text(const std::string& value, char* output, size_t capacity) {
  if (!output || capacity == 0) return SIDECHANNEL_C_INVALID_ARGUMENT;
  if (value.size() + 1 > capacity) {
    output[0] = '\0';
    return SIDECHANNEL_C_BUFFER_TOO_SMALL;
  }
  std::memcpy(output, value.c_str(), value.size() + 1);
  return SIDECHANNEL_C_OK;
}

int fail(int code, const char* message, char* error_out, size_t error_capacity) {
  if (error_out && error_capacity > 0) {
    const std::string text = message ? message : "native C API failure";
    if (text.size() + 1 <= error_capacity) std::memcpy(error_out, text.c_str(), text.size() + 1);
    else error_out[0] = '\0';
  }
  return code;
}

bool evidence_state_from_value(int32_t value, sidechannel::EvidenceState& state) {
  if (value < 0 || value > 6) return false;
  state = static_cast<sidechannel::EvidenceState>(value);
  return true;
}

bool bounded_text(const char* value, size_t maximum = 256) {
  if (!value || !*value) return false;
  for (size_t index = 1; index <= maximum; ++index) {
    if (value[index] == '\0') return true;
  }
  return false;
}

} // namespace

int open_session(
  const char* file_path,
  const char* session_id,
  sidechannel_session** out_session,
  char* error_out,
  size_t error_capacity,
  bool sqlite
) {
  if (!bounded_text(file_path, 1024) || !bounded_text(session_id) || !out_session) {
    return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "file path, session id, and output handle are required", error_out, error_capacity);
  }
  *out_session = nullptr;
  try {
    auto* session = new sidechannel_session(file_path, session_id, sqlite);
    if (!session->open()) {
      delete session;
      return fail(SIDECHANNEL_C_IO_ERROR, "native session open failed", error_out, error_capacity);
    }
    *out_session = session;
    return SIDECHANNEL_C_OK;
  } catch (const std::exception& error) {
    return fail(SIDECHANNEL_C_IO_ERROR, error.what(), error_out, error_capacity);
  } catch (...) {
    return fail(SIDECHANNEL_C_IO_ERROR, "native session open failed", error_out, error_capacity);
  }
}

extern "C" int sidechannel_session_open(
  const char* file_path,
  const char* session_id,
  sidechannel_session** out_session,
  char* error_out,
  size_t error_capacity
) {
  return open_session(file_path, session_id, out_session, error_out, error_capacity, false);
}

extern "C" int sidechannel_session_open_sqlite(
  const char* file_path,
  const char* session_id,
  sidechannel_session** out_session,
  char* error_out,
  size_t error_capacity
) {
  return open_session(file_path, session_id, out_session, error_out, error_capacity, true);
}

extern "C" int sidechannel_session_append(
  sidechannel_session* session,
  const sidechannel_observation* observation,
  char* error_out,
  size_t error_capacity
) {
  if (!session || !observation || !bounded_text(observation->id) || !bounded_text(observation->source_id) ||
      !bounded_text(observation->channel)) {
    return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "observation identity fields are required", error_out, error_capacity);
  }
  if (!std::isfinite(observation->value) || !std::isfinite(observation->quality_score) ||
      observation->quality_score < 0.0 || observation->quality_score > 1.0) {
    return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "observation values must be finite and quality must be within 0..1", error_out, error_capacity);
  }
  sidechannel::EvidenceState evidence_state;
  if (!evidence_state_from_value(observation->evidence_state, evidence_state)) {
    return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "evidence state is outside the native contract", error_out, error_capacity);
  }
  try {
    sidechannel::Observation value{
      "sidechannel.observation/2",
      observation->id,
      observation->source_id,
      observation->channel,
      observation->timestamp_ms,
      observation->value,
      observation->quality_score,
      0,
      evidence_state
    };
    if (!session->append(std::move(value))) {
      return fail(SIDECHANNEL_C_IO_ERROR, "native session rejected observation", error_out, error_capacity);
    }
    return SIDECHANNEL_C_OK;
  } catch (const std::exception& error) {
    return fail(SIDECHANNEL_C_IO_ERROR, error.what(), error_out, error_capacity);
  } catch (...) {
    return fail(SIDECHANNEL_C_IO_ERROR, "native session append failed", error_out, error_capacity);
  }
}

extern "C" int sidechannel_session_close(
  sidechannel_session* session,
  int64_t ended_at_ms,
  char* error_out,
  size_t error_capacity
) {
  if (!session) return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "session handle is required", error_out, error_capacity);
  try {
    return session->close(ended_at_ms)
      ? SIDECHANNEL_C_OK
      : fail(SIDECHANNEL_C_IO_ERROR, "native session close rejected", error_out, error_capacity);
  } catch (const std::exception& error) {
    return fail(SIDECHANNEL_C_IO_ERROR, error.what(), error_out, error_capacity);
  } catch (...) {
    return fail(SIDECHANNEL_C_IO_ERROR, "native session close failed", error_out, error_capacity);
  }
}

extern "C" int sidechannel_session_state(
  const sidechannel_session* session,
  char* state_out,
  size_t state_capacity
) {
  if (!session) return SIDECHANNEL_C_INVALID_ARGUMENT;
  return copy_text(session->state(), state_out, state_capacity);
}

extern "C" int sidechannel_session_scene_view(
  const sidechannel_session* session,
  int64_t now_ms,
  size_t max_sources,
  size_t max_observations,
  char* scene_out,
  size_t scene_capacity
) {
  if (!session || !scene_out || scene_capacity == 0 || max_sources == 0 || max_sources > 256 ||
      max_observations == 0 || max_observations > 512) {
    return SIDECHANNEL_C_INVALID_ARGUMENT;
  }
  const auto view = sidechannel::create_native_scene_view(
    session->observations(), now_ms, sidechannel::SceneViewLimits{max_sources, max_observations, 0, 0, 0}
  );
  return copy_text(view.to_json(), scene_out, scene_capacity);
}

extern "C" int sidechannel_session_verify(
  const sidechannel_session* session,
  char* error_out,
  size_t error_capacity
) {
  if (!session) return fail(SIDECHANNEL_C_INVALID_ARGUMENT, "session handle is required", error_out, error_capacity);
  const auto verification = session->verify();
  if (verification.ok) return SIDECHANNEL_C_OK;
  return fail(SIDECHANNEL_C_VERIFY_ERROR, verification.error.c_str(), error_out, error_capacity);
}

extern "C" void sidechannel_session_destroy(sidechannel_session* session) {
  delete session;
}

extern "C" int sidechannel_ipc_encode(
  const char* token,
  const char* request_id,
  const char* type,
  const char* payload,
  char* wire_out,
  size_t wire_capacity
) {
  if (!token || !request_id || !type || !payload || !wire_out || wire_capacity == 0) {
    return SIDECHANNEL_C_INVALID_ARGUMENT;
  }
  const auto wire = sidechannel::LocalIpcCodec::encode({request_id, type, payload}, token);
  if (wire.empty()) return SIDECHANNEL_C_PROTOCOL_ERROR;
  if (wire.size() + 1 > wire_capacity) {
    wire_out[0] = '\0';
    return SIDECHANNEL_C_BUFFER_TOO_SMALL;
  }
  std::memcpy(wire_out, wire.c_str(), wire.size() + 1);
  return SIDECHANNEL_C_OK;
}
