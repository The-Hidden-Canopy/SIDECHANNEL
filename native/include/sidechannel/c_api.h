#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct sidechannel_session sidechannel_session;

enum {
  SIDECHANNEL_C_OK = 0,
  SIDECHANNEL_C_INVALID_ARGUMENT = 1,
  SIDECHANNEL_C_IO_ERROR = 2,
  SIDECHANNEL_C_VERIFY_ERROR = 3,
  SIDECHANNEL_C_BUFFER_TOO_SMALL = 4,
  SIDECHANNEL_C_PROTOCOL_ERROR = 5
};

typedef struct sidechannel_observation {
  const char* id;
  const char* source_id;
  const char* channel;
  int64_t timestamp_ms;
  double value;
  double quality_score;
  int32_t evidence_state;
} sidechannel_observation;

int sidechannel_session_open(
  const char* file_path,
  const char* session_id,
  sidechannel_session** out_session,
  char* error_out,
  size_t error_capacity
);

int sidechannel_session_open_sqlite(
  const char* file_path,
  const char* session_id,
  sidechannel_session** out_session,
  char* error_out,
  size_t error_capacity
);

int sidechannel_session_append(
  sidechannel_session* session,
  const sidechannel_observation* observation,
  char* error_out,
  size_t error_capacity
);

int sidechannel_session_close(
  sidechannel_session* session,
  int64_t ended_at_ms,
  char* error_out,
  size_t error_capacity
);

int sidechannel_session_state(
  const sidechannel_session* session,
  char* state_out,
  size_t state_capacity
);

int sidechannel_session_scene_view(
  const sidechannel_session* session,
  int64_t now_ms,
  size_t max_sources,
  size_t max_observations,
  char* scene_out,
  size_t scene_capacity
);

int sidechannel_session_export(
  const sidechannel_session* session,
  char* package_out,
  size_t package_capacity,
  char* error_out,
  size_t error_capacity
);

int sidechannel_session_verify(
  const sidechannel_session* session,
  char* error_out,
  size_t error_capacity
);

void sidechannel_session_destroy(sidechannel_session* session);

int sidechannel_ipc_encode(
  const char* token,
  const char* request_id,
  const char* type,
  const char* payload,
  char* wire_out,
  size_t wire_capacity
);

#ifdef __cplusplus
}
#endif
