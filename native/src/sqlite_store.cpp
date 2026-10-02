#include "sidechannel/sqlite_store.hpp"

#include "sqlite3.h"

#include <algorithm>
#include <chrono>
#include <fstream>
#include <limits>
#include <sstream>
#include <utility>

namespace sidechannel {
namespace {

class Statement {
public:
  Statement() = default;
  ~Statement() {
    if (statement_) sqlite3_finalize(statement_);
  }

  Statement(const Statement&) = delete;
  Statement& operator=(const Statement&) = delete;

  sqlite3_stmt* get() const noexcept { return statement_; }
  sqlite3_stmt** out() noexcept { return &statement_; }

private:
  sqlite3_stmt* statement_ = nullptr;
};

std::string sqlite_error(sqlite3* database) {
  return database ? sqlite3_errmsg(database) : "sqlite database is not open";
}

bool bind_text(sqlite3_stmt* statement, int index, const std::string& value) {
  return sqlite3_bind_text(statement, index, value.c_str(), -1, SQLITE_TRANSIENT) == SQLITE_OK;
}

std::string column_text(sqlite3_stmt* statement, int index) {
  const auto* value = sqlite3_column_text(statement, index);
  return value ? reinterpret_cast<const char*>(value) : std::string{};
}

std::string quote_json_local(const std::string& value) {
  std::string quoted = "\"";
  for (const auto character : value) {
    if (character == '\\' || character == '"') quoted += '\\';
    if (character == '\n') quoted += "\\n";
    else if (character == '\r') quoted += "\\r";
    else if (character == '\t') quoted += "\\t";
    else quoted += character;
  }
  quoted += '"';
  return quoted;
}

std::int64_t current_time_ms() {
  const auto now = std::chrono::system_clock::now().time_since_epoch();
  return std::chrono::duration_cast<std::chrono::milliseconds>(now).count();
}

} // namespace

NativeSqliteSessionStore::NativeSqliteSessionStore(std::filesystem::path file_path, std::string session_id)
  : file_path_(std::move(file_path)), session_id_(std::move(session_id)) {}

NativeSqliteSessionStore::~NativeSqliteSessionStore() {
  close_database();
}

void NativeSqliteSessionStore::set_error(const std::string& message) const {
  last_error_ = message;
}

void NativeSqliteSessionStore::close_database() {
  if (database_) {
    sqlite3_close_v2(database_);
    database_ = nullptr;
  }
}

bool NativeSqliteSessionStore::execute(const char* sql) {
  char* error_message = nullptr;
  const auto result = sqlite3_exec(database_, sql, nullptr, nullptr, &error_message);
  if (result == SQLITE_OK) return true;
  const std::string message = error_message ? error_message : sqlite_error(database_);
  if (error_message) sqlite3_free(error_message);
  set_error(message);
  return false;
}

bool NativeSqliteSessionStore::ensure_schema() {
  return execute(
    "PRAGMA foreign_keys=ON;"
    "PRAGMA journal_mode=WAL;"
    "PRAGMA synchronous=FULL;"
    "CREATE TABLE IF NOT EXISTS sidechannel_native_sessions ("
      "session_id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER"
    ");"
    "CREATE TABLE IF NOT EXISTS sidechannel_native_journal ("
      "session_id TEXT NOT NULL, sequence INTEGER NOT NULL, timestamp_ms INTEGER NOT NULL,"
      "type TEXT NOT NULL, payload TEXT NOT NULL, previous_digest TEXT, event_digest TEXT NOT NULL,"
      "PRIMARY KEY(session_id, sequence),"
      "FOREIGN KEY(session_id) REFERENCES sidechannel_native_sessions(session_id) ON DELETE CASCADE"
    ");"
    "CREATE TABLE IF NOT EXISTS sidechannel_native_observations ("
      "session_id TEXT NOT NULL, sequence INTEGER NOT NULL, id TEXT NOT NULL, source_id TEXT NOT NULL,"
      "channel TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, value REAL NOT NULL, quality_score REAL NOT NULL,"
      "evidence_state INTEGER NOT NULL, PRIMARY KEY(session_id, sequence), UNIQUE(session_id, id),"
      "FOREIGN KEY(session_id) REFERENCES sidechannel_native_sessions(session_id) ON DELETE CASCADE"
    ");"
    "CREATE INDEX IF NOT EXISTS sidechannel_native_observations_by_time"
      " ON sidechannel_native_observations(session_id, timestamp_ms);"
  );
}

JournalEntry NativeSqliteSessionStore::next_event(std::string type, std::int64_t timestamp_ms,
  std::string payload) const {
  JournalEntry entry;
  entry.sequence = journal_entries_.size() + 1;
  entry.timestamp_ms = timestamp_ms;
  entry.type = std::move(type);
  entry.payload = std::move(payload);
  entry.previous_digest = journal_entries_.empty() ? std::string{} : journal_entries_.back().event_digest;
  entry.event_digest = compute_journal_digest(session_id_, entry.sequence, entry.timestamp_ms,
    entry.type, entry.payload, entry.previous_digest);
  return entry;
}

bool NativeSqliteSessionStore::insert_journal(const JournalEntry& entry) {
  Statement statement;
  const char* sql = "INSERT INTO sidechannel_native_journal "
    "(session_id, sequence, timestamp_ms, type, payload, previous_digest, event_digest) "
    "VALUES (?, ?, ?, ?, ?, ?, ?)";
  if (sqlite3_prepare_v2(database_, sql, -1, statement.out(), nullptr) != SQLITE_OK ||
      !bind_text(statement.get(), 1, session_id_) ||
      sqlite3_bind_int64(statement.get(), 2, static_cast<sqlite3_int64>(entry.sequence)) != SQLITE_OK ||
      sqlite3_bind_int64(statement.get(), 3, static_cast<sqlite3_int64>(entry.timestamp_ms)) != SQLITE_OK ||
      !bind_text(statement.get(), 4, entry.type) || !bind_text(statement.get(), 5, entry.payload) ||
      (entry.previous_digest.empty()
        ? sqlite3_bind_null(statement.get(), 6) != SQLITE_OK
        : !bind_text(statement.get(), 6, entry.previous_digest)) ||
      !bind_text(statement.get(), 7, entry.event_digest)) {
    set_error(sqlite_error(database_));
    return false;
  }
  if (sqlite3_step(statement.get()) != SQLITE_DONE) {
    set_error(sqlite_error(database_));
    return false;
  }
  return true;
}

bool NativeSqliteSessionStore::insert_observation(const Observation& observation) {
  Statement statement;
  const char* sql = "INSERT INTO sidechannel_native_observations "
    "(session_id, sequence, id, source_id, channel, timestamp_ms, value, quality_score, evidence_state) "
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
  if (sqlite3_prepare_v2(database_, sql, -1, statement.out(), nullptr) != SQLITE_OK ||
      !bind_text(statement.get(), 1, session_id_) ||
      sqlite3_bind_int64(statement.get(), 2, static_cast<sqlite3_int64>(observation.sequence)) != SQLITE_OK ||
      !bind_text(statement.get(), 3, observation.id) || !bind_text(statement.get(), 4, observation.source_id) ||
      !bind_text(statement.get(), 5, observation.channel) ||
      sqlite3_bind_int64(statement.get(), 6, static_cast<sqlite3_int64>(observation.timestamp_ms)) != SQLITE_OK ||
      sqlite3_bind_double(statement.get(), 7, observation.value) != SQLITE_OK ||
      sqlite3_bind_double(statement.get(), 8, observation.quality_score) != SQLITE_OK ||
      sqlite3_bind_int(statement.get(), 9, static_cast<int>(observation.evidence_state)) != SQLITE_OK) {
    set_error(sqlite_error(database_));
    return false;
  }
  if (sqlite3_step(statement.get()) != SQLITE_DONE) {
    set_error(sqlite_error(database_));
    return false;
  }
  return true;
}

bool NativeSqliteSessionStore::update_session_state(const std::string& state,
  std::optional<std::int64_t> ended_at_ms) {
  Statement statement;
  const char* sql = "UPDATE sidechannel_native_sessions SET state = ?, ended_at_ms = ? WHERE session_id = ?";
  if (sqlite3_prepare_v2(database_, sql, -1, statement.out(), nullptr) != SQLITE_OK ||
      !bind_text(statement.get(), 1, state) ||
      (ended_at_ms.has_value()
        ? sqlite3_bind_int64(statement.get(), 2, static_cast<sqlite3_int64>(*ended_at_ms)) != SQLITE_OK
        : sqlite3_bind_null(statement.get(), 2) != SQLITE_OK) ||
      !bind_text(statement.get(), 3, session_id_)) {
    set_error(sqlite_error(database_));
    return false;
  }
  if (sqlite3_step(statement.get()) != SQLITE_DONE || sqlite3_changes(database_) != 1) {
    set_error(sqlite_error(database_));
    return false;
  }
  return true;
}

bool NativeSqliteSessionStore::load_rows() {
  journal_entries_.clear();
  observations_.clear();
  {
    Statement statement;
    const char* sql = "SELECT sequence, timestamp_ms, type, payload, previous_digest, event_digest "
      "FROM sidechannel_native_journal WHERE session_id = ? ORDER BY sequence";
    if (sqlite3_prepare_v2(database_, sql, -1, statement.out(), nullptr) != SQLITE_OK ||
        !bind_text(statement.get(), 1, session_id_)) {
      set_error(sqlite_error(database_));
      return false;
    }
    while (sqlite3_step(statement.get()) == SQLITE_ROW) {
      const auto sequence = sqlite3_column_int64(statement.get(), 0);
      if (sequence < 1) { set_error("sqlite journal sequence is invalid"); return false; }
      JournalEntry entry;
      entry.sequence = static_cast<std::uint64_t>(sequence);
      entry.timestamp_ms = sqlite3_column_int64(statement.get(), 1);
      entry.type = column_text(statement.get(), 2);
      entry.payload = column_text(statement.get(), 3);
      entry.previous_digest = column_text(statement.get(), 4);
      entry.event_digest = column_text(statement.get(), 5);
      journal_entries_.push_back(std::move(entry));
    }
    if (sqlite3_errcode(database_) != SQLITE_OK && sqlite3_errcode(database_) != SQLITE_DONE) {
      set_error(sqlite_error(database_));
      return false;
    }
  }
  {
    Statement statement;
    const char* sql = "SELECT sequence, id, source_id, channel, timestamp_ms, value, quality_score, evidence_state "
      "FROM sidechannel_native_observations WHERE session_id = ? ORDER BY sequence";
    if (sqlite3_prepare_v2(database_, sql, -1, statement.out(), nullptr) != SQLITE_OK ||
        !bind_text(statement.get(), 1, session_id_)) {
      set_error(sqlite_error(database_));
      return false;
    }
    while (sqlite3_step(statement.get()) == SQLITE_ROW) {
      const auto sequence = sqlite3_column_int64(statement.get(), 0);
      const auto evidence = sqlite3_column_int(statement.get(), 7);
      if (sequence < 1 || evidence < 0 || evidence > 6) {
        set_error("sqlite observation row is invalid");
        return false;
      }
      Observation observation;
      observation.schema = "sidechannel.observation/2";
      observation.sequence = static_cast<std::uint64_t>(sequence);
      observation.id = column_text(statement.get(), 1);
      observation.source_id = column_text(statement.get(), 2);
      observation.channel = column_text(statement.get(), 3);
      observation.timestamp_ms = sqlite3_column_int64(statement.get(), 4);
      observation.value = sqlite3_column_double(statement.get(), 5);
      observation.quality_score = sqlite3_column_double(statement.get(), 6);
      observation.evidence_state = static_cast<EvidenceState>(evidence);
      observations_.push_back(std::move(observation));
    }
    if (sqlite3_errcode(database_) != SQLITE_OK && sqlite3_errcode(database_) != SQLITE_DONE) {
      set_error(sqlite_error(database_));
      return false;
    }
  }
  return true;
}

bool NativeSqliteSessionStore::open() {
  if (database_) return true;
  last_error_.clear();
  if (!file_path_.parent_path().empty()) {
    std::error_code error;
    std::filesystem::create_directories(file_path_.parent_path(), error);
    if (error) { set_error(error.message()); return false; }
  }
  const auto path = file_path_.string();
  if (sqlite3_open_v2(path.c_str(), &database_, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nullptr) != SQLITE_OK) {
    set_error(sqlite_error(database_));
    close_database();
    return false;
  }
  if (!ensure_schema()) { close_database(); return false; }

  Statement query;
  const char* select_sql = "SELECT state FROM sidechannel_native_sessions WHERE session_id = ?";
  if (sqlite3_prepare_v2(database_, select_sql, -1, query.out(), nullptr) != SQLITE_OK ||
      !bind_text(query.get(), 1, session_id_)) {
    set_error(sqlite_error(database_));
    close_database();
    return false;
  }
  const auto row = sqlite3_step(query.get());
  if (row == SQLITE_DONE) {
    if (!execute("BEGIN IMMEDIATE;")) { close_database(); return false; }
    Statement insert;
    const char* insert_sql = "INSERT INTO sidechannel_native_sessions (session_id, state, started_at_ms, ended_at_ms) VALUES (?, ?, ?, NULL)";
    if (sqlite3_prepare_v2(database_, insert_sql, -1, insert.out(), nullptr) != SQLITE_OK ||
        !bind_text(insert.get(), 1, session_id_) || !bind_text(insert.get(), 2, "recording") ||
        sqlite3_bind_int64(insert.get(), 3, static_cast<sqlite3_int64>(current_time_ms())) != SQLITE_OK ||
        sqlite3_step(insert.get()) != SQLITE_DONE) {
      set_error(sqlite_error(database_));
      execute("ROLLBACK;");
      close_database();
      return false;
    }
    const auto opened = next_event("SessionOpened", current_time_ms(),
      "{\"sessionId\":" + quote_json_local(session_id_) + '}');
    if (!insert_journal(opened) || !execute("COMMIT;")) {
      execute("ROLLBACK;");
      close_database();
      return false;
    }
    journal_entries_.push_back(opened);
    state_ = "recording";
    return true;
  }
  if (row != SQLITE_ROW) {
    set_error(sqlite_error(database_));
    close_database();
    return false;
  }
  state_ = column_text(query.get(), 0);
  if (!load_rows()) { close_database(); return false; }
  if (!verify().ok) { close_database(); return false; }
  if (state_ == "recording") {
    if (!execute("BEGIN IMMEDIATE;")) { close_database(); return false; }
    const auto recovered = next_event("RuntimeRecovered", current_time_ms(),
      "{\"reason\":\"process_restart\"}");
    if (!insert_journal(recovered) || !update_session_state("interrupted", std::nullopt) || !execute("COMMIT;")) {
      execute("ROLLBACK;");
      close_database();
      return false;
    }
    journal_entries_.push_back(recovered);
    state_ = "interrupted";
  }
  if (state_ != "completed" && state_ != "interrupted") {
    set_error("sqlite session state is unsupported");
    close_database();
    return false;
  }
  return true;
}

bool NativeSqliteSessionStore::append(Observation observation) {
  if (state_ != "recording") { set_error("sqlite session is not recording"); return false; }
  observation.sequence = observations_.size() + 1;
  const auto event = next_event("ObservationAdmitted", observation.timestamp_ms,
    observation_admission_payload(observation));
  if (!execute("BEGIN IMMEDIATE;") || !insert_journal(event) || !insert_observation(observation) || !execute("COMMIT;")) {
    execute("ROLLBACK;");
    return false;
  }
  journal_entries_.push_back(event);
  observations_.push_back(std::move(observation));
  return true;
}

bool NativeSqliteSessionStore::record_event(std::string type, std::int64_t timestamp_ms, std::string payload) {
  if (state_ != "recording") { set_error("sqlite session is not recording"); return false; }
  const auto event = next_event(std::move(type), timestamp_ms, std::move(payload));
  if (!execute("BEGIN IMMEDIATE;") || !insert_journal(event) || !execute("COMMIT;")) {
    execute("ROLLBACK;");
    return false;
  }
  journal_entries_.push_back(event);
  return true;
}

bool NativeSqliteSessionStore::close(std::int64_t ended_at_ms) {
  if (state_ != "recording") { set_error("sqlite session is not recording"); return false; }
  const auto event = next_event("SessionClosed", ended_at_ms,
    "{\"endedAtMs\":" + std::to_string(ended_at_ms) + '}');
  if (!execute("BEGIN IMMEDIATE;") || !insert_journal(event) ||
      !update_session_state("completed", ended_at_ms) || !execute("COMMIT;")) {
    execute("ROLLBACK;");
    return false;
  }
  journal_entries_.push_back(event);
  state_ = "completed";
  return true;
}

const std::string& NativeSqliteSessionStore::state() const noexcept {
  return state_;
}

const std::vector<Observation>& NativeSqliteSessionStore::observations() const noexcept {
  return observations_;
}

const std::vector<JournalEntry>& NativeSqliteSessionStore::journal() const noexcept {
  return journal_entries_;
}

JournalVerification NativeSqliteSessionStore::verify() const {
  JournalVerification result;
  result.event_count = journal_entries_.size();
  if (!database_) {
    result.error = "sqlite database is not open";
    return result;
  }
  std::uint64_t expected_sequence = 1;
  std::string previous_digest;
  std::size_t admitted_count = 0;
  for (const auto& entry : journal_entries_) {
    if (entry.sequence != expected_sequence || entry.previous_digest != previous_digest ||
        entry.event_digest != compute_journal_digest(session_id_, entry.sequence, entry.timestamp_ms,
          entry.type, entry.payload, entry.previous_digest)) {
      result.error = "sqlite journal hash chain is invalid";
      return result;
    }
    if (entry.type == "ObservationAdmitted") {
      if (admitted_count >= observations_.size() || entry.payload != observation_admission_payload(observations_[admitted_count])) {
        result.error = "sqlite observation journal does not match retained records";
        return result;
      }
      ++admitted_count;
    }
    previous_digest = entry.event_digest;
    ++expected_sequence;
  }
  if (admitted_count != observations_.size()) {
    result.error = "sqlite retained observation count does not match journal";
    return result;
  }
  result.ok = true;
  return result;
}

std::string NativeSqliteSessionStore::export_json() const {
  SessionArchive archive(session_id_);
  for (const auto& observation : observations_) archive.append(observation);
  archive.set_journal(journal_entries_);
  return archive.to_json();
}

const std::string& NativeSqliteSessionStore::last_error() const noexcept {
  return last_error_;
}

} // namespace sidechannel
